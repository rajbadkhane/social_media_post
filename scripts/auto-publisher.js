const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnvironment() {
  for (const file of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

loadLocalEnvironment();
const intervalMs = Math.max(10000, Number(process.env.AUTO_PUBLISH_INTERVAL_SECONDS || "60") * 1000);
const baseUrl = (process.env.PUBLISHER_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
let running = false;

function safeResult(value) {
  return JSON.stringify({ success: value.success, complete: value.complete, skipped: value.skipped, reason: value.reason, pairId: value.pairId, articleId: value.articleId, language: value.language, nextLanguage: value.nextLanguage, platformResults: value.platformResults ? Object.fromEntries(Object.entries(value.platformResults).map(([key, result]) => [key, { enabled: result.enabled, status: result.status, postId: result.postId, error: result.error }])) : undefined });
}

async function run() {
  if (running || process.env.AUTO_PUBLISH_ENABLED !== "true") return;
  running = true;
  try {
    const secret = process.env.AUTO_PUBLISH_SECRET || "";
    if (!secret) throw new Error("AUTO_PUBLISH_SECRET is not configured");
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(`${baseUrl}/api/social/run-cycle`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(120000) });
        break;
      } catch (error) { if (attempt === 2) throw error; await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); }
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) console.error(`Automatic publisher HTTP ${response.status}: ${body.error || "request failed"}`);
    else console.log(new Date().toISOString(), safeResult(body));
  } catch (error) { console.error(new Date().toISOString(), error instanceof Error ? error.message : "Automatic publisher request failed"); }
  finally { running = false; }
}

run();
setInterval(run, intervalMs);
