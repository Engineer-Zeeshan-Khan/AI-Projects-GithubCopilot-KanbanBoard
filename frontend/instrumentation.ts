export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDailySnapshotScheduler } = await import("./app/lib/snapshot-scheduler");
    startDailySnapshotScheduler();
  }
}