import { getSocialConfig } from "./config";
import { fetchWithTimeout, providerError, readJson } from "./http";

interface InstagramTarget {
  accountId: string;
  accessToken: string;
  username?: string;
}

interface InstagramProfile {
  id?: unknown;
  username?: unknown;
  media_count?: unknown;
}

interface PageInstagramResponse {
  instagram_business_account?: { id?: unknown; username?: unknown };
  connected_instagram_account?: { id?: unknown; username?: unknown };
}

function graphBase(): string {
  return `https://graph.facebook.com/${getSocialConfig().metaGraphApiVersion}`;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Instagram: ${label} is missing or malformed`);
  }

  return value.trim();
}

async function readProfile(
  accountId: string,
  accessToken: string
): Promise<InstagramProfile> {
  const response = await fetchWithTimeout(
    `${graphBase()}/${encodeURIComponent(
      accountId
    )}?fields=id,username,media_count&access_token=${encodeURIComponent(
      accessToken
    )}`,
    {},
    30000
  );
  const payload = await readJson(response);

  if (!response.ok) {
    throw providerError("Instagram profile check", response, payload);
  }

  return payload;
}

async function connectedInstagramAccount(): Promise<{
  id: string;
  username?: string;
} | null> {
  const config = getSocialConfig();

  if (!config.facebookPageId || !config.facebookPageAccessToken) {
    return null;
  }

  const response = await fetchWithTimeout(
    `${graphBase()}/${encodeURIComponent(
      config.facebookPageId
    )}?fields=instagram_business_account{id,username},connected_instagram_account{id,username}&access_token=${encodeURIComponent(
      config.facebookPageAccessToken
    )}`,
    {},
    30000
  );
  const payload = (await readJson(response)) as PageInstagramResponse;

  console.log(
    "Instagram connected account response:",
    JSON.stringify(payload, null, 2)
  );

  if (!response.ok) {
    return null;
  }

  const account =
    payload.instagram_business_account || payload.connected_instagram_account;
  const id = account?.id;

  if (typeof id !== "string" || !id.trim()) {
    return null;
  }

  return {
    id: id.trim(),
    username:
      typeof account?.username === "string" ? account.username : undefined,
  };
}

export async function resolveInstagramTarget(): Promise<InstagramTarget> {
  const config = getSocialConfig();
  const connected = await connectedInstagramAccount();
  const accountId = connected?.id || config.instagramAccountId;
  const tokens = [
    config.instagramAccessToken,
    config.facebookPageAccessToken,
  ].filter((token, index, list): token is string =>
    Boolean(token && list.indexOf(token) === index)
  );

  requireString(accountId, "account ID");

  if (!tokens.length) {
    throw new Error("Instagram access token is not configured");
  }

  const errors: string[] = [];

  for (const token of tokens) {
    try {
      const profile = await readProfile(accountId, token);
      const profileId = requireString(profile.id, "profile ID");

      if (profileId !== accountId) {
        throw new Error(
          `Instagram profile ID mismatch: expected ${accountId}, got ${profileId}`
        );
      }

      return {
        accountId,
        accessToken: token,
        username:
          typeof profile.username === "string"
            ? profile.username
            : connected?.username,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "token failed");
    }
  }

  throw new Error(
    `Instagram account ${accountId} could not be loaded with configured tokens: ${errors.join(
      " | "
    )}`
  );
}

export async function publishInstagram(
  temporaryImageUrl: string,
  caption: string
): Promise<{ postId: string; postUrl?: string }> {
  if (!temporaryImageUrl || !temporaryImageUrl.startsWith("https://")) {
    throw new Error(
      "Instagram requires a publicly accessible HTTPS image URL."
    );
  }

  const config = getSocialConfig();
  const target = await resolveInstagramTarget();

  console.log("========== INSTAGRAM ==========");
  console.log("Instagram Account ID:", target.accountId);
  console.log("Instagram Username:", target.username || "unknown");
  console.log("Graph Version:", config.metaGraphApiVersion);
  console.log("Image URL:", temporaryImageUrl);

  const create = await fetchWithTimeout(
    `${graphBase()}/${encodeURIComponent(target.accountId)}/media`,
    {
      method: "POST",
      body: new URLSearchParams({
        image_url: temporaryImageUrl,
        caption,
        access_token: target.accessToken,
      }),
    },
    30000
  );

  const createJson = await readJson(create);

  console.log("CREATE STATUS:", create.status);
  console.log("CREATE RESPONSE:", JSON.stringify(createJson, null, 2));

  if (!create.ok) {
    throw providerError("Instagram", create, createJson);
  }

  const creationId = requireString(
    createJson?.id,
    "media container ID"
  );
  const deadline =
    Date.now() + config.instagramProcessingTimeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const status = await fetchWithTimeout(
      `${graphBase()}/${encodeURIComponent(
        creationId
      )}?fields=status_code&access_token=${encodeURIComponent(
        target.accessToken
      )}`,
      {},
      30000
    );
    const statusJson = await readJson(status);

    console.log("STATUS RESPONSE:", JSON.stringify(statusJson, null, 2));

    if (!status.ok) {
      throw providerError("Instagram", status, statusJson);
    }

    const code = statusJson?.status_code;

    if (code === "FINISHED") {
      break;
    }

    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(
        `Instagram media container processing failed (${code}).`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const publish = await fetchWithTimeout(
    `${graphBase()}/${encodeURIComponent(target.accountId)}/media_publish`,
    {
      method: "POST",
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: target.accessToken,
      }),
    },
    30000
  );

  const publishJson = await readJson(publish);

  console.log("PUBLISH STATUS:", publish.status);
  console.log("PUBLISH RESPONSE:", JSON.stringify(publishJson, null, 2));
  console.log("==============================");

  if (!publish.ok) {
    throw providerError("Instagram Publish", publish, publishJson);
  }

  const postId = requireString(publishJson?.id, "published media ID");

  return { postId };
}
