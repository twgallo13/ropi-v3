/**
 * requireSchedulerOIDC — TALLY-DEPLOY-BACKFILL Phase 2
 *
 * Express middleware that gates /api/v1/internal/jobs/* by verifying a Google-
 * issued OIDC ID token minted by the Cloud Scheduler invoker service account.
 *
 * Verification order (per PO ruling 2026-04-23, all required, no soft-fail,
 * no env bypass):
 *
 *   1. Authorization header is present and starts with "Bearer ".
 *   2. The bearer token is a valid Google-issued OIDC token (signature
 *      verified against Google's published JWKS by google-auth-library).
 *   3. Token's `aud` claim equals the Cloud Run service URL exactly.
 *   4. Token's `email` claim equals
 *      scheduler-invoker@ropi-aoss-dev.iam.gserviceaccount.com exactly.
 *   5. Token's `email_verified` claim is true.
 *
 * On any failure: respond 401 with body
 *   { code: "SCHEDULER_OIDC_REJECTED", error: "Unauthorized." }
 * Generic body — does NOT leak which check failed. Server log records only
 * the verification outcome and stable error code, never token contents.
 *
 * This middleware is the ONLY barrier between the public internet and the
 * internal jobs routes. Treat as security-critical.
 */
import { Request, Response, NextFunction } from "express";
import { OAuth2Client, type LoginTicket, type TokenPayload } from "google-auth-library";

export const SCHEDULER_OIDC_REJECTED = "SCHEDULER_OIDC_REJECTED";

/**
 * Expected OIDC claim values. Sourced from environment so the middleware can
 * be reused across dev/staging/prod without code change.
 *
 *   SCHEDULER_OIDC_AUDIENCE             — exact Cloud Run service URL
 *   SCHEDULER_OIDC_INVOKER_EMAIL        — exact SA email
 */
function getExpectedAudience(): string {
  const v = process.env.SCHEDULER_OIDC_AUDIENCE;
  if (!v || v.length === 0) {
    throw new Error(
      "requireSchedulerOIDC: SCHEDULER_OIDC_AUDIENCE env var is not set. " +
        "This must equal the Cloud Run service URL exactly."
    );
  }
  return v;
}

function getExpectedInvokerEmail(): string {
  const v = process.env.SCHEDULER_OIDC_INVOKER_EMAIL;
  if (!v || v.length === 0) {
    throw new Error(
      "requireSchedulerOIDC: SCHEDULER_OIDC_INVOKER_EMAIL env var is not set. " +
        "This must equal the scheduler-invoker service account email exactly."
    );
  }
  return v;
}

/**
 * Token verifier signature. Returning a TokenPayload means the token's
 * signature, expiry, and audience were validated by google-auth-library.
 * Throwing means verification failed.
 */
export type TokenVerifier = (idToken: string, audience: string) => Promise<TokenPayload | undefined>;

let verifier: TokenVerifier = defaultVerifier;
const oauthClient = new OAuth2Client();

async function defaultVerifier(idToken: string, audience: string): Promise<TokenPayload | undefined> {
  const ticket: LoginTicket = await oauthClient.verifyIdToken({
    idToken,
    audience,
  });
  return ticket.getPayload();
}

/**
 * TEST-ONLY hook to swap the verifier. Production callers MUST NOT use this.
 * Always reset via __resetVerifierForTest() in test teardown.
 */
export function __setVerifierForTest(v: TokenVerifier): void {
  verifier = v;
}
export function __resetVerifierForTest(): void {
  verifier = defaultVerifier;
}

function reject(res: Response, outcome: string): void {
  // Log only the stable outcome label. Never the token, never claim values.
  console.warn(`requireSchedulerOIDC: ${SCHEDULER_OIDC_REJECTED} (${outcome})`);
  res.status(401).json({
    code: SCHEDULER_OIDC_REJECTED,
    error: "Unauthorized.",
  });
}

export async function requireSchedulerOIDC(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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
  let expectedAudience: string;
  let expectedEmail: string;
  try {
    expectedAudience = getExpectedAudience();
    expectedEmail = getExpectedInvokerEmail();
  } catch (envErr: any) {
    console.error(`requireSchedulerOIDC: env misconfiguration — ${envErr.message}`);
    reject(res, "env_misconfigured");
    return;
  }

  // Step 2 + 3: signature + audience are both validated by verifyIdToken.
  let payload: TokenPayload | undefined;
  try {
    payload = await verifier(idToken, expectedAudience);
  } catch (_verifyErr: any) {
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

export default requireSchedulerOIDC;
