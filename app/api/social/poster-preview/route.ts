import { NextResponse } from "next/server";
import { generatePoster } from "../../../../lib/generatePoster";
import { isAuthorized } from "../../../../lib/socialAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (
      body.confirm !== true ||
      typeof body.headline !== "string" ||
      !body.headline.trim() ||
      typeof body.imageUrl !== "string" ||
      !/^https?:\/\//i.test(body.imageUrl)
    ) {
      return NextResponse.json(
        { success: false, error: "confirm, headline, and a public HTTP imageUrl are required" },
        { status: 400 },
      );
    }

    const poster = await generatePoster({
      headline: body.headline.trim(),
      summary: "",
      imageUrl: body.imageUrl,
      category: "",
      seoHashtags: [],
      smoHashtags: [],
      captions: { facebook: "", instagram: "", linkedin: "", twitter: "" },
      language: body.language === "Hindi" ? "Hindi" : "English",
    });

    return new Response(new Uint8Array(poster), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "content-disposition": "inline; filename=poster-preview.png",
      },
    });
  } catch (error) {
    console.error("Poster preview generation failed", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Poster preview generation failed",
      },
      { status: 500 },
    );
  }
}
