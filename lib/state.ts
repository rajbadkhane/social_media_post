import { promises as fs } from "node:fs";
import path from "node:path";
import type { Language } from "./fetchArticles";
import { PLATFORMS, type Platform } from "./config";

export interface PublisherState {
  nextLanguage: Language;
  processedPairIds: string[];
  platformCompletions: Record<string, Partial<Record<Platform, boolean>>>;
}

const maxProcessedPairs = 1000;
let writeChain = Promise.resolve();
let inProcessLock = false;

export function getStatePath(): string { return path.resolve(process.env.STATE_FILE_PATH || (process.env.VERCEL ? path.join("/tmp", "state.json") : path.join(process.cwd(), "state.json"))); }
function emptyState(): PublisherState { return { nextLanguage: "ENGLISH", processedPairIds: [], platformCompletions: {} }; }

function normalizeState(input: Partial<PublisherState> & { published?: Record<string, Partial<Record<Platform, any>>>; platformResults?: Record<string, Partial<Record<Platform, any>>> }): PublisherState {
  const state = emptyState();
  state.nextLanguage = input.nextLanguage === "HINDI" ? "HINDI" : "ENGLISH";
  state.processedPairIds = Array.isArray(input.processedPairIds) ? [...new Set(input.processedPairIds.filter((id): id is string => typeof id === "string"))].slice(-maxProcessedPairs) : [];
  state.platformCompletions = input.platformCompletions && typeof input.platformCompletions === "object" ? Object.fromEntries(Object.entries(input.platformCompletions).slice(-maxProcessedPairs).map(([pairId, results]) => [pairId, Object.fromEntries(PLATFORMS.filter((platform) => typeof results?.[platform] === "boolean").map((platform) => [platform, results?.[platform] === true]))])) : {};
  for (const [pairId, oldResults] of Object.entries(input.published || {})) {
    state.platformCompletions[pairId] ||= {};
    for (const platform of PLATFORMS) if (oldResults?.[platform]?.postId) state.platformCompletions[pairId][platform] = true;
  }
  for (const [pairId, oldResults] of Object.entries(input.platformResults || {})) {
    state.platformCompletions[pairId] ||= {};
    for (const platform of PLATFORMS) if (oldResults?.[platform]?.status === "SUCCESS") state.platformCompletions[pairId][platform] = true;
  }
  return state;
}

export async function readState(): Promise<PublisherState> {
  try { return normalizeState(JSON.parse(await fs.readFile(getStatePath(), "utf8"))); }
  catch (error: any) { if (error?.code !== "ENOENT") throw error; return emptyState(); }
}

export async function writeState(state: PublisherState): Promise<void> {
  const normalized = normalizeState(state);
  const statePath = getStatePath();
  writeChain = writeChain.catch(() => undefined).then(async () => {
    const temp = `${statePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const handle = await fs.open(temp, "w");
    try { await handle.writeFile(JSON.stringify(normalized, null, 2) + "\n", "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temp, statePath);
  });
  return writeChain;
}

export async function withPublisherLock<T>(work: () => Promise<T>): Promise<T> {
  if (inProcessLock) throw new Error("A publishing cycle is already running");
  inProcessLock = true;
  const lockPath = `${getStatePath()}.lock`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    try { handle = await fs.open(lockPath, "wx"); await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8"); }
    catch (error: any) { if (error?.code === "EEXIST") throw new Error("A publishing cycle is already running"); throw error; }
    return await work();
  } finally { await handle?.close().catch(() => undefined); await fs.unlink(lockPath).catch(() => undefined); inProcessLock = false; }
}

export function alternate(language: Language): Language { return language === "ENGLISH" ? "HINDI" : "ENGLISH"; }
export function trimProcessedPairIds(ids: string[]): string[] { return [...new Set(ids)].slice(-maxProcessedPairs); }
