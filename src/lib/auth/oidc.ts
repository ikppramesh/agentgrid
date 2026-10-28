import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { z } from "zod";
import { randomToken } from "../crypto";
import { redis } from "../redis";

/**
 * Minimal OpenID Connect (authorization code + PKCE) for per-tenant SSO.
 * Works with any compliant IdP: Google Workspace, Microsoft Entra ID, Okta, Auth0, Keycloak.
 */
const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
});

type Discovery = z.infer<typeof discoverySchema>;

export async function discover(issuer: string): Promise<Discovery> {
  const cacheKey = `oidc:disc:${issuer}`;
  const cached = await redis().get(cacheKey);
  if (cached) return JSON.parse(cached);
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const doc = discoverySchema.parse(await res.json());
  await redis().set(cacheKey, JSON.stringify(doc), "EX", 3600);
  return doc;
}

export interface SsoState {
  tenantId: string;
  verifier: string;
  nonce: string;
}

export async function buildAuthUrl(opts: { issuer: string; clientId: string; redirectUri: string; tenantId: string }) {
  const d = await discover(opts.issuer);
  const state = randomToken(16);
  const verifier = randomToken(32);
  const nonce = randomToken(16);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await redis().set(`oidc:state:${state}`, JSON.stringify({ tenantId: opts.tenantId, verifier, nonce } satisfies SsoState), "EX", 600);
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** One-time state consumption (prevents replay / CSRF on the callback). */
export async function consumeState(state: string): Promise<SsoState | null> {
  const key = `oidc:state:${state}`;
  const raw = await redis().get(key);
  if (!raw) return null;
  await redis().del(key);
  return JSON.parse(raw);
}

export async function exchangeCode(opts: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  verifier: string;
  nonce: string;
}) {
  const d = await discover(opts.issuer);
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code_verifier: opts.verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const { id_token } = z.object({ id_token: z.string() }).parse(await res.json());
  const { payload } = await jwtVerify(id_token, createRemoteJWKSet(new URL(d.jwks_uri)), {
    issuer: d.issuer,
    audience: opts.clientId,
  });
  if (payload.nonce !== opts.nonce) throw new Error("Nonce mismatch");
  const claims = z
    .object({ email: z.string().email(), email_verified: z.boolean().optional(), name: z.string().optional() })
    .parse(payload);
  if (claims.email_verified === false) throw new Error("Email not verified by IdP");
  return claims;
}
