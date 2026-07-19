import { NextRequest, NextResponse } from "next/server";
import { fetchApiPosts } from "../../../lib/article/fetchApiPosts";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ success: false, error: "Missing API/feed URL" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid URL format" }, { status: 400 });
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json(
        { success: false, error: "Invalid protocol. Only http: and https: are allowed." },
        { status: 400 }
      );
    }

    try {
      const posts = await fetchApiPosts(url);
      return NextResponse.json({ success: true, posts });
    } catch (err: any) {
      console.error("API Fetch posts error:", err);
      return NextResponse.json(
        { success: false, error: err.message || "Failed to fetch posts from the provided API URL." },
        { status: 400 }
      );
    }
  } catch (err: any) {
    console.error("Endpoint crash error:", err);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
