import jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";

// Verifies a "Sign in with Apple" identity token per Apple's spec:
// https://developer.apple.com/documentation/sign_in_with_apple/verifying_a_user
//
// Deliberately hand-rolled (native fetch + jwk-to-pem) instead of using the
// jwks-rsa package: jwks-rsa v4 pulls in `jose`, which ships ESM-only and
// breaks under Jest's default CJS transform. This is a small enough amount
// of logic that avoiding the dependency headache was the simpler call.
//
// The JWKS URL and expected audience are both overridable via env vars so
// tests can point this at a fake key set instead of Apple's real servers —
// the verification *logic* (signature, issuer, audience, expiry) is exactly
// what runs in production; only the source of the public key changes.
const JWKS_URL = process.env.APPLE_JWKS_URL || "https://appleid.apple.com/auth/keys";
const EXPECTED_ISSUER = process.env.APPLE_ISSUER || "https://appleid.apple.com";
const JWKS_CACHE_MS = 60 * 60 * 1000; // 1 hour, matches Apple's own key-rotation guidance

function getAudiences(): [string, ...string[]] {
  // Accept either the iOS app's bundle ID (native Sign in with Apple) or a
  // Services ID (web-based flow), whichever is configured.
  const raw = process.env.APPLE_AUDIENCE || "com.fairshareai.app";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? (list as [string, ...string[]]) : ["com.fairshareai.app"];
}

interface Jwk {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

let cachedKeys: Jwk[] | null = null;
let cachedAt = 0;

// Exposed only for tests: lets a test point this module at a local fake JWKS
// document without doing real HTTP, and lets each test start from a clean
// cache.
export function __resetJwksCacheForTests() {
  cachedKeys = null;
  cachedAt = 0;
}
export function __setJwksFetcherForTests(fetcher: (() => Promise<{ keys: Jwk[] }>) | null) {
  testFetcher = fetcher;
}
let testFetcher: (() => Promise<{ keys: Jwk[] }>) | null = null;

async function getJwks(): Promise<Jwk[]> {
  const now = Date.now();
  if (cachedKeys && now - cachedAt < JWKS_CACHE_MS) return cachedKeys;

  const body = testFetcher
    ? await testFetcher()
    : await (async () => {
        const res = await fetch(JWKS_URL);
        if (!res.ok) throw new AppleTokenError(`Failed to fetch Apple's signing keys (HTTP ${res.status})`);
        return (await res.json()) as { keys: Jwk[] };
      })();

  cachedKeys = body.keys;
  cachedAt = now;
  return cachedKeys;
}

export interface AppleTokenClaims {
  sub: string; // stable unique Apple user id for this app
  email?: string;
  emailVerified?: boolean;
  isPrivateEmail?: boolean;
}

export class AppleTokenError extends Error {}

export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleTokenClaims> {
  const decodedHeader = jwt.decode(identityToken, { complete: true })?.header;
  if (!decodedHeader?.kid) throw new AppleTokenError("Malformed Apple identity token (missing kid)");

  let keys: Jwk[];
  try {
    keys = await getJwks();
  } catch (e) {
    throw e instanceof AppleTokenError ? e : new AppleTokenError("Could not fetch Apple's signing keys");
  }

  const matchingKey = keys.find((k) => k.kid === decodedHeader.kid);
  if (!matchingKey) throw new AppleTokenError("No matching Apple signing key found for this token");

  let pem: string;
  try {
    pem = jwkToPem({ kty: "RSA", n: matchingKey.n, e: matchingKey.e });
  } catch {
    throw new AppleTokenError("Could not convert Apple's signing key");
  }

  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(identityToken, pem, {
      algorithms: ["RS256"],
      issuer: EXPECTED_ISSUER,
      audience: getAudiences(),
    });
    if (typeof decoded === "string") throw new Error("unexpected string payload");
    payload = decoded;
  } catch (e) {
    throw new AppleTokenError(e instanceof Error ? e.message : "Invalid Apple identity token");
  }

  const claims = payload as jwt.JwtPayload & {
    email?: string;
    email_verified?: boolean | string;
    is_private_email?: boolean | string;
  };
  if (!claims.sub) throw new AppleTokenError("Apple token missing sub claim");

  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    isPrivateEmail: claims.is_private_email === true || claims.is_private_email === "true",
  };
}
