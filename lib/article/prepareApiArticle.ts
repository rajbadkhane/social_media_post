import type { Article } from "../fetchArticles";
import { summarizeArticle } from "./summarize";
import { extractKeywords } from "./keywords";
import { generateHashtags } from "./hashtags";
import { detectCategory } from "./category";
import { generateCaptions } from "./captions";

function textContent(article: Article): string {
  return (article.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function publicArticleUrl(article: Article): string {
  const base = (process.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_BASE_URL || "https://www.thecliffnews.in").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(article.slug)) throw new Error("Invalid article slug");
  return `${base}/${article.language === "ENGLISH" ? "en" : "hi"}/article/${article.slug}`;
}

function apiTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

export interface PreparedApiArticle {
  articleId: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  seoHashtags: string[];
  smoHashtags: string[];
  keywords: { primary: string[]; secondary: string[]; longTail: string[] };
  captions: { facebook: string; instagram: string; linkedin: string; twitter: string };
  category: string;
  language: string;
  readingTime: string;
  sourceName: string;
  canonicalUrl: string;
  publishedAt: string;
  slug: string;
}

export function prepareApiArticle(article: Article): PreparedApiArticle {
  const body = textContent(article);
  const summary = article.excerpt?.trim() || article.metaDescription?.trim() || summarizeArticle(body, article.title);
  const keywords = extractKeywords(body, article.title);
  const category = article.category?.name?.trim() || detectCategory(article.title, keywords.primary.concat(keywords.secondary), summary, body);
  const generated = generateHashtags(article.title, keywords.primary, keywords.secondary, category);
  const suppliedTags = apiTags(article.tags);
  const seoHashtags = suppliedTags.length ? suppliedTags : generated.seoHashtags;
  const smoHashtags = suppliedTags.length ? suppliedTags : generated.smoHashtags;
  const captions = generateCaptions(article.title, summary, keywords.primary, seoHashtags, smoHashtags);
  const publishedAt = article.publishedAt || article.createdAt || "";
  const words = body ? body.split(/\s+/).length : 0;
  return {
    articleId: article.id, title: article.title, summary, imageUrl: article.featuredImage || article.ogImage || null,
    seoHashtags, smoHashtags, keywords, captions, category, language: article.language === "HINDI" ? "Hindi" : "English",
    readingTime: `${Math.max(1, Math.round(words / (article.language === "HINDI" ? 180 : 200)))} min read`, sourceName: "The Cliff News",
    canonicalUrl: publicArticleUrl(article), publishedAt, slug: article.slug,
  };
}
