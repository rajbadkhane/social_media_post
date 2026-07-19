const CATEGORY_MAP: Record<string, string[]> = {
  Sports: ["cricket", "football", "match", "tournament", "player", "trophy", "athletics", "tennis", "badminton", "hockey", "f1", "racing", "olympics", "मैच", "खिलाड़ी", "खेल", "क्रिकेट", "फुटबॉल", "हॉकी", "टूर्नामेंट", "कप", "चैंपियंस"],
  Politics: ["election", "parliament", "minister", "government", "party", "senate", "vote", "politician", "governor", "president", "mayor", "bjp", "congress", "modi", "rahul gandhi", "चुनाव", "संसद", "मंत्री", "सरकार", "पार्टी", "नेता", "मतदान"],
  Business: ["stock", "company", "market", "economy", "trade", "business", "finance", "banking", "shares", "investment", "profit", "revenue", "gdp", "rbi", "व्यापार", "बाजार", "शेयर", "बैंक", "निवेश", "अर्थव्यवस्था", "कंपनी", "कारोबार"],
  Entertainment: ["film", "movie", "actor", "actress", "cinema", "bollywood", "hollywood", "show", "drama", "singer", "song", "music", "concert", "oscar", "थिएटर", "अभिनेता", "अभिनेत्री", "सिनेमा", "फिल्म", "बॉलीवुड", "संगीत", "गाना", "कलाकार"],
  Technology: ["ai", "software", "smartphone", "internet", "technology", "computer", "app", "chip", "tech", "gadget", "digital", "openai", "chatgpt", "कृत्रिम बुद्धिमत्ता", "तकनीक", "मोबाइल", "इंटरनेट", "कंप्यूटर", "ऐप", "सॉफ्टवेयर"],
  Education: ["school", "university", "examination", "education", "student", "college", "exam", "board", "teacher", "class", "result", "admissions", "शिक्षा", "परीक्षा", "छात्र", "विश्वविद्यालय", "कॉलेज", "स्कूल", "शिक्षक", "रिजल्ट"],
  Health: ["hospital", "disease", "health", "medical", "doctor", "virus", "vaccine", "treatment", "medicine", "patient", "covid", "cancer", "स्वास्थ्य", "अस्पताल", "डॉक्टर", "बीमारी", "इलाज", "दवा", "टीका", "मरीज"],
  Crime: ["police", "arrest", "murder", "theft", "crime", "court", "jail", "prison", "suspect", "robbery", "scam", "fraud", "kidnap", "पुलिस", "गिरफ्तार", "हत्या", "चोरी", "अपराध", "अदालत", "जेल", "संदिग्ध", "ठगी"],
  Science: ["space", "nasa", "research", "scientist", "orbit", "mars", "moon", "gene", "physics", "chemistry", "science", "satellite", "अंतरिक्ष", "नासा", "वैज्ञानिक", "शोध", "विज्ञान", "उपग्रह"],
  Environment: ["climate", "forest", "tree", "river", "carbon", "emission", "environment", "global warming", "pollution", "green", "wildlife", "tiger", "पर्यावरण", "वन", "नदी", "प्रदूषण", "जलवायु", "बाघ"],
  Automobile: ["car", "bike", "ev", "vehicle", "engine", "tesla", "launch", "hybrid", "motor", "auto", "suv", "कार", "बाइक", "वाहन", "ऑटोमोबाइल", "इंजन"],
  "Madhya Pradesh": ["madhya pradesh", "mp", "bhopal", "indore", "jabalpur", "gwalior", "ujjain", "shivraj", "mohan yadav", "rewa", "sagar", "satna", "dewas", "chhindwara", "singrauli", "मध्य प्रदेश", "भोपाल", "इंदौर", "जबलपुर", "ग्वालियर", "उज्जैन", "रीवा", "सागर", "सतना", "देवास", "छिंदवाड़ा", "सिंगरौली", "शिवराज", "मोहन यादव"],
  National: ["india", "indian", "delhi", "mumbai", "kolkata", "chennai", "modi", "pm", "center", "central", "isro", "bharat", "भारत", "भारतीय", "दिल्ली", "मुंबई", "कोलकाता", "चेन्नई", "मोदी", "प्रधान मंत्री"],
  International: ["us", "uk", "world", "un", "global", "international", "foreign", "trump", "biden", "china", "pakistan", "london", "washington", "russia", "ukraine", "israel", "gaza", "अंतरराष्ट्रीय", "वैश्विक", "विदेश", "ट्रम्प", "बाइडन", "चीन", "पाकिस्तान", "रूस", "यूक्रेन", "अमेरिका"]
};

/**
 * Checks if a text string contains a term, using word boundary checks for Latin words,
 * and simple substring matching for Devangari (Hindi) terms.
 */
function textContainsTerm(text: string, term: string): boolean {
  if (/[\u0900-\u097F]/.test(term)) {
    return text.includes(term);
  }
  const regex = new RegExp(`\\b${term}\\b`, "i");
  return regex.test(text);
}

/**
 * Counts all occurrences of a term in the given text.
 */
function countTermOccurrences(text: string, term: string): number {
  if (/[\u0900-\u097F]/.test(term)) {
    let count = 0;
    let pos = text.indexOf(term);
    while (pos !== -1) {
      count++;
      pos = text.indexOf(term, pos + term.length);
    }
    return count;
  }
  const regex = new RegExp(`\\b${term}\\b`, "gi");
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Classifies an article into a category based on weighted dictionary matches.
 */
export function detectCategory(
  cleanedTitle: string,
  keywords: string[],
  summary: string,
  articleText: string
): string {
  const scores: Record<string, number> = {};

  // Initialize
  for (const cat in CATEGORY_MAP) {
    scores[cat] = 0;
  }

  const titleLower = cleanedTitle.toLowerCase();
  const summaryLower = summary.toLowerCase();
  const bodyLower = articleText.toLowerCase();

  // 1. Headline Match (Weight 5)
  for (const [cat, terms] of Object.entries(CATEGORY_MAP)) {
    for (const term of terms) {
      if (textContainsTerm(titleLower, term)) {
        scores[cat] += 5;
      }
    }
  }

  // 2. Keyword Match (Weight 4)
  for (const [cat, terms] of Object.entries(CATEGORY_MAP)) {
    for (const term of terms) {
      const matchesKeyword = keywords.some(k => k.toLowerCase() === term.toLowerCase());
      if (matchesKeyword) {
        scores[cat] += 4;
      }
    }
  }

  // 3. Summary Match (Weight 3)
  for (const [cat, terms] of Object.entries(CATEGORY_MAP)) {
    for (const term of terms) {
      if (textContainsTerm(summaryLower, term)) {
        scores[cat] += 3;
      }
    }
  }

  // 4. Body Match (Weight 1)
  for (const [cat, terms] of Object.entries(CATEGORY_MAP)) {
    for (const term of terms) {
      const occurrences = countTermOccurrences(bodyLower, term);
      if (occurrences > 0) {
        scores[cat] += Math.min(5, occurrences); // Cap individual word frequency contribution to 5
      }
    }
  }

  // Find highest scoring category
  let bestCategory = "Other";
  let maxScore = 0;

  for (const [cat, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestCategory = cat;
    }
  }

  // Tie-breaker logic: Prefer specific categories over general ones (National / International)
  if (bestCategory === "National" || bestCategory === "International" || bestCategory === "Other") {
    const specificCategories = [
      "Madhya Pradesh", "Sports", "Politics", "Business", "Technology",
      "Entertainment", "Education", "Health", "Crime", "Science", "Environment", "Automobile"
    ];
    for (const cat of specificCategories) {
      // If a specific category score is within 3 points of the max score, prefer it
      if (scores[cat] && scores[cat] >= maxScore - 3 && scores[cat] > 0) {
        bestCategory = cat;
        maxScore = scores[cat];
        break;
      }
    }
  }

  return bestCategory;
}
