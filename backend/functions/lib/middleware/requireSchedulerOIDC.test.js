"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for requireSchedulerOIDC middleware.
 *
 * Run:
 *   cd backend/functions && npx tsc && \
 *     node lib/middleware/requireSchedulerOIDC.test.js
 *
 * Mirrors the project's existing test pattern (plain ts/node, no framework).
 */
const requireSchedulerOIDC_1 = require("./requireSchedulerOIDC");
const EXPECTED_AUDIENCE = "https://ropi-aoss-api-test.example.com";
const EXPECTED_EMAIL = "scheduler-invoker@ropi-aoss-dev.iam.gserviceaccount.com";
let passed = 0;
let failed = 0;
function assert(label, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        passed++;
    }
    else {
        console.error(`  ✗ ${label}${detail ? `\n    ${detail}` : ""}`);
        failed++;
    }
}
function mkRes() {
    const r = {
        statusCode: 0,
        body: undefined,
        status(c) {
            this.statusCode = c;
            return this;
        },
        json(b) {
            this.body = b;
            return this;
        },
    };
    return r;
}
function mkReq(authHeader) {
    return { headers: authHeader ? { authorization: authHeader } : {} };
}
async function run(req) {
    const res = mkRes();
    let nextCalled = false;
    await (0, requireSchedulerOIDC_1.requireSchedulerOIDC)(req, res, () => {
        nextCalled = true;
    });
    return { res, nextCalled };
}
function validPayload(overrides = {}) {
    return {
        iss: "https://accounts.google.com",
        aud: EXPECTED_AUDIENCE,
        sub: "110405435248849987715",
        email: EXPECTED_EMAIL,
        email_verified: true,
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 600,
        ...overrides,
    };
}
async function main() {
    // Set required env vars before importing/using middleware.
    process.env.SCHEDULER_OIDC_AUDIENCE = EXPECTED_AUDIENCE;
    process.env.SCHEDULER_OIDC_INVOKER_EMAIL = EXPECTED_EMAIL;
    console.log("requireSchedulerOIDC()");
    // ── 1. Missing Authorization header → 401 ──
    {
        (0, requireSchedulerOIDC_1.__resetVerifierForTest)();
        const { res, nextCalled } = await run(mkReq());
        assert("missing Authorization header → 401", res.statusCode === 401);
        assert("missing header → SCHEDULER_OIDC_REJECTED code", res.body?.code === requireSchedulerOIDC_1.SCHEDULER_OIDC_REJECTED);
        assert("missing header → next() not called", !nextCalled);
    }
    // ── 2. Invalid token signature → 401 ──
    {
        (0, requireSchedulerOIDC_1.__setVerifierForTest)(async () => {
            throw new Error("Invalid token signature");
        });
        const { res, nextCalled } = await run(mkReq("Bearer not.a.real.token"));
        assert("invalid signature → 401", res.statusCode === 401);
        assert("invalid signature → SCHEDULER_OIDC_REJECTED", res.body?.code === requireSchedulerOIDC_1.SCHEDULER_OIDC_REJECTED);
        assert("invalid signature → next() not called", !nextCalled);
    }
    // ── 3. Wrong audience claim → 401 ──
    {
        (0, requireSchedulerOIDC_1.__setVerifierForTest)(async () => validPayload({ aud: "https://some-other-service.example.com" }));
        const { res, nextCalled } = await run(mkReq("Bearer fake.but.passes.signature"));
        assert("wrong audience → 401", res.statusCode === 401);
        assert("wrong audience → SCHEDULER_OIDC_REJECTED", res.body?.code === requireSchedulerOIDC_1.SCHEDULER_OIDC_REJECTED);
        assert("wrong audience → next() not called", !nextCalled);
    }
    // ── 4. Wrong email claim → 401 ──
    {
        (0, requireSchedulerOIDC_1.__setVerifierForTest)(async () => validPayload({ email: "attacker@evil.example.com" }));
        const { res, nextCalled } = await run(mkReq("Bearer fake.but.passes.signature"));
        assert("wrong email → 401", res.statusCode === 401);
        assert("wrong email → SCHEDULER_OIDC_REJECTED", res.body?.code === requireSchedulerOIDC_1.SCHEDULER_OIDC_REJECTED);
        assert("wrong email → next() not called", !nextCalled);
    }
    // ── 5. email_verified=false → 401 ──
    {
        (0, requireSchedulerOIDC_1.__setVerifierForTest)(async () => validPayload({ email_verified: false }));
        const { res, nextCalled } = await run(mkReq("Bearer fake.but.passes.signature"));
        assert("email_verified=false → 401", res.statusCode === 401);
        assert("email_verified=false → SCHEDULER_OIDC_REJECTED", res.body?.code === requireSchedulerOIDC_1.SCHEDULER_OIDC_REJECTED);
        assert("email_verified=false → next() not called", !nextCalled);
    }
    // ── 6. Valid OIDC token from scheduler-invoker SA → next() called, no 401 ──
    {
        (0, requireSchedulerOIDC_1.__setVerifierForTest)(async () => validPayload());
        const { res, nextCalled } = await run(mkReq("Bearer valid.scheduler.token"));
        assert("valid token → next() called", nextCalled);
        assert("valid token → no status set by middleware", res.statusCode === 0);
        assert("valid token → no 401 body", res.body === undefined);
    }
    (0, requireSchedulerOIDC_1.__resetVerifierForTest)();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0)
        process.exit(1);
}
main().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(2);
});
//# sourceMappingURL=requireSchedulerOIDC.test.js.map