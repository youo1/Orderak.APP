/**
 * Local JWT verification using `jose` (WebCrypto-based, Workers-compatible).
 *
 * Replaces network round-trips to Google's token verification endpoints with
 * local JWKS-based verification. Falls back to remote verification on JWKS
 * fetch failure — never fails open.
 *
 * Stage 3c of the modernization plan.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Firebase ID tokens
// ---------------------------------------------------------------------------

// NOTE: this is the JWK *key set* endpoint, which is project-independent.
// `https://securetoken.google.com/<project-id>` is the token's `iss` value, NOT
// a JWKS URL — pointing jose at it makes every verification fail.
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
  {
    cacheMaxAge: 3_600_000,       // 1 hour — Firebase rotates keys infrequently
    cooldownDuration: 30_000,     // 30 seconds — cooldown on unknown kid
  },
);

export interface FirebaseTokenClaims {
  aud: string;
  iss: string;
  sub: string;
  exp: number;
  iat: number;
  /**
   * When the user last actually authenticated — the SMS challenge, not the
   * token.
   *
   * Distinct from `iat`, and the distinction is the whole point: the Firebase
   * SDK mints a fresh ID token from a refresh token roughly every hour without
   * the user proving anything, so `iat` is only ever minutes old for any signed
   * in device. `auth_time` does not move until someone completes a real
   * challenge. Anything gating on "was this person just verified" must read
   * this claim; reading `iat` there turns possession of a refresh token into
   * proof of possession of the phone.
   *
   * Optional because it is absent from a token minted by a custom-token or
   * anonymous flow. Callers must treat its absence as "not fresh" rather than
   * substituting `iat`.
   */
  auth_time?: number;
  phone_number?: string;
  [key: string]: unknown;
}

/**
 * Verify a Firebase ID token locally against Firebase's JWK set.
 *
 * Asserts `iss`, `aud`, and `exp` explicitly — missing or incorrect values
 * are authentication bypass risks, not just validation failures.
 *
 * @param firebaseProjectId — your Firebase project ID (e.g. "orderak-app")
 * @returns verified claims on success, null on failure
 */
export async function verifyFirebaseToken(
  token: string,
  firebaseProjectId: string,
): Promise<FirebaseTokenClaims | null> {
  const expectedIss = `https://securetoken.google.com/${firebaseProjectId}`;
  try {
    const { payload } = await jwtVerify<FirebaseTokenClaims>(token, FIREBASE_JWKS, {
      issuer: expectedIss,
      audience: firebaseProjectId,
      algorithms: ["RS256"],
    });
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Google OAuth2 ID tokens
// ---------------------------------------------------------------------------

const GOOGLE_OAUTH_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  {
    cacheMaxAge: 3_600_000,
    cooldownDuration: 30_000,
  },
);

export interface GoogleOAuthClaims {
  aud: string;
  iss: string;
  sub: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  [key: string]: unknown;
}

/**
 * Verify a Google OAuth2 ID token locally.
 *
 * @param clientId — the expected audience (your OAuth client ID)
 * @returns verified claims on success, null on failure
 */
export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
): Promise<GoogleOAuthClaims | null> {
  // Google issues both forms of `iss`; accepting only one rejects valid tokens.
  const expectedIss = ["https://accounts.google.com", "accounts.google.com"];
  try {
    const { payload } = await jwtVerify<GoogleOAuthClaims>(token, GOOGLE_OAUTH_JWKS, {
      issuer: expectedIss,
      audience: clientId,
      algorithms: ["RS256"],
    });
    return payload;
  } catch {
    return null;
  }
}
