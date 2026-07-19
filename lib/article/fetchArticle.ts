import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { resolveHostname, isPrivateIp } from "./security";

export interface ExtractedArticle {
  rawTitle: string;
  mainText: string;
  source: string;
  publishedAt: string | null;
  canonicalUrl: string;
  htmlContent: string;
  jsdom: JSDOM;
}

/**
 * Enforces SSRF protection, size limits, and follows redirects manually.
 */
export async function fetchWithSsrfProtection(
  urlStr: string,
  maxRedirects = 5,
  maxSize = 5 * 1024 * 1024 // 5 MB
): Promise<{ text: string; finalUrl: string }> {
  let currentUrl = urlStr;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const parsedUrl = new URL(currentUrl);

    // Enforce protocol constraints
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Only http: and https: protocols are allowed.");
    }

    const hostname = parsedUrl.hostname;
    if (!hostname) {
      throw new Error("Invalid URL hostname.");
    }

    // Resolve DNS and check if IP is private
    const ip = await resolveHostname(hostname);
    if (isPrivateIp(ip)) {
      throw new Error(`Forbidden connection to private IP range: ${ip}`);
    }

    // Perform fetch with 10s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error("Request timed out (10s limit).");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle redirects manually to check target IPs
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirected but no location header found.");
      }
      currentUrl = new URL(location, currentUrl).toString();
      redirectCount++;
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Enforce HTML content type check
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error(`Invalid content type: ${contentType}. Only HTML pages are permitted.`);
    }

    // Read body chunk-by-chunk to enforce size limit
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      if (text.length > maxSize) {
        throw new Error("Page content exceeds the 5 MB limit.");
      }
      return { text, finalUrl: currentUrl };
    }

    let totalSize = 0;
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalSize += value.length;
          if (totalSize > maxSize) {
            await reader.cancel();
            throw new Error("Page content exceeds the 5 MB limit.");
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const text = new TextDecoder().decode(combined);
    return { text, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects.");
}

/**
 * Removes typical boilerplate elements from the DOM.
 */
function cleanDom(document: Document) {
  const selectorsToRemove = [
    "script", "style", "noscript", "iframe", "header", "footer", "nav",
    "svg", "form", "button", "aside",
    "#header", "#footer", "#nav", ".header", ".footer", ".nav",
    ".ads", ".advertisement", ".ad-box", ".cookie-banner", ".cookie-consent",
    ".social-share", ".share-buttons", ".related-posts", ".related-stories",
    ".subscription-block", ".newsletter-prompt", ".newsletter-signup",
    "[hidden]", "[style*='display: none']", "[style*='display:none']"
  ];
  for (const selector of selectorsToRemove) {
    document.querySelectorAll(selector).forEach(el => el.remove());
  }
}

/**
 * Normalizes double spaces, newlines, and trims text.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

/**
 * Main parser function. Extracts text content with Readability, or falls back to rules.
 */
export async function scrapeArticle(urlStr: string): Promise<ExtractedArticle> {
  const { text: htmlContent, finalUrl } = await fetchWithSsrfProtection(urlStr);
  const dom = new JSDOM(htmlContent, { url: finalUrl });
  const document = dom.window.document;

  // Extract raw title before cleaning the DOM
  const rawTitle = document.querySelector("title")?.textContent || "";

  // Parse JSON-LD if available to check articleBody fallback
  let jsonLdBody = "";
  document.querySelectorAll("script[type='application/ld+json']").forEach(script => {
    try {
      const data = JSON.parse(script.textContent || "");
      const graph = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const obj of graph) {
        if (obj["@type"] === "NewsArticle" || obj["@type"] === "BlogPosting" || obj["@type"] === "Article") {
          if (obj.articleBody) {
            jsonLdBody = obj.articleBody;
          }
        }
      }
    } catch {
      // ignore invalid json-ld
    }
  });

  // Try Readability
  const readabilityDom = new JSDOM(htmlContent, { url: finalUrl });
  const reader = new Readability(readabilityDom.window.document);
  const article = reader.parse();

  let mainText = "";
  if (article && article.textContent) {
    mainText = normalizeWhitespace(article.textContent);
  }

  // Fallback chain if Readability is empty or extremely short
  if (mainText.split(/\s+/).length < 20) {
    cleanDom(document);

    if (jsonLdBody && jsonLdBody.length > 50) {
      // 1. JSON-LD articleBody
      mainText = normalizeWhitespace(jsonLdBody);
    } else {
      // 2. <article> tag content
      const articleEl = document.querySelector("article");
      if (articleEl && articleEl.textContent && articleEl.textContent.trim().length > 50) {
        mainText = normalizeWhitespace(articleEl.textContent);
      } else {
        // 3. Common selectors
        const commonSelectors = [
          ".article-content", ".article-body", ".story-content", ".story-body",
          ".entry-content", ".post-content", "#article-body"
        ];
        let foundText = "";
        for (const selector of commonSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent && el.textContent.trim().length > 50) {
            foundText = el.textContent;
            break;
          }
        }

        if (foundText) {
          mainText = normalizeWhitespace(foundText);
        } else {
          // 4. Paragraph collection
          const paras: string[] = [];
          document.querySelectorAll("p").forEach(p => {
            const t = p.textContent?.trim() || "";
            if (t.length > 25) {
              paras.push(t);
            }
          });
          if (paras.length > 0) {
            mainText = normalizeWhitespace(paras.join(" "));
          }
        }
      }
    }
  }

  // Find canonical URL
  let canonicalUrl = finalUrl;
  const canonicalEl = document.querySelector("link[rel='canonical']");
  if (canonicalEl) {
    const href = canonicalEl.getAttribute("href");
    if (href) {
      try {
        canonicalUrl = new URL(href, finalUrl).toString();
      } catch {
        // use fallback finalUrl
      }
    }
  }

  // Find source site name
  let source = "";
  const ogSiteName = document.querySelector("meta[property='og:site_name']");
  if (ogSiteName) {
    source = ogSiteName.getAttribute("content") || "";
  }
  if (!source) {
    const appName = document.querySelector("meta[name='application-name']");
    if (appName) {
      source = appName.getAttribute("content") || "";
    }
  }
  if (!source) {
    try {
      source = new URL(finalUrl).hostname.replace("www.", "");
    } catch {
      source = "News Article";
    }
  }

  // Extract published time
  let publishedAt: string | null = null;
  const timeEl = document.querySelector("meta[property='article:published_time']");
  if (timeEl) {
    publishedAt = timeEl.getAttribute("content");
  }
  if (!publishedAt) {
    const timeTag = document.querySelector("time");
    if (timeTag) {
      publishedAt = timeTag.getAttribute("datetime") || timeTag.textContent || null;
    }
  }

  return {
    rawTitle,
    mainText,
    source,
    publishedAt,
    canonicalUrl,
    htmlContent,
    jsdom: dom
  };
}
