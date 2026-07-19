const sharp = require("sharp");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const token = requireEnv("FACEBOOK_PAGE_ACCESS_TOKEN");
  const pageId = requireEnv("FACEBOOK_PAGE_ID");
  const graphVersion = process.env.META_GRAPH_API_VERSION?.trim() || "v23.0";
  const graphBase = `https://graph.facebook.com/${graphVersion}`;
  const image = await sharp({
    create: {
      width: 1080,
      height: 720,
      channels: 3,
      background: { r: 11, g: 11, b: 11 },
    },
  }).jpeg({ quality: 80 }).toBuffer();

  const form = new FormData();
  form.append("source", new Blob([image], { type: "image/jpeg" }), "facebook-permission-test.jpg");
  form.append("caption", "The Cliff News automated publishing permission test");
  form.append("published", "false");
  form.append("access_token", token);

  const create = await fetch(`${graphBase}/${encodeURIComponent(pageId)}/photos`, {
    method: "POST",
    body: form,
  });
  const createBody = await create.json().catch(() => ({}));
  if (!create.ok || typeof createBody.id !== "string") {
    throw new Error(`Facebook unpublished photo creation failed: ${JSON.stringify(createBody)}`);
  }

  const deletion = await fetch(
    `${graphBase}/${encodeURIComponent(createBody.id)}?access_token=${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
  const deletionBody = await deletion.json().catch(() => ({}));
  if (!deletion.ok || deletionBody.success !== true) {
    throw new Error(`Facebook test photo ${createBody.id} was created but cleanup failed: ${JSON.stringify(deletionBody)}`);
  }

  console.log(JSON.stringify({ success: true, unpublishedPhotoCreated: true, deleted: true }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
