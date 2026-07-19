const { del, put } = require("@vercel/blob");
const sharp = require("sharp");

async function main() {
  let url;
  try {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).png().toBuffer();

    const blob = await put("social-posters/storage-smoke-test.png", png, {
      access: "public",
      addRandomSuffix: true,
      cacheControlMaxAge: 60,
      contentType: "image/png",
    });
    url = blob.url;

    const response = await fetch(url);
    const body = await response.arrayBuffer();
    if (!response.ok) throw new Error(`Public Blob fetch failed (${response.status})`);

    console.log(JSON.stringify({
      uploaded: true,
      publicFetchStatus: response.status,
      contentType: response.headers.get("content-type"),
      host: new URL(url).host,
      sizeBytes: body.byteLength,
    }));
  } finally {
    if (url) await del(url);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
