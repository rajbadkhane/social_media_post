import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { runAutomaticPublishingCycle } from "../../../../lib/automaticPublisher";
import { getSocialConfig } from "../../../../lib/config";
import { isAuthorized } from "../../../../lib/socialAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cronAuthorized(request: Request): boolean {
  const config = getSocialConfig();
  const authorization = request.headers.get("authorization") || "";
  if (!config.cronSecret || !authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length).trim();
  return supplied.length === config.cronSecret.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(config.cronSecret));
}

async function runCycleResponse() {
  if (!getSocialConfig().autoPublishEnabled) return NextResponse.json({ success: false, error: "Automatic publishing is disabled" }, { status: 409 });
  try { return NextResponse.json({ success: true, ...(await runAutomaticPublishingCycle()) }); }
  catch (error) { console.error("Automatic publishing cycle failed:", error instanceof Error ? error.message : "unknown error"); return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Automatic cycle failed" }, { status: 500 }); }
}

export async function GET(request: Request) {
  if (!cronAuthorized(request) && !isAuthorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  return runCycleResponse();
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  return runCycleResponse();
}
