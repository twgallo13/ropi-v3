import { useEffect, useState } from "react";
import GuidedTour from "./GuidedTour";
import { fetchTourForHub, type TourDoc } from "../lib/api";
import { hasTourBeenSeen, resetTourSeen } from "../hooks/useTours";

interface TourLoaderProps {
  hub: string;
  /** When true, force-show tour even if already seen. Flipping this to true replays. */
  forceReplayKey?: number;
}

/**
 * Fetches the tour for the given hub, shows it on first visit, and
 * supports replay via forceReplayKey (increment to re-open).
 */
export default function TourLoader({ hub, forceReplayKey = 0 }: TourLoaderProps) {
  const [tour, setTour] = useState<TourDoc | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await fetchTourForHub(hub);
      if (cancelled) return;
      setTour(t);
      if (t && !hasTourBeenSeen(t.tour_id)) {
        setOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hub]);

  // Replay trigger
  useEffect(() => {
    if (forceReplayKey > 0 && tour) {
      resetTourSeen(tour.tour_id);
      setOpen(true);
    }
  }, [forceReplayKey, tour]);

  if (!tour || !open) return null;

  return (
    <GuidedTour
      tourId={tour.tour_id}
      steps={tour.steps}
      onComplete={() => setOpen(false)}
    />
  );
}
