import { getSocialConfig } from "./config";
import { fetchWithTimeout, providerError, readJson } from "./http";

interface FacebookAccount {
  id?: unknown;
  name?: unknown;
  tasks?: unknown;
  access_token?: unknown;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Facebook: ${label} is missing or malformed`);
  return value.trim();
}

async function resolveFacebookPageAccessToken(pageId: string, configuredToken: string): Promise<string> {
  const config = getSocialConfig();
  const meResponse = await fetchWithTimeout(`https://graph.facebook.com/${config.metaGraphApiVersion}/me?fields=id,name&access_token=${encodeURIComponent(configuredToken)}`, {}, 15000);
  const me = await readJson(meResponse);
  if (!meResponse.ok) throw providerError("Facebook token check", meResponse, me);

  console.log("[Facebook] Token subject", { id: me?.id, name: me?.name, expectedPageId: pageId, isPageToken: me?.id === pageId });
  if (me?.id === pageId) return configuredToken;

  const accountsResponse = await fetchWithTimeout(`https://graph.facebook.com/${config.metaGraphApiVersion}/me/accounts?fields=id,name,tasks,access_token&access_token=${encodeURIComponent(configuredToken)}`, {}, 20000);
  const accounts = await readJson(accountsResponse);
  if (!accountsResponse.ok) throw providerError("Facebook page token lookup", accountsResponse, accounts);

  const page = Array.isArray(accounts?.data) ? accounts.data.find((account: FacebookAccount) => account?.id === pageId) as FacebookAccount | undefined : undefined;
  console.log("[Facebook] Page token lookup", { found: Boolean(page), pageId, pageName: page?.name, tasks: page?.tasks, hasAccessToken: typeof page?.access_token === "string" });
  if (!page) throw new Error(`Facebook: configured token cannot access Page ${pageId}`);
  return requireString(page.access_token, "Page access token");
}

export async function publishFacebook(buffer: Buffer, caption: string): Promise<{ postId: string; postUrl?: string }> {
  const config = getSocialConfig();
  if (!config.facebookPageId || !config.facebookPageAccessToken) throw new Error("Facebook Page credentials are incomplete");
  const pageAccessToken = await resolveFacebookPageAccessToken(config.facebookPageId, config.facebookPageAccessToken);
  const body = new FormData();
  body.append("source", new Blob([new Uint8Array(buffer)], { type: "image/png" }), "the-cliff-news-poster.png");
  body.append("caption", caption);
  body.append("access_token", pageAccessToken);
  const response = await fetchWithTimeout(`https://graph.facebook.com/${config.metaGraphApiVersion}/${encodeURIComponent(config.facebookPageId)}/photos`, { method: "POST", body });
  const json = await readJson(response);
  console.log("[Facebook] Photo upload response", { status: response.status, body: json });
  if (!response.ok) throw providerError("Facebook", response, json);
  const postId = typeof json?.post_id === "string" ? json.post_id : typeof json?.id === "string" ? json.id : "";
  if (!postId) throw new Error("Facebook: response did not contain a post ID");
  return { postId, postUrl: `https://www.facebook.com/${encodeURIComponent(config.facebookPageId)}/posts/${encodeURIComponent(postId)}` };
}
