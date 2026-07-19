const { del, put } = require("@vercel/blob");
const sharp = require("sharp");

const endpoint = "https://the-cliff-news-poster-nextjs.vercel.app/api/test-instagram";

async function main() {
  const secret = process.env.AUTO_PUBLISH_SECRET?.trim();
  if (!secret) throw new Error("AUTO_PUBLISH_SECRET is required");

  let url;
  try {
    const poster = await sharp({
      create: {
        width: 1080,
        height: 720,
        channels: 4,
        background: { r: 11, g: 11, b: 11, alpha: 1 },
      },
    }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();

    const blob = await put("social-posters/instagram-download-test.jpg", poster, {
      access: "public",
      addRandomSuffix: true,
      cacheControlMaxAge: 60,
      contentType: "image/jpeg",
    });
    url = blob.url;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirm: true,
        imageUrl: url,
        caption: "The Cliff News storage verification",
        publish: false,
      }),
    });
    const body = await response.json().catch(() => ({}));
    console.log(JSON.stringify({ status: response.status, body }));
    if (!response.ok || body.success !== true || body.status !== "FINISHED") {
      process.exitCode = 1;
    }
  } finally {
    if (url) await del(url);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
