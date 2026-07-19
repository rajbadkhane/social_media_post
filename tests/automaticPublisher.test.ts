import { describe, expect, it } from "vitest";
import { areTranslations, buildPairs } from "../lib/buildPairs";
import { alternate } from "../lib/state";
import { choosePair } from "../lib/automaticPublisher";
import type { Article } from "../lib/fetchArticles";

const article = (id: string, language: "ENGLISH" | "HINDI", extra: Partial<Article> = {}): Article => ({ id, title: id, slug: id, language, status: "PUBLISHED", sourceArticleId: null, translations: [], excerpt: "summary", content: "content", featuredImage: "https://api.thecliffnews.in/image.png", ogImage: null, category: { name: "News" }, tags: null, metaTitle: null, metaDescription: null, publishedAt: "2026-07-19T10:00:00.000Z", createdAt: null, updatedAt: null, ...extra });

describe("automatic publisher", () => {
  it("pairs by sourceArticleId/translations, never array position", () => {
    const hi = article("hi-1", "HINDI", { translations: [{ id: "en-1", language: "ENGLISH" }] }); const en = article("en-1", "ENGLISH", { sourceArticleId: "hi-1" });
    expect(areTranslations(en, hi)).toBe(true); expect(buildPairs([en], [hi])).toHaveLength(1);
  });
  it("posts only the required language and skips the counterpart through one pair id", () => {
    const en = article("en-1", "ENGLISH", { sourceArticleId: "hi-1" }); const hi = article("hi-1", "HINDI", { translations: [{ id: "en-1", language: "ENGLISH" }] }); const pairs = buildPairs([en], [hi]);
    expect(choosePair(pairs, { nextLanguage: "ENGLISH", processedPairIds: [] })?.english.id).toBe("en-1"); expect(choosePair(pairs, { nextLanguage: "HINDI", processedPairIds: [pairs[0].pairId] })).toBeNull();
  });
  it("alternates English and Hindi", () => { expect(alternate("ENGLISH")).toBe("HINDI"); expect(alternate("HINDI")).toBe("ENGLISH"); });
  it("does not reselect a processed pair", () => { const en = article("en-1", "ENGLISH", { sourceArticleId: "hi-1" }); const hi = article("hi-1", "HINDI", { translations: [{ id: "en-1" }] }); const pair = buildPairs([en], [hi])[0]; expect(choosePair([pair], { nextLanguage: "ENGLISH", processedPairIds: [pair.pairId] })).toBeNull(); });
});
