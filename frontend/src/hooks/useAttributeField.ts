import { useState, useCallback, useRef } from "react";
import { saveField, type SaveFieldResponse } from "../lib/api";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useAttributeField(
  mpn: string,
  fieldKey: string,
  initialValue: string,
  onSaved?: (fieldKey: string, resp: SaveFieldResponse) => void
) {
  const [value, setValue] = useState(initialValue);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef(initialValue);
  const resetTimerRef = useRef<number | null>(null);

  const handleBlur = useCallback(async () => {
    if (value === lastSavedRef.current) return;
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setSaveState("saving");
    setError(null);
    try {
      const resp = await saveField(mpn, fieldKey, value);
      lastSavedRef.current = value;
      setSaveState("saved");
      onSaved?.(fieldKey, resp);
      resetTimerRef.current = window.setTimeout(() => {
        setSaveState("idle");
        resetTimerRef.current = null;
      }, 2000);
    } catch (err: any) {
      setSaveState("error");
      setError(err?.error || err?.message || "Save failed");
    }
  }, [mpn, fieldKey, value, onSaved]);

  return { value, setValue, saveState, error, handleBlur };
}
