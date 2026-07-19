import { fetchArticles, type Language } from "./fetchArticles";
import { buildPairs, oldestUnprocessedPair, type ArticlePair } from "./buildPairs";
import { alternate, dailyLimitReached, dailyPublishCount, readState, recordDailyPublish, trimProcessedPairIds, withPublisherLock, writeState, type PublisherState } from "./state";
import { generatePoster } from "./generatePoster";
import { enabledPlatforms, getSocialConfig, languageName, type Platform } from "./config";
import { publishAll } from "./publishAll";
import { prepareApiArticle } from "./article/prepareApiArticle";
import { createTemporaryPoster, deleteTemporaryPoster, temporaryImageUrl, type TemporaryPoster } from "./social/temporaryPoster";
import { fetchWithTimeout } from "./http";

export interface OperationPlatformResult { enabled: boolean; status: "SUCCESS" | "FAILURE" | "DISABLED" | "DRY_RUN" | "SKIPPED"; postId?: string; postUrl?: string; error?: string; payload?: Record<string, unknown>; updatedAt: string }
export interface PublishingCycleResult {
  complete: boolean;
  skipped?: boolean;
  reason?: string;
  pairId?: string;
  articleId?: string;
  language?: Language;
  posterGenerated?: boolean;
  posterDeleted?: boolean;
  platformResults?: Record<Platform, OperationPlatformResult>;
  nextLanguage: Language;
  dailyPublishedCount?: number;
  dailyPublishLimit?: number;
}

function withUrl(caption: string, url: string): string { return `${caption}\n\n${url}`; }
function xSafe(value: string): string { const units = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment); return units.length <= 280 ? value : units.slice(0, 279).join("").trimEnd() + "…"; }

export function choosePair(pairs: ArticlePair[], state: { nextLanguage: Language; processedPairIds: string[] }): ArticlePair | null { return oldestUnprocessedPair(pairs, state.nextLanguage, state.processedPairIds); }
export function isPublishingComplete(results: Record<Platform, OperationPlatformResult>, mode: "ANY_SUCCESS" | "ALL_SUCCESS", dryRun: boolean): boolean { if (dryRun) return false; const enabled = Object.values(results).filter((result) => result.enabled); const successes = enabled.filter((result) => result.status === "SUCCESS").length; return mode === "ALL_SUCCESS" ? enabled.length > 0 && successes === enabled.length : successes > 0; }

async function verifyTemporaryImageUrl(poster: TemporaryPoster): Promise<string> {
  const url = temporaryImageUrl(poster.token);
  const response = await fetchWithTimeout(url, {}, 10000);
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (!response.ok || !contentType.toLowerCase().startsWith("image/png") || contentLength <= 0) throw new Error("Instagram temporary image URL did not return a valid PNG");
  return url;
}

async function publishPairUnlocked(pair: ArticlePair, expectedLanguage?: Language): Promise<PublishingCycleResult> {
  const config = getSocialConfig();
  const state = await readState();
  if (expectedLanguage && expectedLanguage !== state.nextLanguage) return { complete: false, skipped: true, reason: "The alternation state changed; refresh the Website API list", nextLanguage: state.nextLanguage };
  if (state.processedPairIds.includes(pair.pairId)) return { complete: true, skipped: true, reason: "Story pair was already processed", pairId: pair.pairId, nextLanguage: state.nextLanguage };
  if (dailyLimitReached(state, config.autoPublishDailyLimit)) return { complete: false, skipped: true, reason: `Daily publishing limit reached (${config.autoPublishDailyLimit})`, pairId: pair.pairId, nextLanguage: state.nextLanguage, dailyPublishedCount: dailyPublishCount(state), dailyPublishLimit: config.autoPublishDailyLimit };
  const language = state.nextLanguage;
  const article = language === "ENGLISH" ? pair.english : pair.hindi;
  const prepared = prepareApiArticle(article);
  if (!prepared.imageUrl) throw new Error("Selected article has no featured image");
  const articleUrl = prepared.canonicalUrl;
  const captions: Record<Platform, string> = { facebook: withUrl(prepared.captions.facebook, articleUrl), instagram: withUrl(prepared.captions.instagram, articleUrl), linkedin: withUrl(prepared.captions.linkedin, articleUrl), x: xSafe(withUrl(prepared.captions.twitter, articleUrl)) };
  const poster = await generatePoster({ headline: article.title, summary: prepared.summary, imageUrl: prepared.imageUrl, category: prepared.category, seoHashtags: prepared.seoHashtags, smoHashtags: prepared.smoHashtags, captions: { facebook: captions.facebook, instagram: captions.instagram, linkedin: captions.linkedin, twitter: captions.x }, language: languageName(language) });
  const temporaryPoster = await createTemporaryPoster(poster, pair.pairId, language);
  let temporaryImageUrl: string | null = null;
  let instagramError: string | undefined;
  try {
    if (enabledPlatforms(config).includes("instagram") && !config.dryRun) {
      try { temporaryImageUrl = await verifyTemporaryImageUrl(temporaryPoster); }
      catch (error) { instagramError = error instanceof Error ? error.message : "Instagram temporary image preparation failed"; }
    }
    const previous = Object.fromEntries(Object.entries(state.platformCompletions[pair.pairId] || {}).map(([platform, success]) => [platform, { enabled: true, status: success ? "SUCCESS" : "FAILURE", updatedAt: new Date().toISOString() }])) as Partial<Record<Platform, any>>;
    const results = await publishAll({ poster, temporaryImageUrl, captions, previous, dryRun: config.dryRun, instagramError, onResult: async (platform, result) => {
      if (config.dryRun || !result.enabled) return;
      state.platformCompletions[pair.pairId] = { ...(state.platformCompletions[pair.pairId] || {}), [platform]: result.status === "SUCCESS" };
      await writeState(state);
    }});
    const complete = isPublishingComplete(results, config.socialSuccessMode, config.dryRun);
    if (complete) {
      state.processedPairIds = trimProcessedPairIds([...state.processedPairIds, pair.pairId]);
      delete state.platformCompletions[pair.pairId];
      state.nextLanguage = alternate(language);
      recordDailyPublish(state);
      await writeState(state);
    }
    return { complete, pairId: pair.pairId, articleId: article.id, language, posterGenerated: true, posterDeleted: true, platformResults: results, nextLanguage: state.nextLanguage, dailyPublishedCount: dailyPublishCount(state), dailyPublishLimit: config.autoPublishDailyLimit };
  } finally {
    await deleteTemporaryPoster(temporaryPoster);
  }
}

export async function publishPairNow(pair: ArticlePair, expectedLanguage?: Language): Promise<PublishingCycleResult> {
  return withPublisherLock(() => publishPairUnlocked(pair, expectedLanguage));
}

export async function runAutomaticPublishingCycle(): Promise<PublishingCycleResult> {
  const config = getSocialConfig();
  if (!config.autoPublishEnabled) return { complete: false, skipped: true, reason: "Automatic publishing is disabled", nextLanguage: (await readState()).nextLanguage };
  return withPublisherLock(async () => {
    const state = await readState();
    if (dailyLimitReached(state, config.autoPublishDailyLimit)) return { complete: false, skipped: true, reason: `Daily publishing limit reached (${config.autoPublishDailyLimit})`, nextLanguage: state.nextLanguage, dailyPublishedCount: dailyPublishCount(state), dailyPublishLimit: config.autoPublishDailyLimit };
    const [english, hindi] = await Promise.all([fetchArticles("ENGLISH"), fetchArticles("HINDI")]);
    const pair = choosePair(buildPairs(english, hindi), state);
    if (!pair) return { complete: false, skipped: true, reason: "No eligible unpublished bilingual pair", nextLanguage: state.nextLanguage };
    return publishPairUnlocked(pair);
  });
}

export function startAutomaticPublisher(): void { /* execution belongs to the PM2/cron runner */ }
