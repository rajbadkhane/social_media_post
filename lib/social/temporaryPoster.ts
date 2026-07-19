import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { del, put } from "@vercel/blob";
import sharp from "sharp";
import { getSocialConfig } from "../config";

const maxPosterBytes = 8 * 1024 * 1024;
const maxInstagramBlobBytes = 1_500_000;
const pngSignature = "89504e470d0a1a0a";
const activePosters = new Map<string, { path: string; expiresAt: number }>();

export interface TemporaryPoster {
  token: string;
  path: string;
  url?: string;
  storage: "blob" | "filesystem";
  expiresAt: number;
  sizeBytes: number;
}

function posterDirectory(): string { return path.resolve(process.env.TEMP_POSTER_DIRECTORY || (process.env.VERCEL ? path.join("/tmp", "runtime-posters") : path.join(process.cwd(), "runtime-posters"))); }
function safePart(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120); }
function insideDirectory(filePath: string): boolean { const root = posterDirectory(); return filePath === root || filePath.startsWith(`${root}${path.sep}`); }
function validatePng(buffer: Buffer): void { if (buffer.length > maxPosterBytes) throw new Error("Generated poster exceeds the 8 MB limit"); if (buffer.subarray(0, 8).toString("hex") !== pngSignature) throw new Error("Generated poster is not a valid PNG"); }

async function instagramJpeg(buffer: Buffer): Promise<Buffer> {
  let candidate = Buffer.alloc(0);
  for (const quality of [85, 70, 55]) {
    candidate = await sharp(buffer)
      .resize({ width: 1080, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (candidate.length <= maxInstagramBlobBytes) return candidate;
  }
  throw new Error("Instagram poster could not be compressed below the 1.5 MB temporary-image limit");
}

export async function createTemporaryPoster(buffer: Buffer, pairId: string, language: string): Promise<TemporaryPoster> {
  validatePng(buffer);
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + getSocialConfig().tempPosterTtlSeconds * 1000;

  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    const upload = await instagramJpeg(buffer);
    const pathname = `social-posters/${safePart(pairId)}-${safePart(language)}-${token}.jpg`;
    const blob = await put(pathname, upload, {
      access: "public",
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      contentType: "image/jpeg",
    });
    console.log("[TemporaryPoster] Uploaded to Vercel Blob", {
      pathname: blob.pathname,
      sizeBytes: upload.length,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    return {
      token,
      path: blob.pathname,
      url: blob.url,
      storage: "blob",
      expiresAt,
      sizeBytes: upload.length,
    };
  }

  const directory = posterDirectory();
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.resolve(directory, `${safePart(pairId)}-${safePart(language)}-${token}.png`);
  if (!insideDirectory(filePath)) throw new Error("Temporary poster path is invalid");
  await fs.writeFile(filePath, buffer, { flag: "wx" });
  activePosters.set(token, { path: filePath, expiresAt });
  return { token, path: filePath, storage: "filesystem", expiresAt, sizeBytes: buffer.length };
}

export function getTemporaryPosterPath(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return null;
  const item = activePosters.get(token);
  if (!item || item.expiresAt <= Date.now() || !insideDirectory(item.path)) return null;
  return item.path;
}

export async function getTemporaryPoster(token: string): Promise<{ path: string; expiresAt: number } | null> {
  const item = activePosters.get(token);
  const filePath = getTemporaryPosterPath(token);
  if (!item || !filePath) { if (item) activePosters.delete(token); return null; }
  try { const stat = await fs.stat(filePath); if (!stat.isFile() || stat.size > maxPosterBytes) throw new Error("invalid temporary poster"); return { path: filePath, expiresAt: item.expiresAt }; }
  catch { activePosters.delete(token); return null; }
}

export async function deleteTemporaryPoster(poster: Pick<TemporaryPoster, "token" | "path" | "url" | "storage">): Promise<void> {
  if (poster.storage === "blob") {
    await del(poster.url || poster.path).catch((error) => {
      console.error("[TemporaryPoster] Vercel Blob deletion failed", error instanceof Error ? error.message : "unknown error");
    });
    return;
  }
  activePosters.delete(poster.token);
  if (insideDirectory(path.resolve(poster.path))) await fs.unlink(poster.path).catch(() => undefined);
}

export async function deleteExpiredPosters(): Promise<void> {
  const directory = posterDirectory();
  await fs.mkdir(directory, { recursive: true });
  const cutoff = Date.now() - getSocialConfig().tempPosterCleanupMinutes * 60 * 1000;
  for (const [token, item] of activePosters) if (item.expiresAt <= Date.now()) { activePosters.delete(token); await fs.unlink(item.path).catch(() => undefined); }
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
    const filePath = path.resolve(directory, entry.name);
    if (!insideDirectory(filePath)) continue;
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.unlink(filePath).catch(() => undefined);
  }
}

export async function revokeTemporaryPosterToken(token: string): Promise<void> { activePosters.delete(token); }

export function temporaryImageUrl(poster: TemporaryPoster | string): string {
  if (typeof poster !== "string" && poster.storage === "blob" && poster.url) return poster.url;
  const token = typeof poster === "string" ? poster : poster.token;
  const base = getSocialConfig().publicPosterBaseUrl.replace(/\/$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("Instagram requires the PostMaker to be deployed on a publicly accessible HTTPS domain");
  return `${base}/api/social/temp-image/${encodeURIComponent(token)}`;
}

export function maxTemporaryPosterBytes(): number { return maxPosterBytes; }
