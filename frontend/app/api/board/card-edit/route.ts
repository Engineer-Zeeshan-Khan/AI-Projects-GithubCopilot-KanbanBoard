import { parseCard } from "../../../lib/board";
import { isLocalSameOrigin } from "../../../lib/local-request";
import { appendCardChangeEvent } from "../../../lib/server-storage";

export async function POST(request: Request) {
  if (!isLocalSameOrigin(request)) {
    return Response.json({ error: "Requests must come from this local app." }, { status: 403 });
  }

  try {
    const payload: unknown = await request.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("before" in payload) ||
      !("after" in payload) ||
      !("columnBefore" in payload) ||
      !("columnAfter" in payload) ||
      !("changedFields" in payload)
    ) {
      return Response.json({ error: "Invalid card data." }, { status: 400 });
    }

    const before = parseCard(payload.before);
    const after = parseCard(payload.after);
    if (
      !before ||
      !after ||
      typeof payload.columnBefore !== "string" ||
      typeof payload.columnAfter !== "string" ||
      !Array.isArray(payload.changedFields) ||
      !payload.changedFields.every((field) => typeof field === "string")
    ) {
      return Response.json({ error: "Invalid card data." }, { status: 400 });
    }

    await appendCardChangeEvent({
      action: "Updated",
      cardBefore: before,
      cardAfter: after,
      columnBefore: payload.columnBefore,
      columnAfter: payload.columnAfter,
      changedFields: payload.changedFields,
    });
    return Response.json({ archived: true });
  } catch (error) {
    console.error("Could not write the before-edit card snapshot:", error);
    return Response.json({ error: "Could not archive the card before updating it." }, { status: 500 });
  }
}