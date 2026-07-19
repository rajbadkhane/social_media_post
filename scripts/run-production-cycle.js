const endpoint = "https://the-cliff-news-poster-nextjs.vercel.app/api/social/run-cycle";

async function main() {
  const secret = process.env.AUTO_PUBLISH_SECRET?.trim();
  if (!secret) throw new Error("AUTO_PUBLISH_SECRET is required");

  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ status: response.status, body }));
  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
