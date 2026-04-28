import { useState } from "react";
import {
  RoleGate,
  ErrorBanner,
  SaveButton,
  AdminSelect,
  showToast,
  ConfirmModal,
  AdminCrudTable,
  RichTextEditor,
} from "../components/admin";
import type { AdminCrudColumn } from "../components/admin";

/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — Component Demo Harness
 *
 * Visit /admin/component-demo (admin/owner only). Every section renders one
 * shared component with at least one interactive demo to exercise its props.
 */

interface DemoRow {
  id: string;
  name: string;
  status: string;
  updated_at: string;
}

const DEMO_ROWS: DemoRow[] = [
  { id: "1", name: "Alpha Rule", status: "active", updated_at: "2026-04-20" },
  { id: "2", name: "Beta Rule", status: "active", updated_at: "2026-04-21" },
  { id: "3", name: "Gamma Rule", status: "inactive", updated_at: "2026-04-22" },
  { id: "4", name: "Delta Rule", status: "active", updated_at: "2026-04-23" },
  { id: "5", name: "Epsilon Rule", status: "active", updated_at: "2026-04-24" },
];

const DEMO_COLUMNS: AdminCrudColumn<DemoRow>[] = [
  { key: "name", header: "Name", render: (r) => r.name, sortable: true },
  { key: "status", header: "Status", render: (r) => r.status, sortable: true },
  { key: "updated_at", header: "Updated", render: (r) => r.updated_at, sortable: true },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-6 bg-white dark:bg-gray-900">
      <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">{title}</h2>
      {children}
    </section>
  );
}

export function ComponentDemoPage() {
  // SaveButton demo state
  const [saving, setSaving] = useState(false);

  // ErrorBanner demo state
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // AdminSelect demo state
  const [selectVal, setSelectVal] = useState("");

  // ConfirmModal demo states
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorModalErr, setErrorModalErr] = useState<string | null>(null);

  // AdminCrudTable demo state
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  // RichTextEditor demo state
  const [richHtml, setRichHtml] = useState<string>(
    "<p>Edit me — <strong>bold</strong>, <em>italic</em>, headings, and lists.</p>"
  );

  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-1 text-gray-900 dark:text-gray-100">
          B.0 Shared Components Demo
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          TALLY-SETTINGS-UX Phase 3 / B.0 — interactive harness for the 8 shared admin components.
        </p>

        <Section title="1. RoleGate">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            ✅ You reached this page → RoleGate let you through (admin/owner). Non-admin
            visitors are redirected to <code>/dashboard</code>.
          </p>
        </Section>

        <Section title="2. ErrorBanner">
          <ErrorBanner message={errorMsg} onDismiss={() => setErrorMsg(null)} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setErrorMsg("Demo error — something went wrong.")}
              className="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-sm"
            >
              Show error
            </button>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-sm"
            >
              Clear
            </button>
          </div>
        </Section>

        <Section title="3. SaveButton">
          <div className="flex gap-2 items-center">
            <SaveButton onClick={() => undefined} isSaving={false} />
            <SaveButton onClick={() => undefined} isSaving={true} />
            <SaveButton
              onClick={async () => {
                setSaving(true);
                await new Promise((r) => setTimeout(r, 2000));
                setSaving(false);
                showToast("Saved (demo)");
              }}
              isSaving={saving}
              label="Toggle for 2s"
            />
          </div>
        </Section>

        <Section title="4. AdminSelect">
          <AdminSelect
            value={selectVal}
            onChange={setSelectVal}
            options={[
              { value: "alpha", label: "Alpha" },
              { value: "beta", label: "Beta" },
              { value: "gamma", label: "Gamma" },
            ]}
          />
          <p className="text-xs text-gray-500 mt-2">Selected: {selectVal || "(none)"}</p>
        </Section>

        <Section title="5. SettingsToast">
          <button
            type="button"
            onClick={() => showToast("Demo toast — auto-dismisses in 4s")}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
          >
            Show toast
          </button>
        </Section>

        <Section title="6. ConfirmModal">
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setPrimaryOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
            >
              Primary modal
            </button>
            <button
              type="button"
              onClick={() => setDestructiveOpen(true)}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
            >
              Destructive modal
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorModalErr(null);
                setErrorModalOpen(true);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded text-sm"
            >
              Simulated-error modal
            </button>
          </div>

          <ConfirmModal
            open={primaryOpen}
            title="Confirm action?"
            body="This is a primary confirmation modal."
            onConfirm={() => {
              setPrimaryOpen(false);
              showToast("Primary action confirmed");
            }}
            onCancel={() => setPrimaryOpen(false)}
          />

          <ConfirmModal
            open={destructiveOpen}
            title="Delete this item?"
            body="This action cannot be undone."
            confirmLabel="Delete"
            confirmVariant="destructive"
            onConfirm={() => {
              setDestructiveOpen(false);
              showToast("Destructive action confirmed");
            }}
            onCancel={() => setDestructiveOpen(false)}
          />

          <ConfirmModal
            open={errorModalOpen}
            title="Save changes?"
            body="onConfirm will throw to demonstrate the errorSlot."
            onConfirm={async () => {
              try {
                throw new Error("Simulated backend failure");
              } catch (e: any) {
                setErrorModalErr(e?.message ?? String(e));
              }
            }}
            onCancel={() => {
              setErrorModalOpen(false);
              setErrorModalErr(null);
            }}
            errorSlot={errorModalErr}
          />
        </Section>

        <Section title="7. AdminCrudTable">
          <AdminCrudTable<DemoRow>
            rows={DEMO_ROWS}
            columns={DEMO_COLUMNS}
            rowKey={(r) => r.id}
            onEdit={(r) => showToast(`Edit ${r.name}`)}
            onDeactivate={(r) => showToast(`Deactivate ${r.name}`)}
            sortState={sortState}
            onSortChange={setSortState}
          />
          <p className="text-xs text-gray-500 mt-2">
            Sort: {sortState.key} {sortState.dir}
          </p>
        </Section>

        <Section title="8. RichTextEditor">
          <RichTextEditor value={richHtml} onChange={setRichHtml} />
          <h3 className="text-sm font-semibold mt-4 mb-2 text-gray-700 dark:text-gray-300">
            Live HTML preview:
          </h3>
          <div
            className="border border-gray-200 dark:border-gray-700 rounded p-3 bg-gray-50 dark:bg-gray-800 prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: richHtml }}
          />
        </Section>
      </div>
    </RoleGate>
  );
}

export default ComponentDemoPage;
