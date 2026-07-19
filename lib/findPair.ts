import { fetchArticles } from "./fetchArticles";
import { buildPairs } from "./buildPairs";

export async function findArticlePair(pairId: string) {
  const [english, hindi] = await Promise.all([fetchArticles("ENGLISH"), fetchArticles("HINDI")]);
  return buildPairs(english, hindi).find((pair) => pair.pairId === pairId) || null;
}
