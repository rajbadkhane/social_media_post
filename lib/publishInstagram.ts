import { getSocialConfig } from "./config";
import { fetchWithTimeout, providerError, readJson } from "./http";

export async function publishInstagram(
  temporaryImageUrl: string,
  caption: string
): Promise<{ postId: string; postUrl?: string }> {
  const config = getSocialConfig();

  if (!config.instagramAccountId || !config.instagramAccessToken) {
    throw new Error(
      "Instagram Professional account credentials are incomplete"
    );
  }

  if (
    !temporaryImageUrl ||
    !temporaryImageUrl.startsWith("https://")
  ) {
    throw new Error(
      "Instagram requires a publicly accessible HTTPS image URL."
    );
  }

  const base = `https://graph.facebook.com/${config.metaGraphApiVersion}`;

  console.log("========== INSTAGRAM ==========");
  console.log("Image URL:", temporaryImageUrl);

  // ---------------------------------------------------
  // STEP 1 - Create Media Container
  // ---------------------------------------------------

  const create = await fetchWithTimeout(
    `${base}/${encodeURIComponent(config.instagramAccountId)}/media`,
    {
      method: "POST",
      body: new URLSearchParams({
        image_url: temporaryImageUrl,
        caption,
        access_token: config.instagramAccessToken,
      }),
    }
  );

  const createJson = await readJson(create);

  console.log("CREATE STATUS:", create.status);
  console.log(
    "CREATE RESPONSE:",
    JSON.stringify(createJson, null, 2)
  );

  if (!create.ok) {
    throw providerError("Instagram", create, createJson);
  }

  if (typeof createJson?.id !== "string") {
    throw new Error(
      "Instagram: media container response did not contain an ID."
    );
  }

  const creationId = createJson.id;

  console.log("Container ID:", creationId);

  // ---------------------------------------------------
  // STEP 2 - Wait Until Processing Completes
  // ---------------------------------------------------

  const deadline =
    Date.now() +
    config.instagramProcessingTimeoutSeconds * 1000;

  let finished = false;

  while (Date.now() < deadline) {
    const status = await fetchWithTimeout(
      `${base}/${encodeURIComponent(
        creationId
      )}?fields=status_code&access_token=${encodeURIComponent(
        config.instagramAccessToken
      )}`
    );

    const statusJson = await readJson(status);

    console.log(
      "STATUS RESPONSE:",
      JSON.stringify(statusJson, null, 2)
    );

    if (!status.ok) {
      throw providerError("Instagram", status, statusJson);
    }

    const code = statusJson?.status_code;

    if (code === "FINISHED") {
      finished = true;
      break;
    }

    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(
        `Instagram media container processing failed (${code}).`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!finished) {
    throw new Error(
      "Instagram media processing timed out."
    );
  }

  console.log("Media processing completed.");

  // ---------------------------------------------------
  // STEP 3 - Publish
  // ---------------------------------------------------

  const publish = await fetchWithTimeout(
    `${base}/${encodeURIComponent(
      config.instagramAccountId
    )}/media_publish`,
    {
      method: "POST",
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: config.instagramAccessToken,
      }),
    }
  );

  const publishJson = await readJson(publish);

  console.log("PUBLISH STATUS:", publish.status);
  console.log(
    "PUBLISH RESPONSE:",
    JSON.stringify(publishJson, null, 2)
  );
  console.log("==============================");

  if (!publish.ok) {
    throw providerError(
      "Instagram Publish",
      publish,
      publishJson
    );
  }

  if (typeof publishJson?.id !== "string") {
    throw new Error(
      "Instagram publish response did not contain a media ID."
    );
  }

  return {
    postId: publishJson.id,
  };
}