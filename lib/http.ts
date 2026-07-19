import { getSocialConfig } from "./config";

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export async function readJson(response: Response): Promise<any> { return response.json().catch(() => ({})); }

export function redactSecrets(message: string): string {
  let safe = message;
  const config = getSocialConfig();
  for (const secret of [config.autoPublishSecret, config.facebookPageAccessToken, config.instagramAccessToken, config.linkedInAccessToken, config.xApiKey, config.xApiSecret, config.xAccessToken, config.xAccessTokenSecret]) {
    if (secret) safe = safe.split(secret).join("[REDACTED]");
  }
  return safe.replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [REDACTED]").slice(0, 500);
}

export function providerError(provider: string, response: Response, payload: any): Error {
  const message = typeof payload?.error?.message === "string" ? payload.error.message : typeof payload?.message === "string" ? payload.message : `HTTP ${response.status}`;
  return new Error(`${provider}: ${redactSecrets(message)}`);
}
