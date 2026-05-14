#!/usr/bin/env node
/**
 * TALLY-144-2B — Migrate active "Taxonomy:" smart_rules from
 * legacy display-string action target `department` to canonical
 * `department_key` using values resolved against `department_registry`.
 *
 * Mode: dry-run by default. Pass `--apply` to perform writes.
 *
 * Scope (strict):
 *   - smart_rules only.
 *   - Only rules where `is_active !== false` AND name matches
 *     /(^|\s)Taxonomy:/i AND at least one action has
 *     target_field === "department".
 *   - Only mutates the matching action entries inside `actions[]`.
 *   - Updates `updated_at` (server timestamp). Bumps `version` by 1
 *     to match the existing PUT semantics in adminSmartRules.ts.
 *   - Sets `updated_by = "system:tally-144-2b-taxonomy-smart-rule-migration"`.
 *   - Writes ONE summary `audit_log` doc.
 *
 * NEVER touches:
 *   - inactive rules
 *   - non-Taxonomy rules
 *   - condition.field (STOPs if a target rule has any legacy condition)
 *   - cadence_rules / cadence_assignments
 *   - products / attribute_values
 *   - any other collection
 *
 * Project guard: requires GCP_SA_KEY_DEV with project_id === "ropi-aoss-dev".
 */

const fs = require("fs");
const path = require("path");
const admin = require("/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin");

const TALLY = "TALLY-144-2B";
const ACTOR = "system:tally-144-2b-taxonomy-smart-rule-migration";
const EVIDENCE_DIR = path.join(
  __dirname,
  "..",
  "evidence",
  "tally-144-2b-taxonomy-smart-rule-migration"
);

const APPLY = process.argv.includes("--apply");
const LEGACY_TARGET_FIELD = "department";
const CANONICAL_TARGET_FIELD = "department_key";
const TAXONOMY_RE = /(^|\s)Taxonomy:/i;
const LEGACY_CONDITION_FIELDS = new Set(["department", "brand"]);

function tsTag() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function projectGuard() {
  const raw = process.env.GCP_SA_KEY_DEV;
  if (!raw) {
    console.error("FATAL: GCP_SA_KEY_DEV not set");
    process.exit(2);
  }
  const sa = JSON.parse(raw);
  if (sa.project_id !== "ropi-aoss-dev") {
    console.error(`FATAL: project guard — expected ropi-aoss-dev, got ${sa.project_id}`);
    process.exit(2);
  }
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: "ropi-aoss-dev",
  });
  return sa.project_id;
}

async function loadDepartmentRegistry(db) {
  const snap = await db.collection("department_registry").get();
  const byDisplay = new Map();
  const byKey = new Map();
  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const key = data.key || d.id;
    if (data.is_active === false) return;
    byKey.set(String(key).toLowerCase(), key);
    if (data.display_name) {
      byDisplay.set(String(data.display_name).trim().toLowerCase(), key);
    }
    if (Array.isArray(data.aliases)) {
      data.aliases.forEach((a) => {
        if (typeof a === "string") byDisplay.set(a.trim().toLowerCase(), key);
      });
    }
  });
  return { byDisplay, byKey };
}

function mapDepartmentValue(value, registry) {
  if (typeof value !== "string") return null;
  const norm = value.trim().toLowerCase();
  // Already a canonical key
  if (registry.byKey.has(norm)) return registry.byKey.get(norm);
  // Display name / alias
  if (registry.byDisplay.has(norm)) return registry.byDisplay.get(norm);
  return null;
}

function planRuleUpdate(rule, registry) {
  const before = Array.isArray(rule.actions) ? rule.actions : [];
  const planned = [];
  const after = before.map((action) => {
    if (!action || action.target_field !== LEGACY_TARGET_FIELD) {
      return action;
    }
    const mapped = mapDepartmentValue(action.value, registry);
    planned.push({
      original: { target_field: action.target_field, value: action.value },
      mapped_value: mapped,
    });
    if (mapped == null) {
      return action; // leave untouched in dry-run; STOP gate enforces apply abort
    }
    return { ...action, target_field: CANONICAL_TARGET_FIELD, value: mapped };
  });
  return { before, after, planned };
}

async function main() {
  ensureEvidenceDir();
  const projectId = projectGuard();
  const db = admin.firestore();

  const registry = await loadDepartmentRegistry(db);
  const snap = await db.collection("smart_rules").get();

  let scanned = 0;
  let skippedInactive = 0;
  let skippedNonTaxonomy = 0;
  let skippedNoLegacyAction = 0;
  const targets = [];
  const unmapped = [];
  const conditionLegacyConflicts = [];

  snap.docs.forEach((d) => {
    scanned++;
    const data = d.data() || {};
    const isActive = data.is_active !== false;
    if (!isActive) {
      skippedInactive++;
      return;
    }
    const name = typeof data.rule_name === "string" ? data.rule_name : "";
    if (!TAXONOMY_RE.test(name)) {
      skippedNonTaxonomy++;
      return;
    }
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const hasLegacyAction = actions.some(
      (a) => a && a.target_field === LEGACY_TARGET_FIELD
    );
    if (!hasLegacyAction) {
      skippedNoLegacyAction++;
      return;
    }
    // STOP-gate scan: if this rule also has a legacy condition.field, capture it.
    const conditions = Array.isArray(data.conditions) ? data.conditions : [];
    const condLegacy = conditions.filter(
      (c) => c && typeof c.field === "string" && LEGACY_CONDITION_FIELDS.has(c.field)
    );
    if (condLegacy.length) {
      conditionLegacyConflicts.push({
        rule_id: d.id,
        rule_name: name,
        legacy_conditions: condLegacy.map((c) => ({ field: c.field, value: c.value })),
      });
    }
    const plan = planRuleUpdate(data, registry);
    plan.planned.forEach((p) => {
      if (p.mapped_value == null) {
        unmapped.push({
          rule_id: d.id,
          rule_name: name,
          original: p.original,
        });
      }
    });
    targets.push({
      rule_id: d.id,
      rule_name: name,
      version_before: data.version ?? null,
      actions_before: plan.before,
      actions_after: plan.after,
      planned_changes: plan.planned,
    });
  });

  const summary = {
    tally: TALLY,
    mode: APPLY ? "apply" : "dry-run",
    project_id: projectId,
    timestamp: new Date().toISOString(),
    scanned_total: scanned,
    skipped_inactive: skippedInactive,
    skipped_non_taxonomy: skippedNonTaxonomy,
    skipped_no_legacy_action: skippedNoLegacyAction,
    targeted_rules_count: targets.length,
    target_field_mapping: {
      legacy: LEGACY_TARGET_FIELD,
      canonical: CANONICAL_TARGET_FIELD,
    },
    department_value_mapping_summary: (() => {
      const map = {};
      targets.forEach((t) => {
        t.planned_changes.forEach((p) => {
          const k = `${p.original.value} → ${p.mapped_value}`;
          map[k] = (map[k] || 0) + 1;
        });
      });
      return map;
    })(),
    unmapped_values: unmapped,
    legacy_condition_conflicts: conditionLegacyConflicts,
    targets,
    writes_performed: false,
    audit_log_id: null,
  };

  // STOP gates BEFORE apply
  if (APPLY) {
    if (unmapped.length > 0) {
      console.error("STOP: unmapped values present — aborting apply");
      const stopFile = path.join(EVIDENCE_DIR, `stop-unmapped-${tsTag()}.json`);
      fs.writeFileSync(stopFile, JSON.stringify(summary, null, 2));
      console.error("Wrote", stopFile);
      await admin.app().delete();
      process.exit(3);
    }
    if (conditionLegacyConflicts.length > 0) {
      console.error("STOP: target rule(s) also carry legacy condition fields — aborting apply");
      const stopFile = path.join(EVIDENCE_DIR, `stop-condition-conflict-${tsTag()}.json`);
      fs.writeFileSync(stopFile, JSON.stringify(summary, null, 2));
      console.error("Wrote", stopFile);
      await admin.app().delete();
      process.exit(3);
    }
    if (targets.length === 0) {
      // No-op apply — write a verify file and exit cleanly
      const verifyFile = path.join(EVIDENCE_DIR, `apply-noop-${tsTag()}.json`);
      fs.writeFileSync(verifyFile, JSON.stringify(summary, null, 2));
      console.log("APPLY no-op (no targets). Wrote", verifyFile);
      await admin.app().delete();
      return;
    }

    // Apply: re-read each target, re-validate, write only the changed actions array
    const applied = [];
    let auditDocId = null;
    for (const t of targets) {
      const ref = db.collection("smart_rules").doc(t.rule_id);
      const live = await ref.get();
      if (!live.exists) {
        applied.push({ rule_id: t.rule_id, status: "vanished" });
        continue;
      }
      const liveData = live.data() || {};
      const liveActions = Array.isArray(liveData.actions) ? liveData.actions : [];
      const reHasLegacy = liveActions.some(
        (a) => a && a.target_field === LEGACY_TARGET_FIELD
      );
      if (!reHasLegacy) {
        applied.push({ rule_id: t.rule_id, status: "already-migrated" });
        continue;
      }
      const replan = planRuleUpdate(liveData, registry);
      if (replan.planned.some((p) => p.mapped_value == null)) {
        console.error("STOP: re-validation failed unmapped on", t.rule_id);
        await admin.app().delete();
        process.exit(3);
      }
      const newVersion = (typeof liveData.version === "number" ? liveData.version : 0) + 1;
      await ref.update({
        actions: replan.after,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: ACTOR,
        version: newVersion,
      });
      applied.push({
        rule_id: t.rule_id,
        rule_name: t.rule_name,
        version_before: liveData.version ?? null,
        version_after: newVersion,
        actions_before: liveActions,
        actions_after: replan.after,
      });
    }

    // Single summary audit_log entry
    const auditRef = await db.collection("audit_log").add({
      event_type: "smart_rule_taxonomy_department_key_migration",
      tally: TALLY,
      actor_user_id: ACTOR,
      rules_updated_count: applied.filter((a) => a.actions_after).length,
      rule_ids: applied.map((a) => a.rule_id),
      mapping_summary: summary.department_value_mapping_summary,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    auditDocId = auditRef.id;

    summary.writes_performed = true;
    summary.audit_log_id = auditDocId;
    summary.applied = applied;

    // Post-apply verification: re-scan smart_rules and confirm no active
    // Taxonomy rule still has a legacy `department` action target.
    const verifySnap = await db.collection("smart_rules").get();
    const stillLegacy = [];
    verifySnap.docs.forEach((d) => {
      const data = d.data() || {};
      if (data.is_active === false) return;
      const name = typeof data.rule_name === "string" ? data.rule_name : "";
      if (!TAXONOMY_RE.test(name)) return;
      const actions = Array.isArray(data.actions) ? data.actions : [];
      if (actions.some((a) => a && a.target_field === LEGACY_TARGET_FIELD)) {
        stillLegacy.push({ rule_id: d.id, rule_name: name });
      }
    });
    summary.post_apply_remaining_legacy_taxonomy_actions = stillLegacy;

    const applyFile = path.join(EVIDENCE_DIR, `apply-${tsTag()}.json`);
    fs.writeFileSync(applyFile, JSON.stringify(summary, null, 2));
    console.log(
      `APPLY complete. rules_updated=${applied.filter((a) => a.actions_after).length} ` +
        `audit_log_id=${auditDocId} remaining_legacy=${stillLegacy.length}`
    );
    console.log("Wrote", applyFile);

    if (stillLegacy.length > 0) {
      console.error("STOP: post-apply verification failed — remaining legacy actions present");
      await admin.app().delete();
      process.exit(4);
    }
  } else {
    const dryFile = path.join(EVIDENCE_DIR, `dry-run-${tsTag()}.json`);
    fs.writeFileSync(dryFile, JSON.stringify(summary, null, 2));
    console.log(
      `DRY-RUN: scanned=${scanned} targeted=${targets.length} unmapped=${unmapped.length} ` +
        `condition_conflicts=${conditionLegacyConflicts.length}`
    );
    console.log("Wrote", dryFile);
  }

  await admin.app().delete();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
