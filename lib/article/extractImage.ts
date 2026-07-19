import { JSDOM } from "jsdom";
import { resolveHostname, isPrivateIp } from "./security";

export interface ImageResult {
  imageUrl: string | null;
  imageDataUrl: string | null;
}

/**
 * Resolves a target image URL and checks OpenGraph/Twitter/JSON-LD metadata, falling back to body images.
 */
export function selectImageCandidate(dom: JSDOM, finalUrl: string): string | null {
  const document = dom.window.document;
  const candidates: string[] = [];

  // 1. JSON-LD article image
  document.querySelectorAll("script[type='application/ld+json']").forEach(script => {
    try {
      const data = JSON.parse(script.textContent || "");
      const graph = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const obj of graph) {
        if (obj["@type"] === "NewsArticle" || obj["@type"] === "BlogPosting" || obj["@type"] === "Article") {
          if (obj.image) {
            if (typeof obj.image === "string") {
              candidates.push(obj.image);
            } else if (Array.isArray(obj.image) && typeof obj.image[0] === "string") {
              candidates.push(obj.image[0]);
            } else if (obj.image.url) {
              candidates.push(obj.image.url);
            }
          }
        }
      }
    } catch {
      // ignore JSON errors
    }
  });

  // 2. og:image
  const ogImg = document.querySelector("meta[property='og:image']");
  if (ogImg) {
    const val = ogImg.getAttribute("content");
    if (val) candidates.push(val);
  }

  // 3. twitter:image
  const twImg = document.querySelector("meta[name='twitter:image']");
  if (twImg) {
    const val = twImg.getAttribute("content");
    if (val) candidates.push(val);
  }

  // 4. Body images fallback
  document.querySelectorAll("img").forEach(img => {
    // Try data-src, srcset, or src
    const src = img.getAttribute("data-src") || img.getAttribute("srcset") || img.getAttribute("src");
    if (!src) return;

    // Use first element of srcset if it is a list
    const cleanSrc = src.trim().split(/\s+/)[0];
    if (cleanSrc) {
      candidates.push(cleanSrc);
    }
  });

  // Filter and resolve candidates
  for (const c of candidates) {
    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(c, finalUrl).toString();
    } catch {
      continue;
    }

    const lower = absoluteUrl.toLowerCase();
    const isExcluded = [
      "logo", "avatar", "icon", "banner", "spacer", "pixel", "tracker",
      "advertisement", "ad-", "facebook", "twitter", "instagram", "linkedin",
      "chevron", "arrow", "loading", "spinner", "placeholder", "sprite", "favicon"
    ].some(term => lower.includes(term));

    if (!isExcluded) {
      return absoluteUrl;
    }
  }

  return null;
}

/**
 * Downloads the target image under SSRF protection constraints and converts it to a base64 Data URL.
 */
export async function downloadImageAsBase64(
  imageUrlStr: string,
  maxRedirects = 5,
  maxSize = 2 * 1024 * 1024 // 2 MB maximum image size
): Promise<string> {
  let currentUrl = imageUrlStr;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const parsedUrl = new URL(currentUrl);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Invalid protocol for image download.");
    }

    const hostname = parsedUrl.hostname;
    if (!hostname) {
      throw new Error("Invalid image hostname.");
    }

    const ip = await resolveHostname(hostname);
    if (isPrivateIp(ip)) {
      throw new Error(`Forbidden connection to private IP range for image: ${ip}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/*",
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error("Image download request timed out.");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Image redirect without location header.");
      }
      currentUrl = new URL(location, currentUrl).toString();
      redirectCount++;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch image. Status: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Invalid image content type: ${contentType}`);
    }

    // Read image body up to 2 MB limit
    const reader = response.body?.getReader();
    if (!reader) {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > maxSize) {
        throw new Error("Image size exceeds the 2 MB limit.");
      }
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      return `data:${contentType};base64,${base64}`;
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
            throw new Error("Image size exceeds the 2 MB limit.");
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

    const base64 = Buffer.from(combined.buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  }

  throw new Error("Too many redirects fetching image.");
}

/**
 * Selects, downloads, and base64 encodes the featured image.
 * Safely recovers on failure by returning a null dataUrl.
 */
export async function extractAndProxyImage(dom: JSDOM, finalUrl: string): Promise<ImageResult> {
  const imageUrl = selectImageCandidate(dom, finalUrl);
  if (!imageUrl) {
    return { imageUrl: null, imageDataUrl: null };
  }

  try {
    const imageDataUrl = await downloadImageAsBase64(imageUrl);
    return { imageUrl, imageDataUrl };
  } catch (err) {
    console.error(`Failed to proxy image ${imageUrl}:`, err);
    // Graceful fallback: return the raw URL but null proxy data
    return { imageUrl, imageDataUrl: null };
  }
}
