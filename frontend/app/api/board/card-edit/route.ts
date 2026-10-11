import { parseCard } from "../../../lib/board";
import { isLocalSameOrigin } from "../../../lib/local-request";
import { appendCardBeforeEditSnapshot } from "../../../lib/server-storage";

export async function POST(request: Request) {
  if (!isLocalSameOrigin(request)) {
    return Response.json({ error: "Requests must come from this local app." }, { status: 403 });
  }

  try {
    const payload: unknown = await request.json();
    if (typeof payload !== "object" || payload === null || !("card" in payload) || !("columnTitle" in payload)) {
      return Response.json({ error: "Invalid card data." }, { status: 400 });
    }

    const card = parseCard(payload.card);
    if (!card || typeof payload.columnTitle !== "string") {
      return Response.json({ error: "Invalid card data." }, { status: 400 });
    }

    await appendCardBeforeEditSnapshot(card, payload.columnTitle);
    return Response.json({ archived: true });
  } catch (error) {
    console.error("Could not write the before-edit card snapshot:", error);
    return Response.json({ error: "Could not archive the card before updating it." }, { status: 500 });
  }
}