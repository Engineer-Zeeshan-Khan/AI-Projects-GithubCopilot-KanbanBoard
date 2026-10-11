import { describe, expect, it } from "vitest";
import {
  addCardToColumn,
  createInitialBoard,
  deleteCard,
  moveCardBetweenColumns,
  parseBoard,
  renameColumn,
} from "./board";

describe("kanban board logic", () => {
  it("creates a board with five columns and seeded cards", () => {
    const board = createInitialBoard();

    expect(board.columns).toHaveLength(5);
    expect(board.columns.map((column) => column.title)).toEqual([
      "Backlog",
      "To Do",
      "In Progress",
      "Review",
      "Done",
    ]);
    expect(board.columns.every((column) => column.cards.length > 0)).toBe(true);
  });

  it("restores a saved board", () => {
    const board = renameColumn(createInitialBoard(), "backlog", "Ideas");

    expect(parseBoard(JSON.stringify(board))).toEqual(board);
  });

  it("ignores invalid saved board data", () => {
    expect(parseBoard("not json")).toBeNull();
    expect(parseBoard(JSON.stringify({ columns: [] }))).toBeNull();
  });

  it("renames a column", () => {
    const board = createInitialBoard();

    const updated = renameColumn(board, "backlog", "Ideas");

    expect(updated.columns[0].title).toBe("Ideas");
  });

  it("adds a card to a column", () => {
    const board = createInitialBoard();

    const updated = addCardToColumn(board, "todo", {
      id: "new-card",
      title: "Draft release notes",
      details: "Summarize product changes for launch day.",
    });

    expect(updated.columns[1].cards.at(-1)).toMatchObject({
      id: "new-card",
      title: "Draft release notes",
    });
  });

  it("deletes a card from a column", () => {
    const board = createInitialBoard();
    const targetId = board.columns[0].cards[0].id;

    const updated = deleteCard(board, "backlog", targetId);

    expect(updated.columns[0].cards.some((card) => card.id === targetId)).toBe(false);
  });

  it("moves a card to a different column", () => {
    const board = createInitialBoard();
    const cardId = board.columns[0].cards[0].id;

    const updated = moveCardBetweenColumns(board, "backlog", "todo", cardId);

    expect(updated.columns[0].cards.some((card) => card.id === cardId)).toBe(false);
    expect(updated.columns[1].cards.some((card) => card.id === cardId)).toBe(true);
  });
});
