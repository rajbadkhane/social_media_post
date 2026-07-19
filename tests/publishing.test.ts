import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPairs, areTranslations } from "../lib/buildPairs";
import { choosePair, isPublishingComplete } from "../lib/automaticPublisher";
import { prepareApiArticle } from "../lib/article/prepareApiArticle";
import { publishAll } from "../lib/publishAll";
import { alternate, dailyLimitReached, dailyPublishCount, recordDailyPublish, readState, withPublisherLock, writeState, type PublisherState } from "../lib/state";
import type { Article } from "../lib/fetchArticles";
import { redactSecrets } from "../lib/http";

const article = (id: string, language: "ENGLISH" | "HINDI", extra: Partial<Article> = {}): Article => ({ id, title: id, slug: id, language, status: "PUBLISHED", sourceArticleId: null, translations: [], excerpt: "summary", content: "content", featuredImage: "https://api.thecliffnews.in/image.png", ogImage: null, category: { name: "News" }, tags: null, metaTitle: null, metaDescription: null, publishedAt: "2026-07-19T10:00:00.000Z", createdAt: null, updatedAt: null, ...extra });
const state = (): PublisherState => ({ nextLanguage: "ENGLISH", processedPairIds: [], platformCompletions: {}, dailyPublishCount: { date: "2026-07-20", count: 0 } });
const originalEnv = { ...process.env };

afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value; });

describe("safe automatic publishing", () => {
  it("pairs by sourceArticleId", () => {
    const en = article("en-source", "ENGLISH", { sourceArticleId: "hi-source" }); const hi = article("hi-source", "HINDI");
    expect(areTranslations(en, hi)).toBe(true); expect(buildPairs([en], [hi])).toHaveLength(1);
  });

  it("pairs by translations", () => {
    const en = article("en-translation", "ENGLISH"); const hi = article("hi-translation", "HINDI", { translations: [{ id: "en-translation" }] });
    expect(buildPairs([en], [hi])).toHaveLength(1);
  });

  it("publishes pair one as English and pair two as Hindi through strict alternation", () => {
    const en1 = article("en-1", "ENGLISH", { sourceArticleId: "hi-1", publishedAt: "2026-07-19T08:00:00Z" }); const hi1 = article("hi-1", "HINDI", { publishedAt: "2026-07-19T08:00:00Z" });
    const en2 = article("en-2", "ENGLISH", { sourceArticleId: "hi-2", publishedAt: "2026-07-19T09:00:00Z" }); const hi2 = article("hi-2", "HINDI", { publishedAt: "2026-07-19T09:00:00Z" });
    const pairs = buildPairs([en1, en2], [hi1, hi2]);
    expect(choosePair(pairs, { nextLanguage: "ENGLISH", processedPairIds: [] })?.english.id).toBe("en-1");
    const firstPairId = pairs.find((pair) => pair.english.id === "en-1")!.pairId;
    expect(choosePair(pairs, { nextLanguage: "HINDI", processedPairIds: [firstPairId] })?.hindi.id).toBe("hi-2");
    expect(alternate("ENGLISH")).toBe("HINDI");
  });

  it("does not reselect a processed pair", () => {
    const pair = buildPairs([article("en-1", "ENGLISH", { sourceArticleId: "hi-1" })], [article("hi-1", "HINDI")])[0];
    expect(choosePair([pair], { nextLanguage: "ENGLISH", processedPairIds: [pair.pairId] })).toBeNull();
  });

  it("does not duplicate Facebook after it succeeds and Instagram fails", async () => {
    process.env.ENABLE_FACEBOOK = "true"; process.env.ENABLE_INSTAGRAM = "true"; process.env.SOCIAL_DRY_RUN = "false";
    process.env.FACEBOOK_PAGE_ID = "page"; process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "token"; process.env.INSTAGRAM_ACCOUNT_ID = "account"; process.env.INSTAGRAM_ACCESS_TOKEN = "token";
    const calls: string[] = [];
    const results = await publishAll({ poster: Buffer.from("png"), temporaryImageUrl: "https://postmaker.example/temp.png", captions: { facebook: "fb", instagram: "ig", linkedin: "li", x: "x" }, previous: {}, dryRun: false, providers: { facebook: async () => { calls.push("facebook"); return { postId: "fb-1" }; }, instagram: async () => { calls.push("instagram"); throw new Error("Instagram denied"); }, linkedin: async () => { throw new Error("unused"); }, x: async () => { throw new Error("unused"); } } });
    expect(results.facebook.status).toBe("SUCCESS"); expect(results.instagram.status).toBe("FAILURE");
    process.env.RETRY_FAILED_PLATFORMS = "true";
    const retry = await publishAll({ poster: Buffer.from("png"), temporaryImageUrl: "https://postmaker.example/temp.png", captions: { facebook: "fb", instagram: "ig", linkedin: "li", x: "x" }, previous: results, dryRun: false, providers: { facebook: async () => { calls.push("facebook-retry"); return { postId: "bad" }; }, instagram: async () => { calls.push("instagram-retry"); throw new Error("still denied"); }, linkedin: async () => { throw new Error("unused"); }, x: async () => { throw new Error("unused"); } } });
    expect(calls).toEqual(["facebook", "instagram", "instagram-retry"]); expect(retry.facebook.status).toBe("SUCCESS");
  });

  it("tracks and enforces the daily publishing cap", () => {
    const current = state();
    expect(dailyPublishCount(current, "2026-07-20")).toBe(0);
    recordDailyPublish(current, "2026-07-20");
    expect(dailyPublishCount(current, "2026-07-20")).toBe(1);
    current.dailyPublishCount = { date: "2026-07-20", count: 50 };
    expect(dailyLimitReached(current, 50, "2026-07-20")).toBe(true);
    expect(dailyLimitReached(current, 50, "2026-07-21")).toBe(false);
  });

  it("toggles only after success and never completes a dry run", () => {
    const result = { facebook: { enabled: true, status: "SUCCESS", updatedAt: "now" }, instagram: { enabled: true, status: "FAILURE", updatedAt: "now" }, linkedin: { enabled: false, status: "DISABLED", updatedAt: "now" }, x: { enabled: false, status: "DISABLED", updatedAt: "now" } } as any;
    expect(isPublishingComplete(result, "ANY_SUCCESS", false)).toBe(true); expect(isPublishingComplete(result, "ALL_SUCCESS", false)).toBe(false); expect(isPublishingComplete(result, "ANY_SUCCESS", true)).toBe(false);
  });

  it("writes state atomically", async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), "state-test-")); process.env.STATE_FILE_PATH = path.join(directory, "state.json");
    await writeState(state()); const loaded = await readState(); expect(loaded.nextLanguage).toBe("ENGLISH"); expect((await fs.readdir(directory)).filter((name) => name.includes(".tmp"))).toHaveLength(0); await fs.rm(directory, { recursive: true, force: true });
  });

  it("blocks concurrent cycles with the process lock", async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), "lock-test-")); process.env.STATE_FILE_PATH = path.join(directory, "state.json");
    const first = withPublisherLock(async () => new Promise((resolve) => setTimeout(resolve, 50))); await expect(withPublisherLock(async () => undefined)).rejects.toThrow("already running"); await first; await fs.rm(directory, { recursive: true, force: true });
  });

  it("does not call a real platform in dry-run mode", async () => {
    process.env.ENABLE_FACEBOOK = "true"; process.env.SOCIAL_DRY_RUN = "true"; const provider = vi.fn(async () => ({ postId: "should-not-exist" }));
    const result = await publishAll({ poster: Buffer.from("png"), temporaryImageUrl: null, captions: { facebook: "fb", instagram: "ig", linkedin: "li", x: "x" }, previous: {}, dryRun: true, providers: { facebook: provider, instagram: provider, linkedin: provider, x: provider } });
    expect(provider).not.toHaveBeenCalled(); expect(result.facebook.status).toBe("DRY_RUN");
  });

  it("skips disabled platforms", async () => {
    process.env.SOCIAL_DRY_RUN = "false"; const result = await publishAll({ poster: Buffer.from("png"), temporaryImageUrl: null, captions: { facebook: "fb", instagram: "ig", linkedin: "li", x: "x" }, previous: {}, dryRun: false });
    expect(result.facebook.status).toBe("DISABLED"); expect(result.instagram.status).toBe("DISABLED");
  });

  it("never returns access tokens in errors", () => { process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "super-secret-token"; expect(redactSecrets("request failed super-secret-token")).not.toContain("super-secret-token"); });

  it("uses the selected API article for poster content and preserves Hindi text", () => { const hi = article("hi", "HINDI", { title: "हिंदी समाचार शीर्षक", content: "हिंदी सामग्री" }); const prepared = prepareApiArticle(hi); expect(prepared.title).toBe("हिंदी समाचार शीर्षक"); expect(prepared.language).toBe("Hindi"); });

  it("keeps the Website API selection controls present", async () => { const html = await fs.readFile(path.join(process.cwd(), "public", "poster.html"), "utf8"); expect(html).toContain("websitePairsList"); expect(html).toContain("/api/social/publish-now"); expect(html).toContain("publishNowBtn"); });
});
