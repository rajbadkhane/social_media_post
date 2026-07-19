/**
 * Cleans a string to turn it into a valid hashtag.
 * Strips non-alphanumeric characters and capitalizes each word (PascalCase).
 */
export function toHashtag(str: string): string {
  if (!str) return "";
  const cleanedParts = str
    .split(/\s+/)
    .map(word => {
      // Retain English alphanumeric and Hindi characters
      const cleaned = word.replace(/[^a-zA-Z0-9\u0900-\u097F]/g, "");
      if (cleaned.length === 0) return "";
      
      // If it has Devanagari characters, return as is since they don't have casing
      if (/[\u0900-\u097F]/.test(cleaned)) {
        return cleaned;
      }
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    })
    .filter(Boolean);
  
  if (cleanedParts.length === 0) return "";
  return "#" + cleanedParts.join("");
}

/**
 * Deterministically generates SEO and SMO hashtags.
 */
export function generateHashtags(
  cleanedTitle: string,
  primaryKeywords: string[],
  secondaryKeywords: string[],
  categoryName: string
): { seoHashtags: string[]; smoHashtags: string[] } {
  const seoCandidates = new Set<string>();
  const lowercaseCheck = new Set<string>();

  const addCandidate = (phrase: string) => {
    const hashtag = toHashtag(phrase);
    if (hashtag && hashtag.length > 2) {
      const lower = hashtag.toLowerCase();
      // Block generic website hashtags
      if (lower === "#thecliffnews" || lower === "#news" || lower === "#article") {
        return;
      }
      if (!lowercaseCheck.has(lower)) {
        lowercaseCheck.add(lower);
        seoCandidates.add(hashtag);
      }
    }
  };

  // 1. Add Category
  addCandidate(categoryName);

  // 2. Add Primary Keywords
  primaryKeywords.forEach(addCandidate);

  // 3. Add Title terms (split title by punctuation/spaces and take longer words)
  cleanedTitle
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'।]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 4)
    .forEach(addCandidate);

  // 4. Add Secondary Keywords
  secondaryKeywords.forEach(addCandidate);

  // Compile SEO hashtags (between 10 and 15)
  const seoList = Array.from(seoCandidates);
  const seoHashtags = seoList.slice(0, Math.min(15, Math.max(10, seoList.length)));

  // Compile SMO hashtags (up to 20 tags, lowercased, ending with #thecliffnews)
  const smoCandidates = new Set<string>();
  const smoCheck = new Set<string>();

  // Add category first
  const catTag = toHashtag(categoryName).toLowerCase();
  if (catTag) {
    smoCandidates.add(catTag);
    smoCheck.add(catTag);
  }

  // Add other tags from the list
  for (const tag of seoList) {
    const lowerTag = tag.toLowerCase();
    if (lowerTag !== "#thecliffnews" && !smoCheck.has(lowerTag)) {
      smoCheck.add(lowerTag);
      smoCandidates.add(lowerTag);
    }
  }

  // Cap at 19 so we can append #thecliffnews as the 20th tag
  const smoList = Array.from(smoCandidates).slice(0, 19);
  smoList.push("#thecliffnews");

  return {
    seoHashtags,
    smoHashtags: smoList
  };
}
