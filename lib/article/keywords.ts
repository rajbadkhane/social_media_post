const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "to", "in", "of",
  "that", "this", "for", "on", "with", "as", "by", "at", "it", "its", "from", "he",
  "she", "they", "we", "you", "who", "which", "can", "will", "be", "been", "have",
  "has", "had", "do", "does", "did", "about", "their", "there", "then", "more", "some",
  "hasn", "haven", "hadn", "don", "doesn", "didn", "wasn", "weren", "isn", "aren",
  "है", "हैं", "का", "की", "के", "को", "में", "से", "पर", "और", "कि", "यह", "वह",
  "तो", "भी", "ने", "इस", "उस", "या", "आदि", "रहा", "रही", "रहे", "था", "थी",
  "थे", "गया", "गई", "गए", "कर", "करना", "करने", "हो", "होता", "होती", "होते",
  "about", "above", "after", "again", "against", "all", "am", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
  "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
  "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further",
  "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll",
  "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how",
  "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
  "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
  "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought",
  "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd",
  "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that",
  "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's",
  "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through",
  "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll",
  "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
  "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't",
  "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
  "yourself", "yourselves"
]);

const GENERIC_WORDS = new Set([
  "news", "article", "report", "headline", "daily", "press", "update", "media", "website",
  "post", "blog", "information", "click", "read", "share", "comment", "subscribe",
  "समाचार", "खबर", "रिपोर्ट", "अपडेट", "मीडिया", "वेबसाइट", "पोस्ट", "ब्लॉग"
]);

export interface KeywordsResult {
  primary: string[];
  secondary: string[];
  longTail: string[];
}

/**
 * Standard word cleaning.
 */
function cleanWord(w: string): string {
  return w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'।]/g, "").trim().toLowerCase();
}

/**
 * Checks if a word is capitalized (useful for English proper nouns).
 */
function isProperNoun(word: string): boolean {
  if (word.length < 2) return false;
  return word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
}

/**
 * Generates n-grams (1, 2, or 3 words) from an array of tokens.
 */
function generateNgrams(tokens: string[], n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    const slice = tokens.slice(i, i + n);
    // Ignore if any word is a stop word or is purely numeric
    if (slice.some(word => STOP_WORDS.has(word.toLowerCase()) || /^\d+$/.test(word))) {
      continue;
    }
    // Ignore if first or last word is generic
    if (GENERIC_WORDS.has(slice[0].toLowerCase()) || GENERIC_WORDS.has(slice[slice.length - 1].toLowerCase())) {
      continue;
    }
    ngrams.push(slice.join(" "));
  }
  return ngrams;
}

/**
 * Deterministically extracts metadata keywords.
 */
export function extractKeywords(articleText: string, cleanedTitle: string): KeywordsResult {
  const titleTokens = cleanedTitle.split(/\s+/).map(cleanWord).filter(w => w.length > 1);
  const bodyTokens = articleText.split(/\s+/).map(cleanWord).filter(w => w.length > 1);

  const rawBodyWords = articleText.split(/\s+/).filter(w => w.length > 1);

  // 1. Extract Proper Nouns (English only helper)
  const properNounsMap = new Map<string, number>();
  rawBodyWords.forEach((word, index) => {
    // A word is a proper noun if it is capitalized and not the first word of a sentence
    if (isProperNoun(word) && index > 0) {
      const prevWord = rawBodyWords[index - 1];
      const isStartOfSentence = /[.!?।]$/.test(prevWord);
      if (!isStartOfSentence) {
        const cleaned = cleanWord(word);
        if (cleaned.length > 2 && !STOP_WORDS.has(cleaned) && !GENERIC_WORDS.has(cleaned)) {
          properNounsMap.set(cleaned, (properNounsMap.get(cleaned) || 0) + 1);
        }
      }
    }
  });

  // Build n-grams maps
  const unigrams = generateNgrams(bodyTokens, 1);
  const bigrams = generateNgrams(bodyTokens, 2);
  const trigrams = generateNgrams(bodyTokens, 3);

  const freqMap = new Map<string, number>();
  [...unigrams, ...bigrams, ...trigrams].forEach(phrase => {
    freqMap.set(phrase, (freqMap.get(phrase) || 0) + 1);
  });

  // Group phrases by word length
  const scoredPhrases = Array.from(freqMap.entries()).map(([phrase, count]) => {
    const isTitleMatch = cleanedTitle.toLowerCase().includes(phrase.toLowerCase());
    // Give extra weight if it appears in the title
    const score = count * (isTitleMatch ? 8 : 1);
    return { phrase, count, score };
  });

  // Sort phrases by score descending
  scoredPhrases.sort((a, b) => b.score - a.score);

  // A. Primary Keywords (3-5 phrases)
  // Favour phrases (1, 2, or 3 words) appearing in both headline and body text
  const primaryCandidates = scoredPhrases.filter(item => {
    const phraseLower = item.phrase.toLowerCase();
    const matchesTitle = cleanedTitle.toLowerCase().includes(phraseLower);
    return matchesTitle && item.count >= 2;
  });

  const primary: string[] = [];
  for (const item of primaryCandidates) {
    if (primary.length >= 5) break;
    // Prevent subset redundancy (e.g. if we have "world cup", we don't need "cup")
    const isRedundant = primary.some(p => p.includes(item.phrase) || item.phrase.includes(p));
    if (!isRedundant) {
      primary.push(item.phrase);
    }
  }

  // B. Fallback: If primary is too short, backfill with top unigrams/bigrams
  if (primary.length < 3) {
    for (const item of scoredPhrases) {
      if (primary.length >= 3) break;
      const isRedundant = primary.some(p => p.includes(item.phrase) || item.phrase.includes(p));
      if (!isRedundant) {
        primary.push(item.phrase);
      }
    }
  }

  // C. Secondary Keywords (5-8 phrases)
  // Include supporting topics, proper nouns, places, organisations
  const secondary: string[] = [];
  
  // First, look at top proper nouns extracted
  const sortedProperNouns = Array.from(properNounsMap.entries()).sort((a, b) => b[1] - a[1]);
  for (const [noun] of sortedProperNouns) {
    if (secondary.length >= 8) break;
    if (!primary.includes(noun)) {
      secondary.push(noun);
    }
  }

  // Second, fill remaining slots with top unigrams or bigrams not already selected
  for (const item of scoredPhrases) {
    if (secondary.length >= 8) break;
    if (primary.includes(item.phrase) || secondary.includes(item.phrase)) {
      continue;
    }
    const isRedundant = [...primary, ...secondary].some(p => p.includes(item.phrase) || item.phrase.includes(p));
    if (!isRedundant) {
      secondary.push(item.phrase);
    }
  }

  // D. Long-tail Keywords (3-5 phrases)
  // Longer, search-friendly descriptive phrases (favour 2-grams and 3-grams)
  const longTail: string[] = [];
  const longTailCandidates = scoredPhrases.filter(
    item => item.phrase.split(" ").length >= 2 && item.phrase.split(" ").length <= 3
  );

  for (const item of longTailCandidates) {
    if (longTail.length >= 5) break;
    if (primary.includes(item.phrase) || secondary.includes(item.phrase) || longTail.includes(item.phrase)) {
      continue;
    }
    const isRedundant = [...primary, ...secondary, ...longTail].some(p => p.includes(item.phrase));
    if (!isRedundant) {
      longTail.push(item.phrase);
    }
  }

  // Safe formatting helper to capitalise words
  const capitalise = (str: string) => {
    return str
      .split(" ")
      .map(word => {
        // If it looks like Hindi text, don't capitalise
        if (/[\u0900-\u097F]/.test(word)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
  };

  return {
    primary: primary.slice(0, 5).map(capitalise),
    secondary: secondary.slice(0, 8).map(capitalise),
    longTail: longTail.slice(0, 5).map(capitalise)
  };
}
