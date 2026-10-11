import { parseBoard } from "../../../lib/board";
import { isLocalSameOrigin } from "../../../lib/local-request";
import { appendBoardSnapshot, saveCurrentBoard } from "../../../lib/server-storage";

export async function POST(request: Request) {
  if (!isLocalSameOrigin(request)) {
    return Response.json({ error: "Requests must come from this local app." }, { status: 403 });
  }

  try {
    const board = parseBoard(JSON.stringify(await request.json()));
    if (!board) {
      return Response.json({ error: "Invalid board data." }, { status: 400 });
    }

    await saveCurrentBoard(board);
    await appendBoardSnapshot(board, "Manual");

    setTimeout(() => process.exit(0), 1200);
    return Response.json({ saved: true, file: "frontend/data/kanban-board-history.xlsx" });
  } catch {
    return Response.json({ error: "The Excel snapshot could not be saved. The server is still running." }, { status: 500 });
  }
}