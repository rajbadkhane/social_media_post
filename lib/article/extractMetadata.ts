import { JSDOM } from "jsdom";

/**
 * Decodes standard HTML entities.
 */
export function decodeHtmlEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ");
}

/**
 * Cleans the title by removing source website branding/suffixes.
 */
export function cleanTitle(title: string, sourceName: string): string {
  let cleaned = decodeHtmlEntities(title).trim();
  if (!cleaned) return "";

  const escapeRegex = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  const sourceTerms = [sourceName];

  // If source contains dots, e.g. "nytimes.com", add "nytimes" as fallback term
  if (sourceName.includes(".")) {
    sourceTerms.push(sourceName.split(".")[0]);
  }

  for (const term of sourceTerms) {
    if (!term || term.length < 2) continue;
    const termPattern = escapeRegex(term);

    // Matches e.g. "Title | SourceName" or "Title - SourceName"
    const suffixRegex = new RegExp(`[\\s|–—:-]+\\s*${termPattern}\\s*$`, "i");
    cleaned = cleaned.replace(suffixRegex, "");

    // Matches e.g. "SourceName: Title"
    const prefixRegex = new RegExp(`^\\s*${termPattern}\\s*[:|–—-]+\\s*`, "i");
    cleaned = cleaned.replace(prefixRegex, "");
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

export interface ExtractedMetadata {
  title: string;
  canonicalUrl: string;
  sourceName: string;
  publishedAt: string | null;
}

/**
 * Deterministically extracts and cleans metadata fields.
 */
export function extractMetadata(
  dom: JSDOM,
  rawTitle: string,
  readabilityTitle: string | null,
  sourceName: string,
  canonicalUrl: string,
  publishedAt: string | null
): ExtractedMetadata {
  const document = dom.window.document;

  // 1. Title Extraction Cascade
  let titleCandidates: string[] = [];

  // Parse JSON-LD headline
  document.querySelectorAll("script[type='application/ld+json']").forEach(script => {
    try {
      const data = JSON.parse(script.textContent || "");
      const graph = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const obj of graph) {
        if (obj["@type"] === "NewsArticle" || obj["@type"] === "BlogPosting" || obj["@type"] === "Article") {
          if (obj.headline) {
            titleCandidates.push(obj.headline);
          }
        }
      }
    } catch {
      // ignore JSON errors
    }
  });

  // og:title
  const ogTitle = document.querySelector("meta[property='og:title']");
  if (ogTitle) {
    const val = ogTitle.getAttribute("content");
    if (val) titleCandidates.push(val);
  }

  // twitter:title
  const twitterTitle = document.querySelector("meta[name='twitter:title']");
  if (twitterTitle) {
    const val = twitterTitle.getAttribute("content");
    if (val) titleCandidates.push(val);
  }

  // Readability title
  if (readabilityTitle) {
    titleCandidates.push(readabilityTitle);
  }

  // h1
  const h1 = document.querySelector("h1");
  if (h1 && h1.textContent) {
    titleCandidates.push(h1.textContent);
  }

  // title tag
  if (rawTitle) {
    titleCandidates.push(rawTitle);
  }

  // Pick first non-empty candidate, default to rawTitle
  let selectedTitle = rawTitle;
  for (const c of titleCandidates) {
    const trimmed = c.trim();
    if (trimmed) {
      selectedTitle = trimmed;
      break;
    }
  }

  // Clean the title
  const cleanedTitle = cleanTitle(selectedTitle, sourceName);

  return {
    title: cleanedTitle || rawTitle || "Untitled Article",
    canonicalUrl,
    sourceName,
    publishedAt
  };
}
