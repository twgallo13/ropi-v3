"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULER_OIDC_REJECTED = void 0;
exports.__setVerifierForTest = __setVerifierForTest;
exports.__resetVerifierForTest = __resetVerifierForTest;
exports.requireSchedulerOIDC = requireSchedulerOIDC;
const google_auth_library_1 = require("google-auth-library");
exports.SCHEDULER_OIDC_REJECTED = "SCHEDULER_OIDC_REJECTED";
/**
 * Expected OIDC claim values. Sourced from environment so the middleware can
 * be reused across dev/staging/prod without code change.
 *
 *   SCHEDULER_OIDC_AUDIENCE             — exact Cloud Run service URL
 *   SCHEDULER_OIDC_INVOKER_EMAIL        — exact SA email
 */
function getExpectedAudience() {
    const v = process.env.SCHEDULER_OIDC_AUDIENCE;
    if (!v || v.length === 0) {
        throw new Error("requireSchedulerOIDC: SCHEDULER_OIDC_AUDIENCE env var is not set. " +
            "This must equal the Cloud Run service URL exactly.");
    }
    return v;
}
function getExpectedInvokerEmail() {
    const v = process.env.SCHEDULER_OIDC_INVOKER_EMAIL;
    if (!v || v.length === 0) {
        throw new Error("requireSchedulerOIDC: SCHEDULER_OIDC_INVOKER_EMAIL env var is not set. " +
            "This must equal the scheduler-invoker service account email exactly.");
    }
    return v;
}
let verifier = defaultVerifier;
const oauthClient = new google_auth_library_1.OAuth2Client();
async function defaultVerifier(idToken, audience) {
    const ticket = await oauthClient.verifyIdToken({
        idToken,
        audience,
    });
    return ticket.getPayload();
}
/**
 * TEST-ONLY hook to swap the verifier. Production callers MUST NOT use this.
 * Always reset via __resetVerifierForTest() in test teardown.
 */
function __setVerifierForTest(v) {
    verifier = v;
}
function __resetVerifierForTest() {
    verifier = defaultVerifier;
}
function reject(res, outcome) {
    // Log only the stable outcome label. Never the token, never claim values.
    console.warn(`requireSchedulerOIDC: ${exports.SCHEDULER_OIDC_REJECTED} (${outcome})`);
    res.status(401).json({
        code: exports.SCHEDULER_OIDC_REJECTED,
        error: "Unauthorized.",
    });
}
async function requireSchedulerOIDC(req, res, next) {
    // Step 1: header presence + Bearer prefix
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        reject(res, "missing_bearer");
        return;
    }
    const idToken = authHeader.slice("Bearer ".length).trim();
    if (idToken.length === 0) {
        reject(res, "empty_bearer");
        return;
    }
    // Resolve expected claim values once per request. Misconfigured env is a
    // hard 401 here (rather than 500) so a deploy with missing env vars cannot
    // accidentally accept anything.
    let expectedAudience;
    let expectedEmail;
    try {
        expectedAudience = getExpectedAudience();
        expectedEmail = getExpectedInvokerEmail();
    }
    catch (envErr) {
        console.error(`requireSchedulerOIDC: env misconfiguration — ${envErr.message}`);
        reject(res, "env_misconfigured");
        return;
    }
    // Step 2 + 3: signature + audience are both validated by verifyIdToken.
    let payload;
    try {
        payload = await verifier(idToken, expectedAudience);
    }
    catch (_verifyErr) {
        reject(res, "signature_or_audience");
        return;
    }
    if (!payload) {
        reject(res, "no_payload");
        return;
    }
    // Defense-in-depth: re-check `aud` ourselves. verifyIdToken already does
    // this, but if a future library version relaxes that check we don't want
    // to silently lose protection.
    const aud = payload.aud;
    if (typeof aud !== "string" || aud !== expectedAudience) {
        reject(res, "audience");
        return;
    }
    // Step 4: email claim
    if (typeof payload.email !== "string" || payload.email !== expectedEmail) {
        reject(res, "email");
        return;
    }
    // Step 5: email_verified must be strictly true
    if (payload.email_verified !== true) {
        reject(res, "email_unverified");
        return;
    }
    // Verified. No request mutation, no logging of token contents.
    next();
}
exports.default = requireSchedulerOIDC;
//# sourceMappingURL=requireSchedulerOIDC.js.map