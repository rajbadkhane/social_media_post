import { resolveHostname, isPrivateIp } from "./security";
import { JSDOM } from "jsdom";

export interface StandardPost {
  title: string;
  url: string;
  imageUrl: string | null;
  publishedAt: string | null;
  summary: string | null;
}

export async function fetchApiPosts(urlStr: string): Promise<StandardPost[]> {
  const parsedUrl = new URL(urlStr);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only http: and https: protocols are allowed.");
  }

  const hostname = parsedUrl.hostname;
  if (!hostname) {
    throw new Error("Invalid URL hostname.");
  }

  const ip = await resolveHostname(hostname);
  if (isPrivateIp(ip)) {
    throw new Error(`Forbidden connection to private IP range: ${ip}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(urlStr, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json,application/rss+xml,application/xml,text/xml,*/*",
      },
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

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();

  // 1. If it's XML (RSS or Atom)
  if (
    contentType.includes("xml") ||
    bodyText.trim().startsWith("<")
  ) {
    return parseXmlFeed(bodyText);
  }

  // 2. If it's JSON
  try {
    const json = JSON.parse(bodyText);
    return parseJsonFeed(json);
  } catch (err) {
    console.error("JSON parsing error:", err);
    throw new Error("Failed to parse the response as JSON or XML feed.");
  }
}

function parseJsonFeed(json: any): StandardPost[] {
  let list: any[] | null = null;
  if (Array.isArray(json)) {
    list = json;
  } else {
    // Look for array inside object
    const keys = ["posts", "items", "articles", "data", "results", "entries", "list"];
    for (const key of keys) {
      if (Array.isArray(json[key])) {
        list = json[key];
        break;
      }
    }
    if (!list) {
      for (const key of Object.keys(json)) {
        if (Array.isArray(json[key])) {
          list = json[key];
          break;
        }
      }
    }
  }

  if (!list) {
    throw new Error("Could not find any list of posts in the API JSON response.");
  }

  const posts: StandardPost[] = [];
  for (const item of list.slice(0, 10)) {
    // 1. Title
    let title = "";
    if (item.title) {
      title = typeof item.title === "object" ? item.title.rendered || "" : item.title;
    } else if (item.headline) {
      title = item.headline;
    } else if (item.subject) {
      title = item.subject;
    }

    // 2. URL
    let url = "";
    if (item.link) {
      url = typeof item.link === "object" ? item.link.rendered || "" : item.link;
    } else if (item.url) {
      url = item.url;
    } else if (item.canonicalUrl) {
      url = item.canonicalUrl;
    } else if (item.guid) {
      url = typeof item.guid === "object" ? item.guid.rendered || "" : item.guid;
    }

    // 3. Image
    let imageUrl: string | null = null;
    if (item.jetpack_featured_media_url) {
      imageUrl = item.jetpack_featured_media_url;
    } else if (item.featured_image_url) {
      imageUrl = item.featured_image_url;
    } else if (item.imageUrl) {
      imageUrl = item.imageUrl;
    } else if (item.og_image) {
      imageUrl = item.og_image;
    } else if (item.image) {
      imageUrl = typeof item.image === "object" ? item.image.url || null : item.image;
    }

    // 4. Date
    let publishedAt: string | null = null;
    if (item.date_gmt || item.date) {
      publishedAt = item.date_gmt || item.date;
    } else if (item.published_at) {
      publishedAt = item.published_at;
    } else if (item.pubDate) {
      publishedAt = item.pubDate;
    } else if (item.created_at) {
      publishedAt = item.created_at;
    }

    // 5. Excerpt / Summary
    let summary: string | null = null;
    if (item.excerpt) {
      summary = typeof item.excerpt === "object" ? item.excerpt.rendered || "" : item.excerpt;
    } else if (item.description) {
      summary = item.description;
    } else if (item.summary) {
      summary = item.summary;
    }

    if (summary) {
      summary = summary.replace(/<[^>]*>/g, "").slice(0, 150).trim();
    }

    posts.push({
      title: title ? title.trim() : "Untitled Post",
      url: url ? url.trim() : "",
      imageUrl: imageUrl ? imageUrl.trim() : null,
      publishedAt: publishedAt ? publishedAt.trim() : null,
      summary: summary || null,
    });
  }

  return posts;
}

function parseXmlFeed(xmlText: string): StandardPost[] {
  const dom = new JSDOM(xmlText, { contentType: "text/xml" });
  const doc = dom.window.document;
  const posts: StandardPost[] = [];

  const items = doc.querySelectorAll("item");
  if (items.length > 0) {
    for (const item of Array.from(items).slice(0, 10)) {
      const title = item.querySelector("title")?.textContent || "";
      const url = item.querySelector("link")?.textContent || "";
      const pubDate = item.querySelector("pubDate")?.textContent || null;
      const description = item.querySelector("description")?.textContent || "";
      
      let imageUrl: string | null = null;
      const mediaContent = item.querySelector("content");
      if (mediaContent && mediaContent.getAttribute("url")) {
        imageUrl = mediaContent.getAttribute("url");
      }
      if (!imageUrl) {
        const enclosure = item.querySelector("enclosure");
        if (enclosure && enclosure.getAttribute("type")?.startsWith("image/") && enclosure.getAttribute("url")) {
          imageUrl = enclosure.getAttribute("url");
        }
      }

      posts.push({
        title: title.trim() || "Untitled Post",
        url: url.trim(),
        imageUrl: imageUrl ? imageUrl.trim() : null,
        publishedAt: pubDate ? pubDate.trim() : null,
        summary: description ? description.replace(/<[^>]*>/g, "").slice(0, 150).trim() : null,
      });
    }
    return posts;
  }

  const entries = doc.querySelectorAll("entry");
  if (entries.length > 0) {
    for (const entry of Array.from(entries).slice(0, 10)) {
      const title = entry.querySelector("title")?.textContent || "";
      
      let url = "";
      const link = entry.querySelector("link");
      if (link) {
        url = link.getAttribute("href") || link.textContent || "";
      }
      
      const published = (entry.querySelector("published") || entry.querySelector("updated"))?.textContent || null;
      const summary = (entry.querySelector("summary") || entry.querySelector("content"))?.textContent || "";

      let imageUrl: string | null = null;
      const mediaThumbnail = entry.querySelector("thumbnail");
      if (mediaThumbnail && mediaThumbnail.getAttribute("url")) {
        imageUrl = mediaThumbnail.getAttribute("url");
      }

      posts.push({
        title: title.trim() || "Untitled Post",
        url: url.trim(),
        imageUrl: imageUrl ? imageUrl.trim() : null,
        publishedAt: published ? published.trim() : null,
        summary: summary ? summary.replace(/<[^>]*>/g, "").slice(0, 150).trim() : null,
      });
    }
    return posts;
  }

  return [];
}
