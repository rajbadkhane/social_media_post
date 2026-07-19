import type { ArticlePair } from "./buildPairs";
import { getSocialConfig, languageName, type Platform } from "./config";
import { generatePoster } from "./generatePoster";
import { prepareApiArticle } from "./article/prepareApiArticle";
import { publishAll } from "./publishAll";
import { readState } from "./state";
import { createTemporaryPoster, deleteTemporaryPoster, temporaryImageUrl, type TemporaryPoster } from "./social/temporaryPoster";
import { fetchWithTimeout } from "./http";

async function verifyImageUrl(poster: TemporaryPoster): Promise<string> {
  const url = temporaryImageUrl(poster); const response = await fetchWithTimeout(url, {}, 10000);
  if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().startsWith("image/")) throw new Error("Instagram temporary image URL did not return a valid image");
  return url;
}

export async function testPlatform(pair: ArticlePair, platform: Platform, expectedLanguage?: "ENGLISH" | "HINDI") {
  const config = getSocialConfig(); const state = await readState();
  if (expectedLanguage && expectedLanguage !== state.nextLanguage) throw new Error("The alternation state changed; refresh the Website API list");
  const article = state.nextLanguage === "ENGLISH" ? pair.english : pair.hindi; const prepared = prepareApiArticle(article);
  if (!prepared.imageUrl) throw new Error("Selected article has no featured image");
  const articleUrl = prepared.canonicalUrl;
  const captions = { facebook: `${prepared.captions.facebook}\n\n${articleUrl}`, instagram: `${prepared.captions.instagram}\n\n${articleUrl}`, linkedin: `${prepared.captions.linkedin}\n\n${articleUrl}`, x: `${prepared.captions.twitter}\n\n${articleUrl}`.slice(0, 280) };
  const poster = await generatePoster({ headline: article.title, summary: prepared.summary, imageUrl: prepared.imageUrl, category: prepared.category, seoHashtags: prepared.seoHashtags, smoHashtags: prepared.smoHashtags, captions: { facebook: captions.facebook, instagram: captions.instagram, linkedin: captions.linkedin, twitter: captions.x }, language: languageName(article.language) });
  const temporaryPoster = await createTemporaryPoster(poster, `test-${pair.pairId}`, article.language);
  try {
    let temporaryImageUrl: string | null = null; let instagramError: string | undefined;
    if (platform === "instagram" && !config.dryRun) { try { temporaryImageUrl = await verifyImageUrl(temporaryPoster); } catch (error) { instagramError = error instanceof Error ? error.message : "Instagram temporary image preparation failed"; } }
    const results = await publishAll({ poster, temporaryImageUrl, captions, previous: {}, dryRun: config.dryRun, onlyPlatform: platform, instagramError });
    return { pairId: pair.pairId, articleId: article.id, language: article.language, posterGenerated: true, posterDeleted: true, result: results[platform] };
  } finally { await deleteTemporaryPoster(temporaryPoster); }
}
