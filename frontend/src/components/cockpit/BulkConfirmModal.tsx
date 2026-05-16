/**
 * TALLY-146 PR 2 — BulkConfirmModal.
 *
 * Two-stage modal:
 *   1. CONFIRM — show action label, MPN count, scrollable MPN list. Confirm / Cancel.
 *   2. RESULT  — show per-MPN result chips (ok / error) + summary counts. Close.
 *
 * Wires to bulkMarkdown / bulkAssignSupport. On success, calls onCommitted()
 * so the parent can refetch cockpit data and clear selection.
 *
 * Hard cap of 100 is enforced server-side (PR 1). UI shows error envelope verbatim.
 *
 * For "Assign support buyer" action, an inline picker is rendered above the
 * MPN list: mode (replace|append) + support buyer user-id list pulled from
 * fetchUsers().
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  bulkMarkdown,
  bulkAssignSupport,
  fetchUsers,
  type BulkMarkdownAction,
  type BulkAssignMode,
  type BulkResponse,
  type UserRosterEntry,
} from "../../lib/api";

export type BulkActionKind =
  | { kind: "markdown_approve" }
  | { kind: "markdown_reject" }
  | { kind: "assign_support" };

interface Props {
  open: boolean;
  action: BulkActionKind;
  mpns: string[];
  onClose: () => void;
  onCommitted: () => void;
}

const ACTION_LABELS: Record<BulkActionKind["kind"], string> = {
  markdown_approve: "Approve markdown",
  // TALLY-146 PR 2 v2.5 Matt-VQA Fix #4: surface label canonicalized to "Deny".
  // The internal kind id stays `markdown_reject` and the wire `action_type`
  // stays "reject" (BE bulk endpoint normalizes reject→deny at products.ts:1843);
  // only the user-visible label changes.
  markdown_reject: "Deny markdown",
  assign_support: "Assign support buyer",
};

const ACTION_BTN_CLASS: Record<BulkActionKind["kind"], string> = {
  markdown_approve: "bg-emerald-600 hover:bg-emerald-700",
  markdown_reject: "bg-rose-600 hover:bg-rose-700",
  assign_support: "bg-blue-600 hover:bg-blue-700",
};

export default function BulkConfirmModal({
  open,
  action,
  mpns,
  onClose,
  onCommitted,
}: Props) {
  const [stage, setStage] = useState<"confirm" | "submitting" | "result">("confirm");
  const [response, setResponse] = useState<BulkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // assign-support picker state
  const [users, setUsers] = useState<UserRosterEntry[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [mode, setMode] = useState<BulkAssignMode>("append");
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());

  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  // Reset internal stage state on each fresh open.
  useEffect(() => {
    if (open) {
      setStage("confirm");
      setResponse(null);
      setError(null);
      setSelectedUids(new Set());
      setMode("append");
      // Focus cancel by default (safer).
      setTimeout(() => cancelBtnRef.current?.focus(), 0);
    }
  }, [open]);

  // Lazy-load users when assign_support modal opens.
  useEffect(() => {
    if (!open || action.kind !== "assign_support" || users !== null) return;
    let cancelled = false;
    fetchUsers()
      .then((u) => {
        if (!cancelled) setUsers(u);
      })
      .catch((e) => {
        if (!cancelled) setUsersError(e?.message || "Failed to load users.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, action.kind, users]);

  const actionLabel = ACTION_LABELS[action.kind];
  const actionBtnClass = ACTION_BTN_CLASS[action.kind];

  const canConfirm = useMemo(() => {
    if (mpns.length === 0) return false;
    if (action.kind === "assign_support") return selectedUids.size > 0;
    return true;
  }, [action.kind, mpns.length, selectedUids]);

  async function handleConfirm() {
    if (!canConfirm) return;
    setStage("submitting");
    setError(null);
    try {
      let res: BulkResponse;
      if (action.kind === "markdown_approve") {
        res = await bulkMarkdown({ mpns, action_type: "approve" });
      } else if (action.kind === "markdown_reject") {
        res = await bulkMarkdown({ mpns, action_type: "reject" as BulkMarkdownAction });
      } else {
        res = await bulkAssignSupport({
          mpns,
          mode,
          support_user_ids: Array.from(selectedUids),
        });
      }
      setResponse(res);
      setStage("result");
      // Refresh cockpit data immediately so badges/queue counts reflect the
      // batch even if the user lingers on the result view.
      onCommitted();
    } catch (e: any) {
      setError(e?.error_message || e?.error || e?.message || "Bulk action failed.");
      setStage("result");
    }
  }

  // Esc to dismiss (only in confirm + result stages, NOT mid-submit).
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && stage !== "submitting") {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stage, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-label={`${actionLabel} confirmation`}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold">{actionLabel}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 text-lg leading-none px-2"
            disabled={stage === "submitting"}
          >
            ×
          </button>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1">
          {stage === "confirm" && (
            <ConfirmStage
              action={action}
              mpns={mpns}
              users={users}
              usersError={usersError}
              mode={mode}
              setMode={setMode}
              selectedUids={selectedUids}
              setSelectedUids={setSelectedUids}
            />
          )}
          {stage === "submitting" && (
            <div className="text-sm text-slate-600 py-6 text-center">Submitting…</div>
          )}
          {stage === "result" && (
            <ResultStage response={response} error={error} mpns={mpns} />
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          {stage === "confirm" && (
            <>
              <button
                ref={cancelBtnRef}
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className={`px-3 py-1.5 text-sm rounded text-white disabled:bg-slate-300 disabled:cursor-not-allowed ${actionBtnClass}`}
              >
                Confirm ({mpns.length})
              </button>
            </>
          )}
          {stage === "submitting" && (
            <button
              disabled
              className="px-3 py-1.5 text-sm rounded bg-slate-300 text-white cursor-not-allowed"
            >
              Submitting…
            </button>
          )}
          {stage === "result" && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 text-white hover:bg-slate-800"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmStage({
  action,
  mpns,
  users,
  usersError,
  mode,
  setMode,
  selectedUids,
  setSelectedUids,
}: {
  action: BulkActionKind;
  mpns: string[];
  users: UserRosterEntry[] | null;
  usersError: string | null;
  mode: BulkAssignMode;
  setMode: (m: BulkAssignMode) => void;
  selectedUids: Set<string>;
  setSelectedUids: (s: Set<string>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-700">
        {action.kind === "markdown_approve" && (
          <p>
            Apply <strong>Approve markdown</strong> to{" "}
            <strong>{mpns.length}</strong> selected item{mpns.length === 1 ? "" : "s"}.
          </p>
        )}
        {action.kind === "markdown_reject" && (
          <p>
            Apply <strong>Reject markdown</strong> to{" "}
            <strong>{mpns.length}</strong> selected item{mpns.length === 1 ? "" : "s"}.
          </p>
        )}
        {action.kind === "assign_support" && (
          <p>
            Assign support buyer(s) to <strong>{mpns.length}</strong> selected
            item{mpns.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      {action.kind === "assign_support" && (
        <div className="space-y-2 border border-slate-200 rounded p-2 bg-slate-50">
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="bulk-assign-mode"
                checked={mode === "append"}
                onChange={() => setMode("append")}
              />
              <span>Append</span>
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="bulk-assign-mode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />
              <span>Replace</span>
            </label>
          </div>
          <div className="text-[11px] text-slate-500">
            Choose support buyer(s):
          </div>
          {usersError && (
            <div className="text-xs text-rose-700">{usersError}</div>
          )}
          {!users && !usersError && (
            <div className="text-xs text-slate-500">Loading users…</div>
          )}
          {users && (
            <div className="max-h-32 overflow-y-auto space-y-1">
              {users.map((u) => {
                const checked = selectedUids.has(u.uid);
                return (
                  <label
                    key={u.uid}
                    className="flex items-center gap-2 text-xs px-1 py-0.5 hover:bg-white rounded"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(selectedUids);
                        if (checked) next.delete(u.uid);
                        else next.add(u.uid);
                        setSelectedUids(next);
                      }}
                    />
                    <span>{u.display_name}</span>
                    <span className="text-slate-400">({u.role ?? "—"})</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="text-xs text-slate-500 mb-1">MPNs ({mpns.length}):</div>
        <div className="border border-slate-200 rounded p-2 max-h-40 overflow-y-auto font-mono text-[11px] text-slate-700">
          {mpns.map((m) => (
            <div key={m}>{m}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultStage({
  response,
  error,
  mpns,
}: {
  response: BulkResponse | null;
  error: string | null;
  mpns: string[];
}) {
  if (error) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded p-2">
          {error}
        </div>
        <div className="text-xs text-slate-500">
          No items were processed. The selected set ({mpns.length}) is preserved.
        </div>
      </div>
    );
  }
  if (!response) return null;
  const okCount = response.summary?.ok ?? 0;
  const errCount = response.summary?.error ?? 0;
  return (
    <div className="space-y-2">
      <div className="text-sm">
        <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs mr-2">
          OK: {okCount}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-xs">
          Errors: {errCount}
        </span>
      </div>
      <div className="border border-slate-200 rounded max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
        {response.results.map((r) => (
          <div
            key={r.mpn}
            className={`px-2 py-1 flex items-center justify-between ${
              r.status === "ok" ? "bg-white" : "bg-rose-50"
            }`}
          >
            <span className="font-mono">{r.mpn}</span>
            <span
              className={`text-[11px] ${
                r.status === "ok" ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {r.status === "ok"
                ? "ok"
                : `${r.error_code ?? "error"}${
                    r.error_message ? ` — ${r.error_message}` : ""
                  }`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
