import { NextResponse } from "next/server";
import { fetchArticles } from "../../../lib/fetchArticles";
import { buildPairs } from "../../../lib/buildPairs";
import { prepareApiArticle } from "../../../lib/article/prepareApiArticle";
import { readState } from "../../../lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [english, hindi, state] = await Promise.all([fetchArticles("ENGLISH"), fetchArticles("HINDI"), readState()]);
    const pairs = buildPairs(english, hindi).slice(0, 10);
    return NextResponse.json({
      success: true,
      nextLanguage: state.nextLanguage,
      pairs: pairs.map((pair) => ({
        pairId: pair.pairId,
        publishedAt: new Date(pair.publishedAt || Date.now()).toISOString(),
        category: pair.english.category?.name || pair.hindi.category?.name || "News",
        nextLanguage: state.nextLanguage,
        english: prepareApiArticle(pair.english),
        hindi: prepareApiArticle(pair.hindi),
      })),
    });
  } catch (error) {
    console.error("Website API pairs error:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to fetch paired website articles" }, { status: 502 });
  }
}
