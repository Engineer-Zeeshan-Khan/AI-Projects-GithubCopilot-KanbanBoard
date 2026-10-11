import { parseCard } from "../../../lib/board";
import { isLocalSameOrigin } from "../../../lib/local-request";
import { appendCardChangeEvent, type CardChangeEvent } from "../../../lib/server-storage";

const allowedActions: CardChangeEvent["action"][] = [
  "Created",
  "Deleted",
  "Moved",
  "Reordered",
  "Comment added",
  "Comment deleted",
];

export async function POST(request: Request) {
  if (!isLocalSameOrigin(request)) {
    return Response.json({ error: "Requests must come from this local app." }, { status: 403 });
  }

  try {
    const payload: unknown = await request.json();
    if (typeof payload !== "object" || payload === null) {
      return Response.json({ error: "Invalid card change." }, { status: 400 });
    }

    const value = payload as Record<string, unknown>;
    if (
      typeof value.action !== "string" ||
      !allowedActions.includes(value.action as CardChangeEvent["action"]) ||
      !Array.isArray(value.changedFields) ||
      !value.changedFields.every((field) => typeof field === "string")
    ) {
      return Response.json({ error: "Invalid card change." }, { status: 400 });
    }

    const before = value.cardBefore == null ? undefined : parseCard(value.cardBefore) ?? undefined;
    const after = value.cardAfter == null ? undefined : parseCard(value.cardAfter) ?? undefined;
    if (
      (value.cardBefore != null && !before) ||
      (value.cardAfter != null && !after) ||
      (value.columnBefore != null && typeof value.columnBefore !== "string") ||
      (value.columnAfter != null && typeof value.columnAfter !== "string") ||
      (value.commentId != null && typeof value.commentId !== "string") ||
      (value.commentText != null && typeof value.commentText !== "string")
    ) {
      return Response.json({ error: "Invalid card change." }, { status: 400 });
    }

    await appendCardChangeEvent({
      action: value.action as CardChangeEvent["action"],
      cardBefore: before,
      cardAfter: after,
      columnBefore: value.columnBefore as string | undefined,
      columnAfter: value.columnAfter as string | undefined,
      changedFields: value.changedFields as string[],
      commentId: value.commentId as string | undefined,
      commentText: value.commentText as string | undefined,
    });

    return Response.json({ recorded: true });
  } catch (error) {
    console.error("Could not append the card change event:", error);
    return Response.json({ error: "Could not record the card change." }, { status: 500 });
  }
}