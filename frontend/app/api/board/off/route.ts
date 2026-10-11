import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseBoard } from "../../../lib/board";

const historyPath = path.join(process.cwd(), "data", "kanban-board-history.xlsx");

function isLocalSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    return (
      originUrl.protocol === "http:" &&
      originUrl.host === host &&
      (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isLocalSameOrigin(request)) {
    return Response.json({ error: "Requests must come from this local app." }, { status: 403 });
  }

  let serializedBoard: string | undefined;

  try {
    serializedBoard = JSON.stringify(await request.json());
  } catch {
    return Response.json({ error: "Invalid board data." }, { status: 400 });
  }

  const board = parseBoard(serializedBoard ?? null);
  if (!board) {
    return Response.json({ error: "Invalid board data." }, { status: 400 });
  }

  try {
    await mkdir(path.dirname(historyPath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    if (existsSync(historyPath)) {
      await workbook.xlsx.readFile(historyPath);
    }

    const worksheet = workbook.getWorksheet("Daily Board Log") ?? workbook.addWorksheet("Daily Board Log");
    if (worksheet.rowCount === 0) {
      worksheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Time", key: "time", width: 14 },
        { header: "Column", key: "column", width: 20 },
        { header: "Card", key: "card", width: 36 },
        { header: "Details", key: "details", width: 60 },
      ];
      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
    }

    const timestamp = new Date();
    const date = [
      timestamp.getFullYear(),
      String(timestamp.getMonth() + 1).padStart(2, "0"),
      String(timestamp.getDate()).padStart(2, "0"),
    ].join("-");
    const time = timestamp.toLocaleTimeString();
    const rows: Array<[string, string, string, string, string]> = [];

    for (const column of board.columns) {
      if (column.cards.length === 0) {
        rows.push([date, time, column.title, "", ""]);
      } else {
        for (const card of column.cards) {
          rows.push([date, time, column.title, card.title, card.details]);
        }
      }
    }

    worksheet.addRows(rows);
    await workbook.xlsx.writeFile(historyPath);

    setTimeout(() => process.exit(0), 1200);
    return Response.json({ saved: true, file: "frontend/data/kanban-board-history.xlsx" });
  } catch {
    return Response.json({ error: "The Excel snapshot could not be saved. The server is still running." }, { status: 500 });
  }
}