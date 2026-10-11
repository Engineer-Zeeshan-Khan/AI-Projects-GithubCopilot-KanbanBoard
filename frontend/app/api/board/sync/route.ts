import { parseBoard } from "../../../lib/board";
import { isLocalSameOrigin } from "../../../lib/local-request";
import { saveCurrentBoard } from "../../../lib/server-storage";

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
    return Response.json({ saved: true });
  } catch {
    return Response.json({ error: "The local board copy could not be saved." }, { status: 500 });
  }
}