const scheduleId = "the-cliff-news-auto-publisher-10-minutes";
const action = process.argv[2];

async function main() {
  if (action !== "pause" && action !== "resume" && action !== "status") {
    throw new Error("Usage: node scripts/set-qstash-schedule-state.js <pause|resume|status>");
  }
  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) throw new Error("QSTASH_TOKEN is required");
  const base = (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");
  const endpoint =
    action === "status"
      ? `${base}/v2/schedules/${encodeURIComponent(scheduleId)}`
      : `${base}/v2/schedules/${encodeURIComponent(scheduleId)}/${action}`;
  const response = await fetch(endpoint, {
    method: action === "status" ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`QStash ${action} failed (${response.status}): ${body}`);
  const schedule = action === "status" && body ? JSON.parse(body) : undefined;
  console.log(
    JSON.stringify({
      success: true,
      scheduleId,
      action,
      ...(schedule
        ? {
            cron: schedule.cron,
            destination: schedule.destination,
            paused: schedule.isPaused ?? schedule.paused ?? false,
          }
        : {}),
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
