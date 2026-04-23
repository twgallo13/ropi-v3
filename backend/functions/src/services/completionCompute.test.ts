/**
 * Unit tests for services/completionCompute.ts (TALLY-P1).
 *
 * Pure functions only — no Firestore mocking.
 *
 * Run: cd backend/functions && npx tsc && \
 *      node lib/services/completionCompute.test.js
 */
import {
  getRequiredFieldKeysPure,
  computeCompletionProgressPure,
  buildNextActionHintPure,
  stampCompletionOnProduct,
  RequiredField,
  AttributeValueLike,
  CompletionResult,
} from "./completionCompute";

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
    failed++;
  }
}

// ────────────────────────────────────────────────
//  Fixtures
// ────────────────────────────────────────────────

const REQUIRED: RequiredField[] = [
  { field_key: "department",  display_label: "Department" },
  { field_key: "name",        display_label: "Product Name" },
  { field_key: "color",       display_label: "Color" },
];

function av(
  id: string,
  value: unknown,
  verification_state: string | null,
  origin_type: string | null
): AttributeValueLike {
  return { id, value, verification_state, origin_type };
}

// ────────────────────────────────────────────────
//  Scenarios
// ────────────────────────────────────────────────

console.log("computeCompletion (pure)");

// 1. 0 blockers (fully complete) → 100% / 0 / 0 / ""
{
  const avs: AttributeValueLike[] = [
    av("department", "Mens",   "Human-Verified", "Human"),
    av("name",       "Sneaker","Human-Verified", "Human"),
    av("color",      "Red",    "Rule-Verified",  "System"),
  ];
  const inner = computeCompletionProgressPure(REQUIRED, avs);
  const hint = buildNextActionHintPure(inner, REQUIRED);
  assert("1a fully complete percent",   inner.percent, 100);
  assert("1b fully complete missing",   inner.missing, []);
  assert("1c fully complete ai_blockers", inner.ai_blockers, []);
  assert("1d fully complete hint",      hint, "");
}

// 2. All AI blockers → ai_blocker_count > 0; hint starts with "Approve AI content:"
{
  const avs: AttributeValueLike[] = [
    av("department",         "Mens",          "Human-Verified", "Human"),
    av("name",               "Sneaker",       "Human-Verified", "Human"),
    av("color",              "Red",           "Human-Verified", "Human"),
    av("ai_seo_title",       "Awesome Shoe",  "Pending",        "AI"),
    av("ai_seo_meta",        "Buy now",       "Pending",        "AI"),
  ];
  const inner = computeCompletionProgressPure(REQUIRED, avs);
  const hint = buildNextActionHintPure(inner, REQUIRED);
  assert("2a all-AI percent",        inner.percent, 100);
  assert("2b all-AI ai_blockers cnt", inner.ai_blockers.length, 2);
  assert("2c all-AI hint prefix",    hint.startsWith("Approve AI content:"), true);
}

// 3. All manual blockers → ai_blocker_count: 0; hint starts with "Fill"
{
  const avs: AttributeValueLike[] = [
    av("department", "Mens", "Human-Verified", "Human"),
    // name + color missing
  ];
  const inner = computeCompletionProgressPure(REQUIRED, avs);
  const hint = buildNextActionHintPure(inner, REQUIRED);
  assert("3a manual ai_blockers", inner.ai_blockers.length, 0);
  assert("3b manual hint prefix", hint.startsWith("Fill"), true);
}

// 4. Mixed AI + manual → hint prioritizes AI
{
  const avs: AttributeValueLike[] = [
    av("department",   "Mens",      "Human-Verified", "Human"),
    // name missing — manual blocker
    av("color",        "Red",       "Human-Verified", "Human"),
    av("ai_seo_title", "Awesome",   "Pending",        "AI"),
  ];
  const inner = computeCompletionProgressPure(REQUIRED, avs);
  const hint = buildNextActionHintPure(inner, REQUIRED);
  assert("4a mixed ai_blockers cnt", inner.ai_blockers.length, 1);
  assert("4b mixed missing cnt",     inner.missing.length, 1);
  assert("4c mixed hint = AI first", hint, "Approve AI content: ai_seo_title");
}

// 5. Newly-imported (minimal fields) → low percent; hint actionable
{
  const avs: AttributeValueLike[] = [
    av("department", "Mens", "Human-Verified", "Human"),
  ];
  const inner = computeCompletionProgressPure(REQUIRED, avs);
  const hint = buildNextActionHintPure(inner, REQUIRED);
  assert("5a newly percent (1/3 → 33)", inner.percent, 33);
  assert("5b newly hint actionable",    hint.length > 0, true);
}

// 6. Optional fields missing but required complete → 100%
{
  const avs: AttributeValueLike[] = [
    av("department", "Mens",    "Human-Verified", "Human"),
    av("name",       "Sneaker", "Human-Verified", "Human"),
    av("color",      "Red",     "Human-Verified", "Human"),
    // optional fields like keywords, etc. not present at all
  ];
  const inner = computeCompletionProgressPure(REQUIRED, avs);
  assert("6a optional-missing percent",   inner.percent, 100);
  assert("6b optional-missing blocker_ct", inner.missing.length, 0);
}

// 7. Required fields missing → percent reflects gap; hint actionable
{
  const avs: AttributeValueLike[] = [
    av("department", "Mens", "Human-Verified", "Human"),
    av("name",       "",     "Human-Verified", "Human"), // empty value
    // color missing entirely
  ];
  const inner = computeCompletionProgressPure(REQUIRED, avs);
  const hint = buildNextActionHintPure(inner, REQUIRED);
  assert("7a partial percent (1/3 → 33)", inner.percent, 33);
  assert("7b partial blocker_ct",         inner.missing.length, 2);
  assert("7c partial hint actionable",    hint.startsWith("Fill"), true);
}

// 8. Pure inner decoupling: identical inputs → identical outputs.
//    Verifies the pure function never reads from any external state.
{
  const avs: AttributeValueLike[] = [
    av("department",   "Mens",      "Human-Verified", "Human"),
    av("ai_seo_title", "Title v1",  "Pending",        "AI"),
  ];
  const a = computeCompletionProgressPure(REQUIRED, avs);
  const b = computeCompletionProgressPure(REQUIRED, avs);
  assert("8 pure-inner deterministic", a, b);
}

// 9. stampCompletionOnProduct writes exactly the 5 fields with merge:true.
{
  const calls: Array<{ payload: any; opts: any }> = [];
  const fakeRef = {
    set: (payload: any, opts: any) => {
      calls.push({ payload, opts });
      return Promise.resolve();
    },
  } as any;

  const result: CompletionResult = {
    completion_percent: 67,
    blocker_count: 1,
    ai_blocker_count: 0,
    next_action_hint: "Fill Color",
    // sentinel value for the test only — not a real FieldValue
    completion_last_computed_at: ("__SENTINEL__" as unknown) as any,
  };

  stampCompletionOnProduct(fakeRef, result).then(() => {
    assert("9a stamp called once",        calls.length, 1);
    assert("9b stamp uses merge:true",    calls[0].opts, { merge: true });
    assert("9c stamp payload keys",
      Object.keys(calls[0].payload).sort(),
      [
        "ai_blocker_count",
        "blocker_count",
        "completion_last_computed_at",
        "completion_percent",
        "next_action_hint",
      ]
    );
    assert("9d stamp payload values",
      {
        completion_percent: calls[0].payload.completion_percent,
        blocker_count: calls[0].payload.blocker_count,
        ai_blocker_count: calls[0].payload.ai_blocker_count,
        next_action_hint: calls[0].payload.next_action_hint,
        completion_last_computed_at: calls[0].payload.completion_last_computed_at,
      },
      {
        completion_percent: 67,
        blocker_count: 1,
        ai_blocker_count: 0,
        next_action_hint: "Fill Color",
        completion_last_computed_at: "__SENTINEL__",
      }
    );

    // Bonus: getRequiredFieldKeysPure smoke test (tied to scenario 5/9 family)
    const fakeRegSnap = {
      docs: [
        { id: "department", data: () => ({ display_label: "Department" }) },
        { id: "name",       data: () => ({}) },
      ],
    };
    const required = getRequiredFieldKeysPure(fakeRegSnap);
    assert(
      "10 getRequiredFieldKeysPure",
      required,
      [
        { field_key: "department", display_label: "Department" },
        { field_key: "name",       display_label: "name" },
      ]
    );

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });
}
