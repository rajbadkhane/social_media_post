const ENGLISH_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "to", "in", "of",
  "that", "this", "for", "on", "with", "as", "by", "at", "it", "its", "from", "he",
  "she", "they", "we", "you", "who", "which", "can", "will", "be", "been", "have",
  "has", "had", "do", "does", "did", "about", "their", "there", "then", "more", "some"
]);

const HINDI_STOP_WORDS = new Set([
  "है", "हैं", "का", "की", "के", "को", "में", "से", "पर", "और", "कि", "यह", "वह",
  "तो", "भी", "ने", "इस", "उस", "या", "आदि", "रहा", "रही", "रहे", "था", "थी",
  "थे", "गया", "गई", "गए", "कर", "करना", "करने", "हो", "होता", "होती", "होते"
]);

const EXCLUDE_PATTERNS = [
  /subscribe/i, /newsletter/i, /register/i, /comment below/i, /read more/i,
  /copyright/i, /follow us/i, /sign up/i, /terms of use/i, /privacy policy/i,
  /all rights reserved/i, /advertisement/i, /cookies/i,
  /सब्सक्राइब/, /न्यूज़लेटर/, /फॉलो करें/, /और पढ़ें/, /कॉपीराइट/, /पंजीकरण/,
  /कमेंट/, /विज्ञापन/, /नियम व शर्तें/
];

/**
 * Splits text into individual sentences supporting English (.!?) and Hindi (।).
 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  // Split using lookbehind for sentence-ending punctuation: . ! ? or Hindi danda
  return text
    .split(/(?<=[.!?।])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Tokenizes text, converting to lowercase and stripping punctuation.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'।]/g, "")
    .split(/\s+/)
    .filter(word => word.length > 1);
}

interface ScoredSentence {
  text: string;
  originalIndex: number;
  score: number;
  wordCount: number;
}

/**
 * Deterministically generates a 35-60 word extractive summary.
 */
export function summarizeArticle(articleText: string, cleanedTitle: string): string {
  const sentences = splitSentences(articleText);
  if (sentences.length === 0) return "";

  // Fallback if the article is too short
  if (sentences.length <= 2) {
    return sentences.join(" ");
  }

  // Pre-process title tokens for overlap scoring
  const titleTokens = new Set(tokenize(cleanedTitle).filter(w => !ENGLISH_STOP_WORDS.has(w) && !HINDI_STOP_WORDS.has(w)));

  // Build global word frequency map
  const wordFrequencyMap = new Map<string, number>();
  let totalValidWords = 0;

  const validSentences: ScoredSentence[] = [];

  sentences.forEach((sentenceText, index) => {
    const wordCount = sentenceText.split(/\s+/).length;

    // Filter out short sentences
    if (wordCount < 6) return;

    // Filter out promotional or boilerplate sentences
    const isPromo = EXCLUDE_PATTERNS.some(regex => regex.test(sentenceText));
    if (isPromo) return;

    const tokens = tokenize(sentenceText);
    const uniqueTokens = new Set(tokens);

    // Populate frequency map with non-stop-words
    for (const token of uniqueTokens) {
      if (ENGLISH_STOP_WORDS.has(token) || HINDI_STOP_WORDS.has(token)) {
        continue;
      }
      wordFrequencyMap.set(token, (wordFrequencyMap.get(token) || 0) + 1);
      totalValidWords++;
    }

    validSentences.push({
      text: sentenceText,
      originalIndex: index,
      score: 0,
      wordCount
    });
  });

  // If no sentences passed the filter, use first two sentences as safety fallback
  if (validSentences.length === 0) {
    return sentences.slice(0, 2).join(" ");
  }

  // Score sentences
  validSentences.forEach(sentence => {
    const tokens = tokenize(sentence.text);
    const uniqueTokens = new Set(tokens);

    let frequencyScore = 0;
    let titleOverlapCount = 0;

    for (const token of uniqueTokens) {
      if (ENGLISH_STOP_WORDS.has(token) || HINDI_STOP_WORDS.has(token)) {
        continue;
      }
      frequencyScore += wordFrequencyMap.get(token) || 0;
      if (titleTokens.has(token)) {
        titleOverlapCount++;
      }
    }

    // Normalized frequency score
    const normFrequency = totalValidWords > 0 ? frequencyScore / totalValidWords : 0;

    // Inverted pyramid: give higher weight to sentences appearing earlier
    // first sentence gets +10 points, 10th gets +1, subsequent get 0
    const positionScore = Math.max(0, 10 - sentence.originalIndex) * 1.5;

    // Title overlap bonus
    const titleOverlapScore = titleOverlapCount * 3.0;

    // Sentence length optimization: penalize extremely long sentences
    const lengthPenalty = sentence.wordCount > 30 ? -5 : 0;

    sentence.score = (normFrequency * 100) + positionScore + titleOverlapScore + lengthPenalty;
  });

  // Sort by score descending to pick the best ones
  const bestSentences = [...validSentences].sort((a, b) => b.score - a.score);

  // Accumulate sentences to fit the 35-60 word limit
  const selected: ScoredSentence[] = [];
  let currentWordCount = 0;

  for (const sentence of bestSentences) {
    // Avoid duplicates or very similar sentences
    const isDuplicate = selected.some(
      s => s.text.toLowerCase().substring(0, 20) === sentence.text.toLowerCase().substring(0, 20)
    );
    if (isDuplicate) continue;

    selected.push(sentence);
    currentWordCount += sentence.wordCount;

    // If we've reached at least 35 words and have at least 2 sentences, we can stop
    if (currentWordCount >= 35 && selected.length >= 2) {
      break;
    }
    // Cap strictly so we don't exceed 70 words
    if (currentWordCount >= 60) {
      break;
    }
  }

  // Fallback: If we couldn't assemble a summary, use the first two valid sentences
  if (selected.length === 0) {
    return sentences.slice(0, 2).join(" ");
  }

  // Restore the selected sentences to their original order of appearance in the article
  selected.sort((a, b) => a.originalIndex - b.originalIndex);

  return selected.map(s => s.text).join(" ");
}
