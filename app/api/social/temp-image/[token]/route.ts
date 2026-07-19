import { promises as fs } from "node:fs";
import { getTemporaryPoster } from "../../../../../lib/social/temporaryPoster";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const poster = await getTemporaryPoster(token);
  if (!poster) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(poster.path);
    return new Response(data, { status: 200, headers: { "Content-Type": "image/png", "Content-Length": String(data.length), "Cache-Control": "public, max-age=300" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
