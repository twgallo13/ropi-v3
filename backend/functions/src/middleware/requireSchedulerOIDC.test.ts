/**
 * Unit tests for requireSchedulerOIDC middleware.
 *
 * Run:
 *   cd backend/functions && npx tsc && \
 *     node lib/middleware/requireSchedulerOIDC.test.js
 *
 * Mirrors the project's existing test pattern (plain ts/node, no framework).
 */
import {
  requireSchedulerOIDC,
  __setVerifierForTest,
  __resetVerifierForTest,
  SCHEDULER_OIDC_REJECTED,
} from "./requireSchedulerOIDC";
import type { TokenPayload } from "google-auth-library";

const EXPECTED_AUDIENCE = "https://ropi-aoss-api-test.example.com";
const EXPECTED_EMAIL = "scheduler-invoker@ropi-aoss-dev.iam.gserviceaccount.com";

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `\n    ${detail}` : ""}`);
    failed++;
  }
}

interface FakeRes {
  statusCode: number;
  body: any;
  status(c: number): FakeRes;
  json(b: any): FakeRes;
}

function mkRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 0,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
  };
  return r;
}

function mkReq(authHeader?: string): any {
  return { headers: authHeader ? { authorization: authHeader } : {} };
}

async function run(req: any): Promise<{ res: FakeRes; nextCalled: boolean }> {
  const res = mkRes();
  let nextCalled = false;
  await requireSchedulerOIDC(req as any, res as any, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

function validPayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    iss: "https://accounts.google.com",
    aud: EXPECTED_AUDIENCE,
    sub: "110405435248849987715",
    email: EXPECTED_EMAIL,
    email_verified: true,
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  } as TokenPayload;
}

async function main(): Promise<void> {
  // Set required env vars before importing/using middleware.
  process.env.SCHEDULER_OIDC_AUDIENCE = EXPECTED_AUDIENCE;
  process.env.SCHEDULER_OIDC_INVOKER_EMAIL = EXPECTED_EMAIL;

  console.log("requireSchedulerOIDC()");

  // ── 1. Missing Authorization header → 401 ──
  {
    __resetVerifierForTest();
    const { res, nextCalled } = await run(mkReq());
    assert("missing Authorization header → 401", res.statusCode === 401);
    assert(
      "missing header → SCHEDULER_OIDC_REJECTED code",
      res.body?.code === SCHEDULER_OIDC_REJECTED
    );
    assert("missing header → next() not called", !nextCalled);
  }

  // ── 2. Invalid token signature → 401 ──
  {
    __setVerifierForTest(async () => {
      throw new Error("Invalid token signature");
    });
    const { res, nextCalled } = await run(mkReq("Bearer not.a.real.token"));
    assert("invalid signature → 401", res.statusCode === 401);
    assert(
      "invalid signature → SCHEDULER_OIDC_REJECTED",
      res.body?.code === SCHEDULER_OIDC_REJECTED
    );
    assert("invalid signature → next() not called", !nextCalled);
  }

  // ── 3. Wrong audience claim → 401 ──
  {
    __setVerifierForTest(async () =>
      validPayload({ aud: "https://some-other-service.example.com" })
    );
    const { res, nextCalled } = await run(mkReq("Bearer fake.but.passes.signature"));
    assert("wrong audience → 401", res.statusCode === 401);
    assert(
      "wrong audience → SCHEDULER_OIDC_REJECTED",
      res.body?.code === SCHEDULER_OIDC_REJECTED
    );
    assert("wrong audience → next() not called", !nextCalled);
  }

  // ── 4. Wrong email claim → 401 ──
  {
    __setVerifierForTest(async () =>
      validPayload({ email: "attacker@evil.example.com" })
    );
    const { res, nextCalled } = await run(mkReq("Bearer fake.but.passes.signature"));
    assert("wrong email → 401", res.statusCode === 401);
    assert(
      "wrong email → SCHEDULER_OIDC_REJECTED",
      res.body?.code === SCHEDULER_OIDC_REJECTED
    );
    assert("wrong email → next() not called", !nextCalled);
  }

  // ── 5. email_verified=false → 401 ──
  {
    __setVerifierForTest(async () => validPayload({ email_verified: false }));
    const { res, nextCalled } = await run(mkReq("Bearer fake.but.passes.signature"));
    assert("email_verified=false → 401", res.statusCode === 401);
    assert(
      "email_verified=false → SCHEDULER_OIDC_REJECTED",
      res.body?.code === SCHEDULER_OIDC_REJECTED
    );
    assert("email_verified=false → next() not called", !nextCalled);
  }

  // ── 6. Valid OIDC token from scheduler-invoker SA → next() called, no 401 ──
  {
    __setVerifierForTest(async () => validPayload());
    const { res, nextCalled } = await run(mkReq("Bearer valid.scheduler.token"));
    assert("valid token → next() called", nextCalled);
    assert("valid token → no status set by middleware", res.statusCode === 0);
    assert("valid token → no 401 body", res.body === undefined);
  }

  __resetVerifierForTest();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(2);
});
