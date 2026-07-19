import { NextResponse } from "next/server";
import { findArticlePair } from "../../../../lib/findPair";
import { isAuthorized } from "../../../../lib/socialAuth";
import { testPlatform } from "../../../../lib/platformTest";
import { PLATFORMS, type Platform } from "../../../../lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== true || typeof body.pairId !== "string" || !PLATFORMS.includes(body.platform as Platform)) return NextResponse.json({ success: false, error: "Explicit confirmation, pairId, and platform are required" }, { status: 400 });
    const pair = await findArticlePair(body.pairId);
    if (!pair) return NextResponse.json({ success: false, error: "Story pair is no longer available" }, { status: 404 });
    const result = await testPlatform(pair, body.platform as Platform, body.expectedLanguage === "HINDI" || body.expectedLanguage === "ENGLISH" ? body.expectedLanguage : undefined);
    return NextResponse.json({ success: true, ...result });
  } catch (error) { console.error("Social platform test failed:", error instanceof Error ? error.message : "unknown error"); return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Platform test failed" }, { status: 500 }); }
}
