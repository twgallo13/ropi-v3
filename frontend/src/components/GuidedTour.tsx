import { useEffect, useLayoutEffect, useState } from "react";
import { markTourSeen } from "../hooks/useTours";

export interface TourStep {
  target_selector: string;
  title: string;
  content: string;
  position?: "top" | "bottom" | "left" | "right";
}

interface GuidedTourProps {
  tourId: string;
  steps: TourStep[];
  onComplete: () => void;
}

function computePosition(
  rect: DOMRect | null,
  position: TourStep["position"] = "bottom"
): React.CSSProperties {
  const tooltipW = 288; // w-72
  const tooltipH = 160;
  const margin = 12;
  if (!rect) {
    // center
    return {
      top: window.innerHeight / 2 - tooltipH / 2,
      left: window.innerWidth / 2 - tooltipW / 2,
    };
  }
  let top = 0;
  let left = 0;
  switch (position) {
    case "top":
      top = rect.top - tooltipH - margin;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
    case "left":
      top = rect.top + rect.height / 2 - tooltipH / 2;
      left = rect.left - tooltipW - margin;
      break;
    case "right":
      top = rect.top + rect.height / 2 - tooltipH / 2;
      left = rect.right + margin;
      break;
    case "bottom":
    default:
      top = rect.bottom + margin;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
  }
  // clamp
  const maxLeft = window.innerWidth - tooltipW - 8;
  const maxTop = window.innerHeight - tooltipH - 8;
  left = Math.max(8, Math.min(maxLeft, left));
  top = Math.max(8, Math.min(maxTop, top));
  return { top, left };
}

export default function GuidedTour({
  tourId,
  steps,
  onComplete,
}: GuidedTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[currentStep];

  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = document.querySelector(step.target_selector);
      if (el && el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    };
    measure();
    const interval = setInterval(measure, 300);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        markTourSeen(tourId);
        onComplete();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tourId, onComplete]);

  if (!step) return null;
  const pos = computePosition(rect, step.position);
  const isLast = currentStep >= steps.length - 1;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 pointer-events-none" />
      {rect && (
        <div
          className="fixed z-50 ring-4 ring-blue-500 ring-offset-2 rounded pointer-events-none transition-all"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      )}
      <div
        className="fixed z-50 bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-4 w-72 border border-gray-200 dark:border-gray-700"
        style={pos}
      >
        <div className="text-xs text-blue-600 font-medium mb-1">
          Step {currentStep + 1} of {steps.length}
        </div>
        <h3 className="font-semibold text-sm mb-1 text-gray-900 dark:text-gray-100">
          {step.title}
        </h3>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {step.content}
        </p>
        <div className="flex justify-between items-center mt-3 gap-2">
          <button
            onClick={() => {
              markTourSeen(tourId);
              onComplete();
            }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <button
                onClick={() => setCurrentStep((s) => s - 1)}
                className="text-xs border border-gray-200 dark:border-gray-700 px-3 py-1 rounded text-gray-600 dark:text-gray-300"
              >
                ← Back
              </button>
            )}
            <button
              onClick={() => {
                if (!isLast) {
                  setCurrentStep((s) => s + 1);
                } else {
                  markTourSeen(tourId);
                  onComplete();
                }
              }}
              className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
            >
              {isLast ? "Done ✓" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
