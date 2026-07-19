export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { deleteExpiredPosters } = await import("./lib/social/temporaryPoster");
    await deleteExpiredPosters();
  }
}
