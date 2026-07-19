import crypto from "node:crypto";
import { getSocialConfig } from "./config";

export const socialSessionCookie = "cliff_social_session";
const localSessionSecret = crypto.randomBytes(32).toString("hex");

function secret(): string { return getSocialConfig().autoPublishSecret || localSessionSecret; }
function encode(value: string): string { return Buffer.from(value).toString("base64url"); }
function sign(value: string): string { return crypto.createHmac("sha256", secret()).update(value).digest("base64url"); }
function validSignature(value: string, signature: string): boolean { const expected = sign(value); return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); }

export function canIssueBrowserSession(): boolean { const config = getSocialConfig(); return Boolean(config.autoPublishSecret || (process.env.NODE_ENV !== "production" && config.dryRun)); }
export function createBrowserSession(): string { const payload = encode(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 })); return `${payload}.${sign(payload)}`; }

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (request.headers.get("host") || ""); }
  catch { return false; }
}

export function isAuthorized(request: Request): boolean {
  const config = getSocialConfig();
  const authorization = request.headers.get("authorization") || "";
  if (config.autoPublishSecret && authorization.startsWith("Bearer ")) {
    const supplied = authorization.slice("Bearer ".length).trim();
    return supplied.length === config.autoPublishSecret.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(config.autoPublishSecret));
  }
  if (!sameOrigin(request)) return false;
  const cookieHeader = request.headers.get("cookie") || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${socialSessionCookie}=`))?.slice(socialSessionCookie.length + 1);
  if (!cookie) return false;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || !validSignature(payload, signature)) return false;
  try { return Number(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).exp) > Date.now(); }
  catch { return false; }
}
