const fs = require("node:fs");

const redisUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
const redisToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const stateKey = (process.env.PUBLISHER_STATE_KEY || "the-cliff-news:publisher-state").trim();

async function redisCommand(command) {
  const response = await fetch(redisUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(`Redis command failed: HTTP ${response.status} ${payload.error || ""}`.trim());
  }
  return payload.result;
}

async function main() {
  if (!redisUrl || !redisToken) throw new Error("KV_REST_API_URL/KV_REST_API_TOKEN are not available");
  const state = JSON.parse(fs.readFileSync("state.json", "utf8"));
  await redisCommand(["SET", stateKey, JSON.stringify(state)]);
  console.log(JSON.stringify({
    success: true,
    stateKey,
    processedPairCount: Array.isArray(state.processedPairIds) ? state.processedPairIds.length : 0,
    nextLanguage: state.nextLanguage,
    dailyPublishCount: state.dailyPublishCount,
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
