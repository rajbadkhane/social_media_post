import { NextResponse } from "next/server";
import { runAutomaticPublishingCycle } from "../../../../lib/automaticPublisher";
import { getSocialConfig } from "../../../../lib/config";
import { isAuthorized } from "../../../../lib/socialAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!getSocialConfig().autoPublishEnabled) return NextResponse.json({ success: false, error: "Automatic publishing is disabled" }, { status: 409 });
  try { return NextResponse.json({ success: true, ...(await runAutomaticPublishingCycle()) }); }
  catch (error) { console.error("Automatic publishing cycle failed:", error instanceof Error ? error.message : "unknown error"); return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Automatic cycle failed" }, { status: 500 }); }
}
