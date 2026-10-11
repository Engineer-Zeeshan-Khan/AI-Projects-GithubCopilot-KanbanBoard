import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { createInitialBoard, formatBoardDate, formatCreatedDate, formatDueDate, localDateString, moveOverdueCards, parseBoard, type Board, type Card } from "./board";

const dataDirectory = path.join(process.cwd(), "data");
export const boardFilePath = path.join(dataDirectory, "current-board.json");
export const historyFilePath = path.join(dataDirectory, "kanban-board-history.xlsx");
const autoSnapshotDatePath = path.join(dataDirectory, "last-auto-snapshot-date.txt");

export type CardChangeEvent = {
  action: "Created" | "Updated" | "Deleted" | "Moved" | "Reordered" | "Comment added" | "Comment deleted";
  cardBefore?: Card;
  cardAfter?: Card;
  columnBefore?: string;
  columnAfter?: string;
  changedFields: string[];
  commentId?: string;
  commentText?: string;
};

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
    { header: "Card Ref", key: "cardRef", width: 16 },
    { header: "Comments", key: "comments", width: 56 },
  ];
  worksheet.getRow(1).values = [
    "Date", "Time", "Column", "Card", "Details", "Assigned To", "Due Date", "Priority", "Created", "Snapshot", "Card Ref", "Comments",
  ];
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const date = localDateString(timestamp);
  const time = timestamp.toLocaleTimeString();
  const rows = board.columns.flatMap((column) => {
    if (column.cards.length === 0) {
      return [[formatBoardDate(date), time, column.title, "", "", "", "", "", "", source, "", ""]];
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
      card.cardRef ?? "",
      (card.comments ?? []).map((comment) => `${formatCreatedDate(comment.createdAt)}: ${comment.text}`).join("\n"),
    ]);
  });

  worksheet.addRows(rows);
  await workbook.xlsx.writeFile(historyFilePath);
}

export async function appendCardChangeEvent(event: CardChangeEvent) {
  await mkdir(dataDirectory, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  if (existsSync(historyFilePath)) {
    await workbook.xlsx.readFile(historyFilePath);
  }

  const worksheet = workbook.getWorksheet("Card Change Log") ?? workbook.addWorksheet("Card Change Log");
  if (worksheet.rowCount === 0) {
    worksheet.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Time", key: "time", width: 14 },
      { header: "Action", key: "action", width: 18 },
      { header: "Card Ref", key: "cardRef", width: 16 },
      { header: "Card ID", key: "cardId", width: 22 },
      { header: "Title", key: "title", width: 32 },
      { header: "Column", key: "column", width: 24 },
      { header: "Machine", key: "machine", width: 24 },
      { header: "Changed Fields", key: "changedFields", width: 28 },
      { header: "Before Title", key: "beforeTitle", width: 32 },
      { header: "After Title", key: "afterTitle", width: 32 },
      { header: "Before Details", key: "beforeDetails", width: 48 },
      { header: "After Details", key: "afterDetails", width: 48 },
      { header: "Before Owner", key: "beforeOwner", width: 22 },
      { header: "After Owner", key: "afterOwner", width: 22 },
      { header: "Before Due On", key: "beforeDueOn", width: 22 },
      { header: "After Due On", key: "afterDueOn", width: 22 },
      { header: "Before Priority", key: "beforePriority", width: 18 },
      { header: "After Priority", key: "afterPriority", width: 18 },
      { header: "Comment ID", key: "commentId", width: 28 },
      { header: "Comment", key: "comment", width: 56 },
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = { from: "A1", to: "U1" };
  }

  const before = event.cardBefore;
  const after = event.cardAfter;
  const card = after ?? before;
  const now = new Date();
  worksheet.addRow([
    formatBoardDate(localDateString(now)),
    now.toLocaleTimeString(),
    event.action,
    card?.cardRef ?? "",
    card?.id ?? "",
    after?.title ?? before?.title ?? "",
    event.columnBefore === event.columnAfter
      ? event.columnAfter ?? event.columnBefore ?? ""
      : `${event.columnBefore ?? ""} -> ${event.columnAfter ?? ""}`,
    hostname(),
    event.changedFields.join(", "),
    before?.title ?? "",
    after?.title ?? "",
    before?.details ?? "",
    after?.details ?? "",
    before?.assignee ?? "",
    after?.assignee ?? "",
    before?.dueDate ? formatDueDate(before.dueDate) : "",
    after?.dueDate ? formatDueDate(after.dueDate) : "",
    before?.priority ? `P${before.priority}` : before ? "No priority" : "",
    after?.priority ? `P${after.priority}` : after ? "No priority" : "",
    event.commentId ?? "",
    event.commentText ?? "",
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

  const previousBoard = await readCurrentBoard();
  const board = moveOverdueCards(previousBoard, today);
  const backlog = board.columns.find((column) => column.id === "backlog");
  if (backlog && board !== previousBoard) {
    const backlogIds = new Set(backlog.cards.map((card) => card.id));
    const overdueCards = previousBoard.columns
      .filter((column) => column.id !== "backlog" && column.id !== "done")
      .flatMap((column) => column.cards
        .filter((card) => backlogIds.has(card.id) && card.dueDate && card.dueDate.slice(0, 10) < today)
        .map((card) => ({ card, column })));
    await Promise.all(overdueCards.map(({ card, column }) => appendCardChangeEvent({
      action: "Moved",
      cardBefore: card,
      cardAfter: card,
      columnBefore: column.title,
      columnAfter: backlog.title,
      changedFields: ["column", "due time passed"],
    })));
  }
  await saveCurrentBoard(board);
  await appendBoardSnapshot(board, "Automatic", timestamp);
  await writeFile(autoSnapshotDatePath, today, "utf8");
}