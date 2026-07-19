import { NextRequest, NextResponse } from "next/server";
import { scrapeArticle } from "../../../lib/article/fetchArticle";
import { extractMetadata } from "../../../lib/article/extractMetadata";
import { extractAndProxyImage } from "../../../lib/article/extractImage";
import { summarizeArticle } from "../../../lib/article/summarize";
import { extractKeywords } from "../../../lib/article/keywords";
import { generateHashtags } from "../../../lib/article/hashtags";
import { detectCategory } from "../../../lib/article/category";
import { detectLanguage } from "../../../lib/article/language";
import { generateCaptions } from "../../../lib/article/captions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body;

    // 1. URL validation
    if (!url) {
      return NextResponse.json({ success: false, error: "Missing article URL" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid URL format" }, { status: 400 });
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json(
        { success: false, error: "Invalid protocol. Only http: and https: are allowed." },
        { status: 400 }
      );
    }

    // 2. Fetch and scrape the article html (with timeout, SSRF protection, readability fallbacks)
    let scraped;
    try {
      scraped = await scrapeArticle(url);
    } catch (err: any) {
      console.error("Scraping error:", err);
      return NextResponse.json({ success: false, error: err.message || "Failed to parse article" }, { status: 400 });
    }

    const { rawTitle, mainText, source, publishedAt, canonicalUrl, jsdom } = scraped;

    if (!mainText || mainText.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Failed to extract readable text content from the webpage." },
        { status: 422 }
      );
    }

    // 3. Extract and clean metadata
    const metadata = extractMetadata(
      jsdom,
      rawTitle,
      rawTitle, // Readability title fallback
      source,
      canonicalUrl,
      publishedAt
    );

    // 4. Extract and Base64 proxy the featured image (with SSRF protection)
    const imageResult = await extractAndProxyImage(jsdom, canonicalUrl);

    // 5. Generate summary (extractive, 35-60 words)
    const summary = summarizeArticle(mainText, metadata.title);

    // 6. Extract Keywords
    const keywords = extractKeywords(mainText, metadata.title);

    // 7. Generate SEO & SMO Hashtags
    const hashtags = generateHashtags(
      metadata.title,
      keywords.primary,
      keywords.secondary,
      "News" // fallback category tag
    );

    // 8. Detect Category
    const category = detectCategory(metadata.title, keywords.primary.concat(keywords.secondary), summary, mainText);

    // Update SMO hashtags with actual category if detected
    const finalHashtags = generateHashtags(
      metadata.title,
      keywords.primary,
      keywords.secondary,
      category
    );

    // 9. Detect Language
    const language = detectLanguage(metadata.title, mainText);

    // 10. Calculate Reading Time & Word Count
    const wordCount = mainText.split(/\s+/).length;
    const wpm = language === "Hindi" ? 180 : language === "Mixed" ? 190 : 200;
    const readingTime = Math.max(1, Math.round(wordCount / wpm));

    // 11. Generate Social Captions
    const captions = generateCaptions(
      metadata.title,
      summary,
      keywords.primary,
      finalHashtags.seoHashtags,
      finalHashtags.smoHashtags
    );

    // Return the final structured response
    return NextResponse.json({
      success: true,
      data: {
        title: metadata.title,
        articleText: mainText,
        summary,
        imageUrl: imageResult.imageUrl,
        imageDataUrl: imageResult.imageDataUrl,
        canonicalUrl: metadata.canonicalUrl,
        sourceName: metadata.sourceName,
        publishedAt: metadata.publishedAt,
        seoHashtags: finalHashtags.seoHashtags,
        smoHashtags: finalHashtags.smoHashtags,
        keywords,
        captions,
        category,
        language,
        readingTime,
        wordCount
      }
    });
  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json(
      { success: false, error: `Internal Server Error: ${error.message || error}` },
      { status: 500 }
    );
  }
}
