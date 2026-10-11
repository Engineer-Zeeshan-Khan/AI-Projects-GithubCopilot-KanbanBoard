import { appendAutomaticSnapshotIfNeeded } from "./server-storage";
import { nextLocalDayEnd } from "./board";

const schedulerGlobal = globalThis as typeof globalThis & {
  kanbanSnapshotTimer?: ReturnType<typeof setTimeout>;
};

export function startDailySnapshotScheduler() {
  if (schedulerGlobal.kanbanSnapshotTimer) {
    return;
  }

  const scheduleNextSnapshot = () => {
    const now = new Date();
    const nextSnapshot = nextLocalDayEnd(now);
    schedulerGlobal.kanbanSnapshotTimer = setTimeout(async () => {
      try {
        await appendAutomaticSnapshotIfNeeded(nextSnapshot);
      } catch (error) {
        console.error("Automatic Kanban snapshot failed:", error);
      }
      scheduleNextSnapshot();
    }, Math.max(1000, nextSnapshot.getTime() - now.getTime()));
  };

  scheduleNextSnapshot();
}