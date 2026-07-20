const { del, put } = require("@vercel/blob");
const sharp = require("sharp");

const graphVersion = process.env.META_GRAPH_API_VERSION?.trim() || "v23.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function graph(pathname, token, init) {
  const separator = pathname.includes("?") ? "&" : "?";
  const response = await fetch(
    `${graphBase}/${pathname}${separator}access_token=${encodeURIComponent(token)}`,
    init,
  );
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function findPageToken(userToken, pageId) {
  const accounts = await graph("me/accounts?fields=id,name,tasks,access_token", userToken);
  if (!accounts.response.ok) {
    throw new Error(`Page lookup failed: ${JSON.stringify(accounts.body)}`);
  }

  const page = Array.isArray(accounts.body.data)
    ? accounts.body.data.find((item) => item.id === pageId)
    : undefined;

  if (!page) throw new Error(`Page ${pageId} is not available to this token`);
  if (typeof page.access_token !== "string" || !page.access_token.trim()) {
    throw new Error(`Page ${pageId} did not return a Page access token`);
  }

  return {
    id: page.id,
    name: page.name,
    tasks: page.tasks,
    accessToken: page.access_token.trim(),
  };
}

async function connectedInstagram(pageId, pageToken) {
  const connected = await graph(
    `${encodeURIComponent(pageId)}?fields=id,name,instagram_business_account{id,username},connected_instagram_account{id,username}`,
    pageToken,
  );
  if (!connected.response.ok) {
    throw new Error(`Instagram lookup failed: ${JSON.stringify(connected.body)}`);
  }

  return connected.body.instagram_business_account || connected.body.connected_instagram_account || null;
}

async function testFacebookPhoto(pageId, pageToken) {
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
  form.append("access_token", pageToken);

  const create = await fetch(`${graphBase}/${encodeURIComponent(pageId)}/photos`, {
    method: "POST",
    body: form,
  });
  const createBody = await create.json().catch(() => ({}));
  if (!create.ok || typeof createBody.id !== "string") {
    throw new Error(`Facebook unpublished photo creation failed: ${JSON.stringify(createBody)}`);
  }

  const deletion = await fetch(
    `${graphBase}/${encodeURIComponent(createBody.id)}?access_token=${encodeURIComponent(pageToken)}`,
    { method: "DELETE" },
  );
  const deletionBody = await deletion.json().catch(() => ({}));
  if (!deletion.ok || deletionBody.success !== true) {
    throw new Error(`Facebook test photo ${createBody.id} was created but cleanup failed: ${JSON.stringify(deletionBody)}`);
  }
}

async function profileWorks(accountId, token) {
  const profile = await graph(`${encodeURIComponent(accountId)}?fields=id,username,media_count`, token);
  return profile.response.ok && profile.body.id === accountId;
}

async function testInstagramContainer(accountId, tokens) {
  let url;
  try {
    const image = await sharp({
      create: {
        width: 1080,
        height: 1350,
        channels: 3,
        background: { r: 11, g: 11, b: 11 },
      },
    }).jpeg({ quality: 85 }).toBuffer();

    const blob = await put("social-posters/instagram-token-test.jpg", image, {
      access: "public",
      addRandomSuffix: true,
      cacheControlMaxAge: 60,
      contentType: "image/jpeg",
    });
    url = blob.url;

    for (const candidate of tokens) {
      const form = new URLSearchParams({
        image_url: url,
        caption: "The Cliff News Instagram token verification",
        access_token: candidate.token,
      });

      const create = await fetch(`${graphBase}/${encodeURIComponent(accountId)}/media`, {
        method: "POST",
        body: form,
      });
      const createBody = await create.json().catch(() => ({}));
      if (create.ok && typeof createBody.id === "string") {
        return { tokenType: candidate.type, creationId: createBody.id };
      }
    }

    throw new Error("Instagram media container creation failed for both candidate tokens");
  } finally {
    if (url) await del(url);
  }
}

async function main() {
  const userToken = requireEnv("NEW_META_ACCESS_TOKEN");
  const pageId = requireEnv("FACEBOOK_PAGE_ID");
  const configuredInstagramId = process.env.INSTAGRAM_ACCOUNT_ID?.trim();

  const me = await graph("me?fields=id,name", userToken);
  if (!me.response.ok) throw new Error(`User token check failed: ${JSON.stringify(me.body)}`);

  const page = await findPageToken(userToken, pageId);
  await testFacebookPhoto(page.id, page.accessToken);

  const instagram = await connectedInstagram(page.id, page.accessToken);
  const instagramId = instagram?.id || configuredInstagramId;
  if (!instagramId) throw new Error("No connected Instagram account found");

  const userTokenWorks = await profileWorks(instagramId, userToken);
  const pageTokenWorks = await profileWorks(instagramId, page.accessToken);
  const container = await testInstagramContainer(instagramId, [
    { type: "user", token: userToken },
    { type: "page", token: page.accessToken },
  ]);

  console.log(JSON.stringify({
    facebook: {
      pageId: page.id,
      pageName: page.name,
      tasks: page.tasks,
      derivedPageToken: true,
      unpublishedPhotoCreateAndDelete: true,
    },
    instagram: {
      accountId: instagramId,
      username: instagram?.username,
      userTokenProfileWorks: userTokenWorks,
      pageTokenProfileWorks: pageTokenWorks,
      mediaContainerCreated: true,
      mediaContainerTokenType: container.tokenType,
    },
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
