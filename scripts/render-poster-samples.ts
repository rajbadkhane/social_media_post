import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generatePoster, type PosterInput } from "../lib/generatePoster";

const imageUrl =
  "https://api.thecliffnews.in/uploads/images/2026/07/456334fd166fa82312874bda.webp";

function input(headline: string, language: string): PosterInput {
  return {
    headline,
    summary: "This field is intentionally not rendered by the original poster template.",
    imageUrl,
    category: "National",
    seoHashtags: [],
    smoHashtags: [],
    captions: { facebook: "", instagram: "", linkedin: "", twitter: "" },
    language,
  };
}

async function main(): Promise<void> {
  const outputDirectory = path.join(process.cwd(), "artifacts");
  await mkdir(outputDirectory, { recursive: true });

  const [english, hindi] = await Promise.all([
    generatePoster(
      input(
        "Thousands of 'Cockroach Protesters' to March on Parliament for Education Reforms",
        "English",
      ),
    ),
    generatePoster(
      input(
        "शिक्षा सुधारों के लिए संसद की ओर बढ़ेंगे हजारों 'कॉकरोच प्रदर्शनकारी'",
        "Hindi",
      ),
    ),
  ]);

  await Promise.all([
    writeFile(path.join(outputDirectory, "poster-english.png"), english),
    writeFile(path.join(outputDirectory, "poster-hindi.png"), hindi),
  ]);

  console.log("Poster samples written", {
    englishBytes: english.length,
    hindiBytes: hindi.length,
    outputDirectory,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
