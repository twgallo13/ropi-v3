import { useEffect, useState } from "react";
import GuidedTour, { TourStep } from "./GuidedTour";
import { hasTourBeenSeen, markTourSeen } from "../hooks/useTours";

/**
 * Phase 3.1 PR #10 — Welcome to AOSS guided tour.
 *
 * Hardcoded 6-step direct-mount tour over the AdminOverviewPage pillar
 * cards. PO Q1 Option 3: defer Firestore-backed schema; future migration
 * is a carry-forward tally. PO Q2 Option 1: plain text content (no
 * Markdown). Consumes existing GuidedTour + useTours primitives.
 */

const TOUR_ID = "tour_admin_overview";

const WELCOME_STEPS: TourStep[] = [
  {
    target_selector: '[data-tour="pillar-data-registries"]',
    title: "Data Registries",
    content:
      "This is where you manage product attributes, brands, departments, and the rules that shape every product record. Configure once, and every product follows the same spec.",
    position: "bottom",
  },
  {
    target_selector: '[data-tour="pillar-ai-automation"]',
    title: "AI & Automation",
    content:
      "Smart Rules and AI provider settings live here. Build rules that auto-fill product data, run quality checks, and accelerate the team's content work.",
    position: "bottom",
  },
  {
    target_selector: '[data-tour="pillar-data-pipeline"]',
    title: "Data Pipeline & Workflow",
    content:
      "Imports, exports, and queue management. Watch products flow from RICS through the completion queue and out to your marketplaces.",
    position: "bottom",
  },
  {
    target_selector: '[data-tour="pillar-access-governance"]',
    title: "Access & Governance",
    content:
      "User roles, permissions, and audit logs. Control who can do what, and review every change after the fact.",
    position: "top",
  },
  {
    target_selector: '[data-tour="pillar-app-experience"]',
    title: "App Experience",
    content:
      "SOPs, guided tours like this one, and admin polish. Help your team onboard fast and find their footing in AOSS.",
    position: "top",
  },
  {
    target_selector: '[data-tour="pillar-system-infrastructure"]',
    title: "System & Infrastructure",
    content:
      "Pricing guardrails, search settings, launch settings, and other infrastructure controls. The behind-the-scenes plumbing that keeps everything running.",
    position: "top",
  },
];

export function WelcomeTour() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!hasTourBeenSeen(TOUR_ID)) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <GuidedTour
      tourId={TOUR_ID}
      steps={WELCOME_STEPS}
      onComplete={() => {
        markTourSeen(TOUR_ID);
        setShow(false);
      }}
    />
  );
}

export default WelcomeTour;
