import { useEffect, useState } from "react";

// TALLY-PRODUCT-LIST-UX Phase 2B — shared hover preview popup.
//
// PO Ruling F (locked 2026-04-23):
//   • Sources from primary_image_url.
//   • image_status === "YES" with empty/broken URL → ⚠️ + tooltip
//     "Image flag set but URL missing".
//   • image_status === "NO" → neutral "No image yet" placeholder.
//   • pointer-events: none — preview MUST NOT intercept clicks on
//     underlying row content.
//
// Positioning: absolute, anchored to a parent supplying `relative`
// (mirrors BuyerReviewPage's left-0 top-full pattern).
//
// Open-delay (`graceMs`) is owned by this component so consumers can
// just toggle `isVisible` from immediate hover/focus state. Default
// 100ms per dispatch; BuyerReviewPage passes 300ms to preserve its
// previous Subtask 3c behavior.
export interface HoverImagePreviewProps {
  imageUrl: string | null;
  imageStatus: string;
  isVisible: boolean;
  graceMs?: number;
  altText?: string;
  /** Optional secondary line rendered under the preview (e.g., source label). */
  footerText?: string;
}

const DEFAULT_GRACE_MS = 100;
const PREVIEW_PX = 300;

export default function HoverImagePreview({
  imageUrl,
  imageStatus,
  isVisible,
  graceMs = DEFAULT_GRACE_MS,
  altText,
  footerText,
}: HoverImagePreviewProps) {
  const [shown, setShown] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Reset transient broken-image flag whenever the source URL changes.
  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  // Open-delay debounce. Hide is immediate when isVisible flips false
  // so that close-timing is fully owned by the consumer.
  useEffect(() => {
    if (!isVisible) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), Math.max(0, graceMs));
    return () => clearTimeout(t);
  }, [isVisible, graceMs]);

  if (!shown) return null;

  const status = (imageStatus || "").toUpperCase();
  const hasUsableUrl =
    typeof imageUrl === "string" && imageUrl.trim().length > 0;

  // Branch resolution:
  //   1. YES + url + !imgError      → render image
  //   2. YES + (no url OR imgError) → ⚠️ tooltip "Image flag set but URL missing"
  //   3. NO (or other)              → neutral "No image yet" placeholder
  const renderImage = status === "YES" && hasUsableUrl && !imgError;
  const renderWarning = status === "YES" && !renderImage;

  return (
    <div
      role="tooltip"
      aria-hidden={!shown}
      className="absolute z-50 left-0 top-full mt-2 bg-white border border-gray-300 rounded-lg shadow-xl p-2"
      style={{
        width: PREVIEW_PX,
        pointerEvents: "none",
      }}
    >
      {renderImage ? (
        <img
          src={imageUrl as string}
          alt={altText ?? ""}
          className="block object-contain rounded mx-auto"
          style={{ maxWidth: PREVIEW_PX - 16, maxHeight: PREVIEW_PX - 16 }}
          onError={() => setImgError(true)}
        />
      ) : renderWarning ? (
        <div
          className="flex flex-col items-center justify-center text-amber-700 bg-amber-50 border border-amber-200 rounded"
          style={{ height: PREVIEW_PX - 16 }}
          title="Image flag set but URL missing"
        >
          <span className="text-3xl" aria-hidden="true">⚠️</span>
          <span className="mt-2 text-xs font-medium px-3 text-center">
            Image flag set but URL missing
          </span>
        </div>
      ) : (
        <div
          className="flex items-center justify-center text-gray-400 bg-gray-50 border border-gray-200 rounded"
          style={{ height: PREVIEW_PX - 16 }}
        >
          <span className="text-xs">No image yet</span>
        </div>
      )}
      {footerText && (
        <div className="mt-1 text-[10px] text-gray-500 text-center">
          {footerText}
        </div>
      )}
    </div>
  );
}
