import type { Article, Language } from "./fetchArticles";

export interface ArticlePair { pairId: string; english: Article; hindi: Article; publishedAt: number }

function mentions(article: Article, id: string): boolean {
  return article.sourceArticleId === id || article.translations.some((translation) => translation.id === id);
}

export function areTranslations(english: Article, hindi: Article): boolean {
  return mentions(english, hindi.id) || mentions(hindi, english.id);
}

function dateOf(article: Article): number { return Date.parse(article.publishedAt || article.createdAt || "") || 0; }

export function buildPairs(englishArticles: Article[], hindiArticles: Article[]): ArticlePair[] {
  const pairs: ArticlePair[] = [];
  const seen = new Set<string>();
  for (const english of englishArticles) {
    const hindi = hindiArticles.find((candidate) => areTranslations(english, candidate));
    if (!hindi) continue;
    const pairId = `pair:${[english.id, hindi.id].sort().join(":")}`;
    if (seen.has(pairId)) continue;
    seen.add(pairId);
    pairs.push({ pairId, english, hindi, publishedAt: Math.max(dateOf(english), dateOf(hindi)) });
  }
  return pairs.sort((a, b) => b.publishedAt - a.publishedAt || b.pairId.localeCompare(a.pairId));
}

export function oldestUnprocessedPair(pairs: ArticlePair[], language: Language, processedPairIds: string[]): ArticlePair | null {
  const processed = new Set(processedPairIds);
  return [...pairs].sort((a, b) => a.publishedAt - b.publishedAt || a.pairId.localeCompare(b.pairId)).find((pair) => !processed.has(pair.pairId) && (language === "ENGLISH" ? pair.english.status === "PUBLISHED" : pair.hindi.status === "PUBLISHED")) || null;
}

export const newestUnprocessedPair = oldestUnprocessedPair;
