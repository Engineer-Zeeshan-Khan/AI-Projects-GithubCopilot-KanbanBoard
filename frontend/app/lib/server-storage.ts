import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInitialBoard, formatBoardDate, formatCreatedDate, formatDueDate, localDateString, moveOverdueCards, parseBoard, type Board, type Card } from "./board";

const dataDirectory = path.join(process.cwd(), "data");
export const boardFilePath = path.join(dataDirectory, "current-board.json");
export const historyFilePath = path.join(dataDirectory, "kanban-board-history.xlsx");
const autoSnapshotDatePath = path.join(dataDirectory, "last-auto-snapshot-date.txt");

let pendingBoardWrite = Promise.resolve();

export function saveCurrentBoard(board: Board) {
  pendingBoardWrite = pendingBoardWrite.catch(() => undefined).then(async () => {
    await mkdir(dataDirectory, { recursive: true });
    const temporaryPath = `${boardFilePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(board), "utf8");
    await rename(temporaryPath, boardFilePath);
  });

  return pendingBoardWrite;
}

export async function readCurrentBoard(): Promise<Board> {
  try {
    return parseBoard(await readFile(boardFilePath, "utf8")) ?? createInitialBoard();
  } catch {
    return createInitialBoard();
  }
}

export async function appendBoardSnapshot(
  board: Board,
  source: "Manual" | "Automatic",
  timestamp = new Date(),
) {
  await mkdir(dataDirectory, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  if (existsSync(historyFilePath)) {
    await workbook.xlsx.readFile(historyFilePath);
  }

  const worksheet = workbook.getWorksheet("Daily Board Log") ?? workbook.addWorksheet("Daily Board Log");
  worksheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Time", key: "time", width: 14 },
    { header: "Column", key: "column", width: 20 },
    { header: "Card", key: "card", width: 36 },
    { header: "Details", key: "details", width: 60 },
    { header: "Assigned To", key: "assignee", width: 24 },
    { header: "Due Date", key: "dueDate", width: 14 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Created", key: "createdAt", width: 14 },
    { header: "Snapshot", key: "snapshot", width: 14 },
  ];
  worksheet.getRow(1).values = [
    "Date", "Time", "Column", "Card", "Details", "Assigned To", "Due Date", "Priority", "Created", "Snapshot",
  ];
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const date = localDateString(timestamp);
  const time = timestamp.toLocaleTimeString();
  const rows = board.columns.flatMap((column) => {
    if (column.cards.length === 0) {
      return [[formatBoardDate(date), time, column.title, "", "", "", "", "", "", source]];
    }

    return column.cards.map((card) => [
      formatBoardDate(date),
      time,
      column.title,
      card.title,
      card.details,
      card.assignee ?? "",
      card.dueDate ? formatDueDate(card.dueDate) : "",
      card.priority ? `P${card.priority}` : "No priority",
      card.createdAt ? formatCreatedDate(card.createdAt) : "",
      source,
    ]);
  });

  worksheet.addRows(rows);
  await workbook.xlsx.writeFile(historyFilePath);
}

export async function appendCardBeforeEditSnapshot(card: Card, columnTitle: string) {
  await mkdir(dataDirectory, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  if (existsSync(historyFilePath)) {
    await workbook.xlsx.readFile(historyFilePath);
  }

  const worksheet = workbook.getWorksheet("Daily Board Log") ?? workbook.addWorksheet("Daily Board Log");
  worksheet.getRow(1).values = [
    "Date", "Time", "Column", "Card", "Details", "Assigned To", "Due Date", "Priority", "Created", "Snapshot",
  ];
  worksheet.getRow(1).font = { bold: true };
  worksheet.addRow([
    formatBoardDate(localDateString()),
    new Date().toLocaleTimeString(),
    columnTitle,
    card.title,
    card.details,
    card.assignee ?? "",
    card.dueDate ? formatDueDate(card.dueDate) : "",
    card.priority ? `P${card.priority}` : "No priority",
    card.createdAt ? formatCreatedDate(card.createdAt) : "",
    "Before Edit",
  ]);
  await workbook.xlsx.writeFile(historyFilePath);
}

export async function appendAutomaticSnapshotIfNeeded(timestamp = new Date()) {
  const today = localDateString(timestamp);
  try {
    if ((await readFile(autoSnapshotDatePath, "utf8")).trim() === today) {
      return;
    }
  } catch {
    // No automatic snapshot has been recorded yet.
  }

  const board = moveOverdueCards(await readCurrentBoard(), today);
  await saveCurrentBoard(board);
  await appendBoardSnapshot(board, "Automatic", timestamp);
  await writeFile(autoSnapshotDatePath, today, "utf8");
}