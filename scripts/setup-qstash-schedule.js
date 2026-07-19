const destination = "https://the-cliff-news-poster-nextjs.vercel.app/api/social/run-cycle";
const scheduleId = "the-cliff-news-auto-publisher-10-minutes";
const cron = "*/10 * * * *";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const qstashToken = required("QSTASH_TOKEN");
  const publisherSecret = required("AUTO_PUBLISH_SECRET");
  const qstashBaseUrl = (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");
  const createUrl = `${qstashBaseUrl}/v2/schedules/${destination}`;

  const response = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${qstashToken}`,
      "Content-Type": "application/json",
      "Upstash-Cron": cron,
      "Upstash-Method": "GET",
      "Upstash-Retries": "0",
      "Upstash-Schedule-Id": scheduleId,
      "Upstash-Forward-Authorization": `Bearer ${publisherSecret}`,
    },
    body: "{}",
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`QStash schedule creation failed (${response.status}): ${body}`);
  }

  const result = body ? JSON.parse(body) : {};
  const listResponse = await fetch(`${qstashBaseUrl}/v2/schedules`, {
    headers: { Authorization: `Bearer ${qstashToken}` },
  });
  if (!listResponse.ok) {
    throw new Error(`QStash schedule verification failed (${listResponse.status})`);
  }

  const schedules = await listResponse.json();
  const schedule = schedules.find((item) => item.scheduleId === scheduleId);
  if (!schedule) throw new Error("QStash schedule was created but could not be verified");

  console.log(JSON.stringify({
    success: true,
    scheduleId: result.scheduleId || scheduleId,
    cron: schedule.cron,
    destination: schedule.destination,
    method: schedule.method,
    retries: schedule.retries,
    isPaused: schedule.isPaused,
    nextScheduleTime: schedule.nextScheduleTime
      ? new Date(schedule.nextScheduleTime).toISOString()
      : undefined,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
