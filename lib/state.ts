import { promises as fs } from "node:fs";
import path from "node:path";
import type { Language } from "./fetchArticles";
import { PLATFORMS, type Platform } from "./config";

export interface PublisherState {
  nextLanguage: Language;
  processedPairIds: string[];
  platformCompletions: Record<string, Partial<Record<Platform, boolean>>>;
  dailyPublishCount: { date: string; count: number };
}

const maxProcessedPairs = 1000;
let writeChain = Promise.resolve();
let inProcessLock = false;

export function getStatePath(): string { return path.resolve(process.env.STATE_FILE_PATH || (process.env.VERCEL ? path.join("/tmp", "state.json") : path.join(process.cwd(), "state.json"))); }
function redisUrl(): string { return (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, ""); }
function redisToken(): string { return (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim(); }
function stateKey(): string { return (process.env.PUBLISHER_STATE_KEY || "the-cliff-news:publisher-state").trim(); }
function lockKey(): string { return `${stateKey()}:lock`; }
export function durableStateConfigured(): boolean { return Boolean(redisUrl() && redisToken()); }
export function durableStateRequired(): boolean { return process.env.VERCEL === "1" || Boolean(process.env.VERCEL); }
export function publishingDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function emptyState(): PublisherState { return { nextLanguage: "ENGLISH", processedPairIds: [], platformCompletions: {}, dailyPublishCount: { date: publishingDay(), count: 0 } }; }

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
  if (input.dailyPublishCount && typeof input.dailyPublishCount === "object") {
    const date = typeof input.dailyPublishCount.date === "string" ? input.dailyPublishCount.date : publishingDay();
    const count = Number.isFinite(input.dailyPublishCount.count) ? Math.max(0, Math.floor(input.dailyPublishCount.count)) : 0;
    state.dailyPublishCount = { date, count };
  }
  return state;
}

async function redisCommand<T = unknown>(command: unknown[]): Promise<T> {
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Publisher state Redis command failed: HTTP ${response.status}`);
  if (payload?.error) throw new Error(`Publisher state Redis command failed: ${payload.error}`);
  return payload?.result as T;
}

async function readRedisState(): Promise<PublisherState> {
  const raw = await redisCommand<string | null>(["GET", stateKey()]);
  if (!raw) return emptyState();
  return normalizeState(JSON.parse(raw));
}

async function writeRedisState(state: PublisherState): Promise<void> {
  await redisCommand(["SET", stateKey(), JSON.stringify(normalizeState(state))]);
}

export async function readState(): Promise<PublisherState> {
  if (durableStateConfigured()) return readRedisState();
  try { return normalizeState(JSON.parse(await fs.readFile(getStatePath(), "utf8"))); }
  catch (error: any) { if (error?.code !== "ENOENT") throw error; return emptyState(); }
}

export async function writeState(state: PublisherState): Promise<void> {
  const normalized = normalizeState(state);
  if (durableStateConfigured()) {
    writeChain = writeChain.catch(() => undefined).then(() => writeRedisState(normalized));
    return writeChain;
  }
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
  if (durableStateConfigured()) {
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const acquired = await redisCommand<string | null>(["SET", lockKey(), token, "NX", "EX", "300"]);
    if (acquired !== "OK") { inProcessLock = false; throw new Error("A publishing cycle is already running"); }
    try { return await work(); }
    finally {
      const current = await redisCommand<string | null>(["GET", lockKey()]).catch(() => null);
      if (current === token) await redisCommand(["DEL", lockKey()]).catch(() => undefined);
      inProcessLock = false;
    }
  }
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
export function dailyPublishCount(state: PublisherState, date = publishingDay()): number { return state.dailyPublishCount.date === date ? state.dailyPublishCount.count : 0; }
export function dailyLimitReached(state: PublisherState, limit: number, date = publishingDay()): boolean { return dailyPublishCount(state, date) >= limit; }
export function recordDailyPublish(state: PublisherState, date = publishingDay()): void {
  state.dailyPublishCount = state.dailyPublishCount.date === date ? { date, count: state.dailyPublishCount.count + 1 } : { date, count: 1 };
}
