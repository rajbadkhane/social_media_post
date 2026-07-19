import { getSocialConfig } from "./config";
import { fetchWithTimeout, providerError, readJson } from "./http";

export async function publishFacebook(buffer: Buffer, caption: string): Promise<{ postId: string; postUrl?: string }> {
  const config = getSocialConfig();
  if (!config.facebookPageId || !config.facebookPageAccessToken) throw new Error("Facebook Page credentials are incomplete");
  const body = new FormData();
  body.append("source", new Blob([new Uint8Array(buffer)], { type: "image/png" }), "the-cliff-news-poster.png");
  body.append("caption", caption);
  body.append("access_token", config.facebookPageAccessToken);
  const response = await fetchWithTimeout(`https://graph.facebook.com/${config.metaGraphApiVersion}/${encodeURIComponent(config.facebookPageId)}/photos`, { method: "POST", body });
  const json = await readJson(response);
  if (!response.ok) throw providerError("Facebook", response, json);
  const postId = typeof json?.post_id === "string" ? json.post_id : typeof json?.id === "string" ? json.id : "";
  if (!postId) throw new Error("Facebook: response did not contain a post ID");
  return { postId, postUrl: `https://www.facebook.com/${encodeURIComponent(config.facebookPageId)}/posts/${encodeURIComponent(postId)}` };
}
