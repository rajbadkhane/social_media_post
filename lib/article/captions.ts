/**
 * Formats Facebook, Instagram, LinkedIn, and Twitter/X captions using rule-based templates.
 */
export interface CaptionsResult {
  facebook: string;
  instagram: string;
  linkedin: string;
  twitter: string;
}

export function generateTwitterCaption(headline: string, summary: string, hashtags: string[]): string {
  const selectedTags = hashtags.slice(0, 3).join(" "); // Use top 3 hashtags
  
  // Format: {headline} - {first summary sentence} {hashtags}
  const sentences = summary.split(/(?<=[.!?।])\s+/).map(s => s.trim()).filter(Boolean);
  const firstSentence = sentences[0] || "";

  const fullCaption = `${headline} - ${firstSentence} ${selectedTags}`.trim();
  if (fullCaption.length <= 280) {
    return fullCaption;
  }

  // Fallback 1: Headline + Hashtags only
  const fallback1 = `${headline} ${selectedTags}`.trim();
  if (fallback1.length <= 280) {
    return fallback1;
  }

  // Fallback 2: Truncated headline + Hashtags
  const maxHeadlineLength = 280 - selectedTags.length - 5;
  if (maxHeadlineLength > 10) {
    const truncated = headline.substring(0, maxHeadlineLength).trim() + "...";
    return `${truncated} ${selectedTags}`;
  }

  // Hard fallback
  return headline.substring(0, 277) + "...";
}

export function generateCaptions(
  headline: string,
  summary: string,
  primaryKeywords: string[],
  seoHashtags: string[],
  smoHashtags: string[]
): CaptionsResult {
  // A. Facebook
  const fbTags = seoHashtags.slice(0, 6).join(" ");
  const facebook = `${headline}

${summary}

Read the complete report on The Cliff News.

${fbTags}`.trim();

  // B. Instagram
  const igTags = smoHashtags.join(" ");
  const instagram = `${headline}

${summary}

Follow The Cliff News for more national and international updates.

${igTags}`.trim();

  // C. LinkedIn
  const keyTopics = primaryKeywords.join(", ");
  const linkedin = `News Update: ${headline}

${summary}

Key topics: ${keyTopics}

Read the complete report on The Cliff News.`.trim();

  // D. Twitter/X
  const twitter = generateTwitterCaption(headline, summary, smoHashtags);

  return {
    facebook,
    instagram,
    linkedin,
    twitter,
  };
}
