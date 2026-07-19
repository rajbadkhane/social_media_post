import { NextResponse } from "next/server";
import { canIssueBrowserSession, createBrowserSession, socialSessionCookie } from "../../../../lib/socialAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!canIssueBrowserSession()) return NextResponse.json({ success: false, error: "AUTO_PUBLISH_SECRET is not configured" }, { status: 503 });
  const response = NextResponse.json({ success: true });
  response.cookies.set(socialSessionCookie, createBrowserSession(), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/api/social", maxAge: 8 * 60 * 60 });
  return response;
}
