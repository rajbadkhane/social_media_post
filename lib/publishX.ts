import crypto from "node:crypto";
import { getSocialConfig } from "./config";
import { fetchWithTimeout, providerError, readJson } from "./http";

function encode(value: string): string { return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`); }
function oauthHeader(method: string, url: string, bodyParams: Record<string, string>, consumerKey: string, consumerSecret: string, accessToken: string, accessTokenSecret: string): string {
  const oauth: Record<string, string> = { oauth_consumer_key: consumerKey, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: accessToken, oauth_version: "1.0" };
  const urlObject = new URL(url);
  const pairs = [...urlObject.searchParams.entries(), ...Object.entries(bodyParams), ...Object.entries(oauth)].map(([key, value]) => [encode(key), encode(value)] as const).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const normalized = pairs.map(([key, value]) => `${key}=${value}`).join("&");
  const baseUrl = `${urlObject.origin}${urlObject.pathname}`;
  const baseString = [method.toUpperCase(), encode(baseUrl), encode(normalized)].join("&");
  const signingKey = `${encode(consumerSecret)}&${encode(accessTokenSecret)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
  return `OAuth ${Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(", ")}`;
}

export async function publishX(buffer: Buffer, caption: string): Promise<{ postId: string; postUrl?: string }> {
  const config = getSocialConfig();
  if (!config.xApiKey || !config.xApiSecret || !config.xAccessToken || !config.xAccessTokenSecret) throw new Error("X API OAuth credentials are incomplete");
  const mediaUrl = "https://upload.twitter.com/1.1/media/upload.json";
  const mediaParams = { media_data: buffer.toString("base64") };
  const media = await fetchWithTimeout(mediaUrl, { method: "POST", headers: { Authorization: oauthHeader("POST", mediaUrl, mediaParams, config.xApiKey, config.xApiSecret, config.xAccessToken, config.xAccessTokenSecret), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(mediaParams) });
  const mediaJson = await readJson(media);
  const mediaId = typeof mediaJson?.media_id_string === "string" ? mediaJson.media_id_string : typeof mediaJson?.media_id === "string" ? mediaJson.media_id : "";
  if (!media.ok || !mediaId) throw media.ok ? new Error("X: media upload response did not contain an ID") : providerError("X media upload", media, mediaJson);
  const postUrl = "https://api.x.com/2/tweets";
  const postBody = { text: caption, media: { media_ids: [mediaId] } };
  const post = await fetchWithTimeout(postUrl, { method: "POST", headers: { Authorization: oauthHeader("POST", postUrl, {}, config.xApiKey, config.xApiSecret, config.xAccessToken, config.xAccessTokenSecret), "Content-Type": "application/json" }, body: JSON.stringify(postBody) });
  const postJson = await readJson(post);
  if (!post.ok || typeof postJson?.data?.id !== "string") throw post.ok ? new Error("X: post response did not contain an ID") : providerError("X", post, postJson);
  return { postId: postJson.data.id, postUrl: `https://x.com/i/web/status/${encodeURIComponent(postJson.data.id)}` };
}
