import { NextResponse } from "next/server";
import { publishPairNow } from "../../../lib/automaticPublisher";
import { findArticlePair } from "../../../lib/findPair";
import { isAuthorized } from "../../../lib/socialAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.pairId !== "string") return NextResponse.json({ success: false, error: "pairId is required" }, { status: 400 });
    const pair = await findArticlePair(body.pairId);
    if (!pair) return NextResponse.json({ success: false, error: "Story pair is no longer available" }, { status: 404 });
    const expectedLanguage = body.expectedLanguage === "HINDI" || body.expectedLanguage === "ENGLISH" ? body.expectedLanguage : undefined;
    const result = await publishPairNow(pair, expectedLanguage);
    return NextResponse.json({ success: true, pairId: pair.pairId, ...result });
  } catch (error) {
    console.error("Website API publish error:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Publish failed" }, { status: 500 });
  }
}
