/**
 * Detects the language of the text based on Unicode character ratios (Devanagari vs. Latin).
 * Returns 'Hindi', 'English', or 'Mixed'.
 */
export function detectLanguage(title: string, bodyText: string): "Hindi" | "English" | "Mixed" {
  const sample = (title + " " + bodyText.slice(0, 2000)).trim();
  if (sample.length === 0) return "English";

  let devanagariCount = 0;
  let latinCount = 0;
  let totalAlphabetic = 0;

  for (let i = 0; i < sample.length; i++) {
    const charCode = sample.charCodeAt(i);

    // Devanagari range: 0x0900 - 0x097F
    if (charCode >= 0x0900 && charCode <= 0x097f) {
      devanagariCount++;
      totalAlphabetic++;
    }
    // Latin range: A-Z (65-90) or a-z (97-122)
    else if ((charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122)) {
      latinCount++;
      totalAlphabetic++;
    }
  }

  if (totalAlphabetic === 0) return "English";

  const devanagariRatio = devanagariCount / totalAlphabetic;
  const latinRatio = latinCount / totalAlphabetic;

  if (devanagariRatio > 0.7) {
    return "Hindi";
  } else if (latinRatio > 0.7) {
    return "English";
  } else {
    return "Mixed";
  }
}
