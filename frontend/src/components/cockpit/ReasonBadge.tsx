/**
 * TALLY-146 PR 2 — Cockpit Reason Badges.
 *
 * Marge taxonomy (binding):
 *   Aged Nd         ⏰ amber    days_in_queue > 45
 *   MAP Conflict    ⚠  rose     map_conflict_active === true
 *   Low STR%        📉 orange   str_pct < 20
 *   High GM%        📈 emerald  web_gm_pct > 60
 *   Slow Moving     🐢 slate    is_slow_moving === true
 *   MAP Protected   🔒 blue     is_map_protected === true   (DRAWER-ONLY)
 *
 * Density rules (PO Ratification #2):
 *   - Max 3 visible badges on main card row (Aged/MAP Conflict/Low STR%/High GM%/Slow Moving).
 *   - Overflow → [+N more] chip.
 *   - MAP Protected NEVER renders on main card row — drawer-detail only.
 *
 * Accessibility: icon + label always rendered alongside color (color is not the sole signal).
 */

export type ReasonBadgeKind =
  | "aged"
  | "map_conflict"
  | "low_str"
  | "high_gm"
  | "slow_moving"
  | "map_protected";

interface BadgeDef {
  kind: ReasonBadgeKind;
  icon: string;
  label: (ctx: BadgeContext) => string;
  classes: string;
  predicate: (ctx: BadgeContext) => boolean;
  /** MAP Protected is drawer-only per PO Ratification #2. */
  mainRowEligible: boolean;
}

export interface BadgeContext {
  days_in_queue?: number | null;
  map_conflict_active?: boolean | null;
  str_pct?: number | null;
  web_gm_pct?: number | null;
  is_slow_moving?: boolean | null;
  is_map_protected?: boolean | null;
}

const BADGES: BadgeDef[] = [
  {
    kind: "aged",
    icon: "⏰",
    label: (c) => `Aged ${Number(c.days_in_queue ?? 0)}d`,
    classes: "bg-amber-100 text-amber-800 border-amber-200",
    predicate: (c) => Number(c.days_in_queue ?? 0) > 45,
    mainRowEligible: true,
  },
  {
    kind: "map_conflict",
    icon: "⚠",
    label: () => "MAP Conflict",
    classes: "bg-rose-100 text-rose-800 border-rose-200",
    predicate: (c) => c.map_conflict_active === true,
    mainRowEligible: true,
  },
  {
    kind: "low_str",
    icon: "📉",
    label: () => "Low STR%",
    classes: "bg-orange-100 text-orange-800 border-orange-200",
    predicate: (c) => typeof c.str_pct === "number" && c.str_pct < 20,
    mainRowEligible: true,
  },
  {
    kind: "high_gm",
    icon: "📈",
    label: () => "High GM%",
    classes: "bg-emerald-100 text-emerald-800 border-emerald-200",
    predicate: (c) => typeof c.web_gm_pct === "number" && c.web_gm_pct > 60,
    mainRowEligible: true,
  },
  {
    kind: "slow_moving",
    icon: "🐢",
    label: () => "Slow Moving",
    classes: "bg-slate-100 text-slate-700 border-slate-200",
    predicate: (c) => c.is_slow_moving === true,
    mainRowEligible: true,
  },
  {
    kind: "map_protected",
    icon: "🔒",
    label: () => "MAP Protected",
    classes: "bg-blue-100 text-blue-800 border-blue-200",
    predicate: (c) => c.is_map_protected === true,
    mainRowEligible: false, // DRAWER-ONLY
  },
];

const MAIN_ROW_DENSITY_CAP = 3;

interface Props {
  ctx: BadgeContext;
  /** "main" = main card row (density cap + MAP Protected excluded). "drawer" = no cap, MAP Protected included. */
  surface: "main" | "drawer";
  className?: string;
}

function renderBadge(b: BadgeDef, ctx: BadgeContext, key: string) {
  return (
    <span
      key={key}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium ${b.classes}`}
      aria-label={b.label(ctx)}
      role="status"
    >
      <span aria-hidden="true">{b.icon}</span>
      <span>{b.label(ctx)}</span>
    </span>
  );
}

export default function ReasonBadges({ ctx, surface, className }: Props) {
  const eligible = BADGES.filter(
    (b) => (surface === "drawer" ? true : b.mainRowEligible) && b.predicate(ctx),
  );

  if (eligible.length === 0) return null;

  if (surface === "drawer") {
    return (
      <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
        {eligible.map((b) => renderBadge(b, ctx, b.kind))}
      </div>
    );
  }

  // main row — density cap of 3, overflow chip
  const visible = eligible.slice(0, MAIN_ROW_DENSITY_CAP);
  const overflow = eligible.length - visible.length;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {visible.map((b) => renderBadge(b, ctx, b.kind))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200 text-[11px] font-medium"
          aria-label={`${overflow} more reason badges`}
        >
          +{overflow} more
        </span>
      )}
    </div>
  );
}
