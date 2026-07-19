const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const secret = process.env.AUTO_PUBLISH_SECRET;
  if (!secret) throw new Error("AUTO_PUBLISH_SECRET is unavailable");

  const response = await fetch(
    "https://the-cliff-news-poster-nextjs.vercel.app/api/social/poster-preview",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirm: true,
        language: "Hindi",
        headline: "शिक्षा सुधारों के लिए संसद की ओर बढ़ेंगे हजारों 'कॉकरोच प्रदर्शनकारी'",
        imageUrl:
          "https://api.thecliffnews.in/uploads/images/2026/07/456334fd166fa82312874bda.webp",
      }),
    },
  );

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok || response.headers.get("content-type") !== "image/png") {
    throw new Error(
      `Production poster preview failed (${response.status}): ${bytes.toString("utf8").slice(0, 500)}`,
    );
  }

  const outputDirectory = path.join(process.cwd(), "artifacts");
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "poster-production-hindi.png"), bytes);
  console.log("Production poster preview succeeded", {
    status: response.status,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
