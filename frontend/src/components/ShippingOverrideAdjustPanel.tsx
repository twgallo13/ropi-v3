/**
 * TALLY-SHIPPING-OVERRIDE-CLEANUP PR 2.6 — ShippingOverrideAdjustPanel.
 *
 * Inline adjust panel rendered as sibling block below a card row in
 * ReviewActiveOverridesPage. NOT a floating popover (per Frink F5;
 * matches BuyerReviewPage in-flow render pattern). No @floating-ui dep.
 *
 * Explicit upgrades over BuyerReviewPage's inline AdjustPopover:
 *   - Validation (Number.isFinite check on parsed inputs)
 *   - Disabled-while-saving (both Apply and Cancel buttons)
 *   - Inline error slot (no toast)
 *   - Sequential save (avoid Firestore race on same product doc)
 */
import { useState } from "react";
import { saveField } from "../lib/api";

export interface ShippingOverrideAdjustPanelProps {
  mpn: string;
  currentStandard: number | null;
  currentExpedited: number | null;
  onApplied: (newStd: number | null, newExp: number | null) => void;
  onCancel: () => void;
}

export function ShippingOverrideAdjustPanel({
  mpn,
  currentStandard,
  currentExpedited,
  onApplied,
  onCancel,
}: ShippingOverrideAdjustPanelProps) {
  const [stdInput, setStdInput] = useState<string>(currentStandard?.toString() ?? "");
  const [expInput, setExpInput] = useState<string>(currentExpedited?.toString() ?? "");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function handleZeroOutBoth() {
    setStdInput("0");
    setExpInput("0");
  }

  async function handleApply() {
    setError(null);
    const trimStd = stdInput.trim();
    const trimExp = expInput.trim();
    const newStd: number | null = trimStd === "" ? null : Number(trimStd);
    const newExp: number | null = trimExp === "" ? null : Number(trimExp);
    if (newStd !== null && !Number.isFinite(newStd)) {
      setError("Standard shipping override must be a number or blank");
      return;
    }
    if (newExp !== null && !Number.isFinite(newExp)) {
      setError("Expedited shipping override must be a number or blank");
      return;
    }
    const stdChanged = newStd !== currentStandard;
    const expChanged = newExp !== currentExpedited;
    if (!stdChanged && !expChanged) {
      onCancel();
      return;
    }
    setIsSaving(true);
    try {
      // Sequential save — avoid Firestore race on same product doc
      if (stdChanged) {
        await saveField(mpn, "standard_shipping_override", newStd);
      }
      if (expChanged) {
        await saveField(mpn, "expedited_shipping_override", newExp);
      }
      onApplied(newStd, newExp);
    } catch (e: any) {
      // Inline error formatting — matches per-page formatError convention but
      // duplicated locally to keep panel self-contained. No prop, no import
      // from page module. (See TALLY-ADMIN-FORMATTERROR-BARREL follow-up.)
      const msg = !e
        ? "Unknown error."
        : typeof e === "string"
        ? e
        : (e.error || e.message || JSON.stringify(e));
      if (stdChanged && !expChanged) {
        setError(`Standard save failed: ${msg}`);
      } else if (!stdChanged && expChanged) {
        setError(`Expedited save failed: ${msg}`);
      } else {
        setError(msg);
      }
      setIsSaving(false);
    }
  }

  const stdCurrentDisplay = currentStandard === null ? "—" : `$${currentStandard}`;
  const expCurrentDisplay = currentExpedited === null ? "—" : `$${currentExpedited}`;

  return (
    <div className="mt-3 p-4 bg-gray-50 border rounded-lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Standard Shipping Override{" "}
            <span className="text-gray-500 font-normal">(Current: {stdCurrentDisplay})</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={stdInput}
            onChange={(e) => setStdInput(e.target.value)}
            disabled={isSaving}
            placeholder="(blank to clear)"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Expedited Shipping Override{" "}
            <span className="text-gray-500 font-normal">(Current: {expCurrentDisplay})</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={expInput}
            onChange={(e) => setExpInput(e.target.value)}
            disabled={isSaving}
            placeholder="(blank to clear)"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
          />
        </div>
      </div>
      <div className="mt-3 flex gap-2 items-center">
        <button
          type="button"
          onClick={handleApply}
          disabled={isSaving}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {isSaving ? "Saving…" : "Apply"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleZeroOutBoth}
          disabled={isSaving}
          title="Override to free shipping for both standard and expedited"
          className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:bg-gray-100"
        >
          Zero Out Both
        </button>
      </div>
      {error !== null && (
        <div className="mt-2 text-sm text-red-700">{error}</div>
      )}
    </div>
  );
}

export default ShippingOverrideAdjustPanel;
