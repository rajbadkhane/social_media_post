import { z } from "zod";

export type Language = "ENGLISH" | "HINDI";

export interface Article {
  id: string;
  title: string;
  slug: string;
  language: Language;
  status: string;
  sourceArticleId: string | null;
  translations: { id: string; language?: string | null }[];
  excerpt: string | null;
  content: string | null;
  featuredImage: string | null;
  ogImage: string | null;
  category: { name?: string | null } | null;
  tags: unknown;
  metaTitle: string | null;
  metaDescription: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const articleSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), slug: z.string().min(1), language: z.string().min(1), status: z.string().min(1),
  sourceArticleId: z.string().nullable().optional(), translations: z.array(z.object({ id: z.string().min(1), language: z.string().nullable().optional() }).passthrough()).nullable().optional(),
  excerpt: z.string().nullable().optional(), content: z.string().nullable().optional(), featuredImage: z.string().url().nullable().optional(), ogImage: z.string().url().nullable().optional(),
  category: z.object({ name: z.string().nullable().optional() }).passthrough().nullable().optional(), tags: z.unknown().nullable().optional(), metaTitle: z.string().nullable().optional(), metaDescription: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(), createdAt: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
}).passthrough();

const feedSchema = z.object({ articles: z.array(z.unknown()) }).passthrough();

const URLS: Record<Language, string> = {
  ENGLISH: process.env.ARTICLE_API_ENGLISH_URL || "https://api.thecliffnews.in/api/articles?limit=100&language=ENGLISH",
  HINDI: process.env.ARTICLE_API_HINDI_URL || "https://api.thecliffnews.in/api/articles?limit=100&language=HINDI",
};

function assertSourceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.thecliffnews.in") throw new Error("Article source must be HTTPS api.thecliffnews.in");
  return url;
}

async function fetchWithRetry(url: URL): Promise<string> {
  const timeoutMs = Number(process.env.ARTICLE_FETCH_TIMEOUT_MS || 15000);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: { "User-Agent": "TheCliffNewsAutomaticPublisher/1.0", Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error(`Article API returned HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 8 * 1024 * 1024) throw new Error("Article API response is too large");
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    } finally { clearTimeout(timer); }
  }
  throw lastError instanceof Error ? lastError : new Error("Article API request failed");
}

export async function fetchArticles(language: Language): Promise<Article[]> {
  const json = feedSchema.safeParse(JSON.parse(await fetchWithRetry(assertSourceUrl(URLS[language]))));
  if (!json.success) throw new Error("Malformed article API response");
  const articles: Article[] = [];
  for (const [index, raw] of json.data.articles.entries()) {
    const parsed = articleSchema.safeParse(raw);
    if (!parsed.success) { console.warn(`Skipping malformed ${language} article at index ${index}`); continue; }
    const item = parsed.data;
    if (item.language.toUpperCase() !== language) continue;
    articles.push({ ...item, language, sourceArticleId: item.sourceArticleId || null, translations: item.translations || [], excerpt: item.excerpt || null, content: item.content || null, featuredImage: item.featuredImage || null, ogImage: item.ogImage || null, category: item.category || null, tags: item.tags ?? null, metaTitle: item.metaTitle || null, metaDescription: item.metaDescription || null, publishedAt: item.publishedAt || null, createdAt: item.createdAt || null, updatedAt: item.updatedAt || null });
  }
  return articles;
}
