import { getSocialConfig } from "./config";
import { fetchWithTimeout, readJson, redactSecrets } from "./http";

interface LinkedInUserInfo {
  sub?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  picture?: unknown;
  locale?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

interface LinkedInImageUploadResponse {
  value?: {
    uploadUrl?: unknown;
    image?: unknown;
    uploadUrlExpiresAt?: unknown;
  };
}

type JsonObject = Record<string, unknown>;

const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const LINKEDIN_IMAGES_URL =
  "https://api.linkedin.com/rest/images?action=initializeUpload";
const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";

function logLinkedIn(label: string, value: unknown): void {
  console.log(`[LinkedIn] ${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

async function readLinkedInResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function payloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const body = payload as JsonObject;
  const directMessage = body.message;

  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage;
  }

  const error = body.error;

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const errorBody = error as JsonObject;
    const errorMessage = errorBody.message || errorBody.error_description;

    if (typeof errorMessage === "string" && errorMessage.trim()) {
      return errorMessage;
    }
  }

  const errorDescription = body.error_description;

  if (
    typeof errorDescription === "string" &&
    errorDescription.trim()
  ) {
    return errorDescription;
  }

  return null;
}

function linkedInError(
  step: string,
  response: Response,
  payload: unknown
): Error {
  const requestId =
    response.headers.get("x-li-request-id") ||
    response.headers.get("x-restli-request-id");
  const code =
    payload && typeof payload === "object"
      ? (payload as JsonObject).code ||
        (payload as JsonObject).serviceErrorCode ||
        (payload as JsonObject).status
      : null;
  const message = payloadMessage(payload) || response.statusText || "request failed";
  const suffix = [
    `HTTP ${response.status}`,
    code ? `code ${String(code)}` : null,
    requestId ? `request ${requestId}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return new Error(
    redactSecrets(`LinkedIn ${step}: ${message}${suffix ? ` (${suffix})` : ""}`)
  );
}

function requireString(value: unknown, description: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`LinkedIn: ${description} is missing or malformed`);
  }

  return value.trim();
}

async function fetchAuthenticatedPersonUrn(
  accessToken: string
): Promise<string> {
  const response = await fetchWithTimeout(
    LINKEDIN_USERINFO_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    20000
  );

  const profile = (await readLinkedInResponse(response)) as LinkedInUserInfo;

  logLinkedIn("User profile response", {
    status: response.status,
    body: profile,
  });

  if (!response.ok) {
    throw linkedInError("profile lookup", response, profile);
  }

  const personId = requireString(
    profile.sub,
    "profile response did not include a person id in the OIDC subject"
  );
  const personUrn = `urn:li:person:${personId}`;

  logLinkedIn("Person URN", personUrn);

  return personUrn;
}

export async function publishLinkedIn(
  buffer: Buffer,
  caption: string
): Promise<{ postId: string; postUrl?: string }> {
  const config = getSocialConfig();

  if (!config.linkedInAccessToken) {
    throw new Error("LinkedIn access token is not configured");
  }

  const personUrn = await fetchAuthenticatedPersonUrn(
    config.linkedInAccessToken
  );

  const restHeaders = {
    Authorization: `Bearer ${config.linkedInAccessToken}`,
    "LinkedIn-Version": config.linkedInApiVersion,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };

  const initializeUploadResponse = await fetchWithTimeout(
    LINKEDIN_IMAGES_URL,
    {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: personUrn,
        },
      }),
    },
    30000
  );

  const initializeUploadJson =
    (await readLinkedInResponse(
      initializeUploadResponse
    )) as LinkedInImageUploadResponse;

  logLinkedIn("Image upload response", {
    status: initializeUploadResponse.status,
    body: initializeUploadJson,
  });

  if (!initializeUploadResponse.ok) {
    throw linkedInError(
      "image upload initialization",
      initializeUploadResponse,
      initializeUploadJson
    );
  }

  const uploadUrl = requireString(
    initializeUploadJson.value?.uploadUrl,
    "image upload URL"
  );
  const imageUrn = requireString(
    initializeUploadJson.value?.image,
    "image URN"
  );

  const uploadResponse = await fetchWithTimeout(
    uploadUrl,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.linkedInAccessToken}`,
        "Content-Type": "image/png",
      },
      body: new Uint8Array(buffer),
    },
    60000
  );

  const uploadResponseBody = await readLinkedInResponse(uploadResponse);

  logLinkedIn("Image binary upload response", {
    status: uploadResponse.status,
    body: uploadResponseBody,
  });

  if (!uploadResponse.ok) {
    throw linkedInError(
      "image binary upload",
      uploadResponse,
      uploadResponseBody
    );
  }

  const postResponse = await fetchWithTimeout(
    LINKEDIN_POSTS_URL,
    {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({
        author: personUrn,
        commentary: caption,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            id: imageUrn,
          },
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    },
    30000
  );

  const postJson = await readJson(postResponse);

  logLinkedIn("Post response", {
    status: postResponse.status,
    headers: {
      "x-restli-id": postResponse.headers.get("x-restli-id"),
      "x-li-request-id": postResponse.headers.get("x-li-request-id"),
      "x-restli-request-id": postResponse.headers.get("x-restli-request-id"),
    },
    body: postJson,
  });

  if (!postResponse.ok) {
    throw linkedInError("post creation", postResponse, postJson);
  }

  const postId =
    postResponse.headers.get("x-restli-id") ||
    (typeof postJson?.id === "string" ? postJson.id : "");

  if (!postId) {
    throw new Error("LinkedIn: post response did not contain an ID");
  }

  return {
    postId,
    postUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(
      postId
    )}`,
  };
}
