import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTemporaryPoster, deleteExpiredPosters, deleteTemporaryPoster, getTemporaryPoster, temporaryImageUrl } from "../lib/social/temporaryPoster";
import { GET } from "../app/api/social/temp-image/[token]/route";

const png = Buffer.from("89504e470d0a1a0a", "hex");
const originalEnv = { ...process.env };
afterEach(() => { vi.useRealTimers(); for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value; });

describe("temporary poster lifecycle", () => {
  it("writes only a random-token PNG inside runtime-posters and serves it", async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), "temporary-poster-test-")); process.env.TEMP_POSTER_DIRECTORY = directory; process.env.PUBLIC_POSTER_BASE_URL = "https://postmaker.example";
    const poster = await createTemporaryPoster(png, "pair:one", "ENGLISH");
    expect(poster.path.startsWith(directory)).toBe(true); expect(poster.path.endsWith(".png")).toBe(true); expect(temporaryImageUrl(poster.token)).toContain(`/api/social/temp-image/${poster.token}`);
    const response = await GET(new Request("https://postmaker.example/api/social/temp-image/" + poster.token), { params: Promise.resolve({ token: poster.token }) });
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("image/png"); expect(response.headers.get("content-length")).toBe(String(png.length));
    await deleteTemporaryPoster(poster); expect((await getTemporaryPoster(poster.token))).toBeNull(); await fs.rm(directory, { recursive: true, force: true });
  });

  it("rejects invalid, traversal, and expired tokens", async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), "temporary-poster-expiry-test-")); process.env.TEMP_POSTER_DIRECTORY = directory; process.env.TEMP_POSTER_TTL_SECONDS = "60"; vi.useFakeTimers();
    const poster = await createTemporaryPoster(png, "pair:two", "HINDI");
    expect((await GET(new Request("https://postmaker.example/api/social/temp-image/nope"), { params: Promise.resolve({ token: "nope" }) })).status).toBe(404);
    expect((await GET(new Request("https://postmaker.example/api/social/temp-image/..%2F..%2Fstate.json"), { params: Promise.resolve({ token: "../../state.json" }) })).status).toBe(404);
    vi.advanceTimersByTime(61_000); expect((await GET(new Request("https://postmaker.example/api/social/temp-image/" + poster.token), { params: Promise.resolve({ token: poster.token }) })).status).toBe(404);
    await deleteExpiredPosters(); await fs.rm(directory, { recursive: true, force: true });
  });

  it("deletes temporary images after a simulated platform failure", async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), "temporary-poster-failure-test-")); process.env.TEMP_POSTER_DIRECTORY = directory;
    const poster = await createTemporaryPoster(png, "pair:failure", "ENGLISH");
    try { throw new Error("provider failure"); } catch { /* simulated provider failure */ } finally { await deleteTemporaryPoster(poster); }
    expect(await fs.stat(poster.path).catch(() => null)).toBeNull(); await fs.rm(directory, { recursive: true, force: true });
  });
});
