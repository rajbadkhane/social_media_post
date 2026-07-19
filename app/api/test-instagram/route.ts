import { NextResponse } from "next/server";
import { getSocialConfig } from "../../../lib/config";
import { resolveInstagramTarget } from "../../../lib/publishInstagram";
import { fetchWithTimeout, providerError, readJson, redactSecrets } from "../../../lib/http";
import { isAuthorized } from "../../../lib/socialAuth";

export const dynamic = "force-dynamic";

type InstagramStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED";

interface TestInstagramBody {
  confirm?: unknown;
  imageUrl?: unknown;
  caption?: unknown;
  publish?: unknown;
}

function badRequest(message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status });
}

function graphBase(): string {
  return `https://graph.facebook.com/${getSocialConfig().metaGraphApiVersion}`;
}

function safeJson(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  return JSON.parse(redactSecrets(JSON.stringify(value)));
}

async function readInstagramJson(response: Response): Promise<unknown> {
  const payload = await readJson(response);
  return safeJson(payload);
}

async function getInstagramProfile() {
  const target = await resolveInstagramTarget();
  return {
    id: target.accountId,
    username: target.username,
  };
}

async function createMediaContainer(imageUrl: string, caption: string): Promise<string> {
  const { accountId, accessToken } = await resolveInstagramTarget();
  const response = await fetchWithTimeout(
    `${graphBase()}/${encodeURIComponent(accountId)}/media`,
    {
      method: "POST",
      body: new URLSearchParams({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    },
    30000
  );
  const payload = await readInstagramJson(response);

  console.log("Instagram test media create:", JSON.stringify(payload, null, 2));

  if (!response.ok) {
    throw providerError("Instagram media create", response, payload);
  }

  const creationId =
    payload && typeof payload === "object" && "id" in payload
      ? (payload as { id?: unknown }).id
      : null;

  if (typeof creationId !== "string" || !creationId) {
    throw new Error("Instagram media create response did not contain an ID");
  }

  return creationId;
}

async function waitForContainer(creationId: string): Promise<InstagramStatus> {
  const config = getSocialConfig();
  const deadline = Date.now() + config.instagramProcessingTimeoutSeconds * 1000;
  const { accessToken } = await resolveInstagramTarget();

  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(
      `${graphBase()}/${encodeURIComponent(
        creationId
      )}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
      {},
      30000
    );
    const payload = await readInstagramJson(response);

    console.log("Instagram test media status:", JSON.stringify(payload, null, 2));

    if (!response.ok) {
      throw providerError("Instagram media status", response, payload);
    }

    const status =
      payload && typeof payload === "object" && "status_code" in payload
        ? (payload as { status_code?: unknown }).status_code
        : null;

    if (status === "FINISHED" || status === "ERROR" || status === "EXPIRED") {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Instagram media processing timed out");
}

async function publishMediaContainer(creationId: string): Promise<string> {
  const { accountId, accessToken } = await resolveInstagramTarget();
  const response = await fetchWithTimeout(
    `${graphBase()}/${encodeURIComponent(accountId)}/media_publish`,
    {
      method: "POST",
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken,
      }),
    },
    30000
  );
  const payload = await readInstagramJson(response);

  console.log("Instagram test media publish:", JSON.stringify(payload, null, 2));

  if (!response.ok) {
    throw providerError("Instagram media publish", response, payload);
  }

  const postId =
    payload && typeof payload === "object" && "id" in payload
      ? (payload as { id?: unknown }).id
      : null;

  if (typeof postId !== "string" || !postId) {
    throw new Error("Instagram media publish response did not contain an ID");
  }

  return postId;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return badRequest("Unauthorized", 401);
  }

  try {
    const profile = await getInstagramProfile();
    return NextResponse.json({ success: true, profile });
  } catch (error) {
    return badRequest(
      redactSecrets(
        error instanceof Error ? error.message : "Instagram profile check failed"
      ),
      500
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return badRequest("Unauthorized", 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as TestInstagramBody;

    if (body.confirm !== true) {
      return badRequest("Set confirm:true before creating an Instagram test post");
    }

    if (typeof body.imageUrl !== "string" || !/^https:\/\//i.test(body.imageUrl)) {
      return badRequest("imageUrl must be a publicly accessible HTTPS URL");
    }

    const caption =
      typeof body.caption === "string" && body.caption.trim()
        ? body.caption.trim()
        : `The Cliff News Instagram test post\n${new Date().toISOString()}`;
    const shouldPublish = body.publish !== false;
    const creationId = await createMediaContainer(body.imageUrl, caption);
    const status = await waitForContainer(creationId);

    if (status !== "FINISHED") {
      return badRequest(`Instagram media processing failed (${status})`, 502);
    }

    if (!shouldPublish) {
      return NextResponse.json({
        success: true,
        published: false,
        creationId,
        status,
      });
    }

    const postId = await publishMediaContainer(creationId);

    return NextResponse.json({
      success: true,
      published: true,
      creationId,
      postId,
    });
  } catch (error) {
    return badRequest(
      redactSecrets(
        error instanceof Error ? error.message : "Instagram test post failed"
      ),
      500
    );
  }
}
