import { describe, expect, it } from "vitest";
import {
  addCardToColumn,
  createInitialBoard,
  createCardReference,
  deleteCard,
  formatBoardDate,
  formatCreatedDate,
  formatDueDate,
  moveCardBetweenColumns,
  moveOverdueCards,
  nextLocalDayEnd,
  parseBoard,
  renameColumn,
  sortCardsByPriority,
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
      assignee: "Alex",
      dueDate: "2026-12-01",
      priority: 1,
      createdAt: "2026-10-11",
    });

    expect(updated.columns[1].cards.find((card) => card.id === "new-card")).toMatchObject({
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

  it("reorders cards within a column", () => {
    const board = createInitialBoard();
    const cardId = board.columns[0].cards[0].id;

    const updated = moveCardBetweenColumns(board, "backlog", "backlog", cardId, 1);

    expect(updated.columns[0].cards.map((card) => card.id)).toEqual([
      "backlog-2",
      "backlog-1",
    ]);
  });

  it("moves overdue open cards to backlog and preserves done cards", () => {
    const board = createInitialBoard();
    board.columns[1].cards[0].dueDate = "2026-01-01";
    board.columns[4].cards[0].dueDate = "2026-01-01";

    const updated = moveOverdueCards(board, "2026-10-11");

    expect(updated.columns[0].cards[0].id).toBe("todo-1");
    expect(updated.columns[1].cards.map((card) => card.id)).not.toContain("todo-1");
    expect(updated.columns[4].cards.map((card) => card.id)).toContain("done-1");
  });

  it("moves cards to backlog only after their exact local due time", () => {
    const board = createInitialBoard();
    board.columns[1].cards[0].dueDate = "2026-10-11T14:00";
    board.columns[1].cards[1].dueDate = "2026-10-11T14:30";

    const updated = moveOverdueCards(board, new Date(2026, 9, 11, 14, 15));

    expect(updated.columns[0].cards.map((card) => card.id)).toContain("todo-1");
    expect(updated.columns[1].cards.map((card) => card.id)).toContain("todo-2");
  });

  it("marks a deadline overdue immediately after its minute ends", () => {
    const board = createInitialBoard();
    board.columns[1].cards[0].dueDate = "2026-10-11T23:59";

    const updated = moveOverdueCards(board, new Date(2026, 9, 11, 23, 59, 1));

    expect(updated.columns[0].cards.map((card) => card.id)).toContain("todo-1");
  });

  it("migrates cards saved before metadata was added", () => {
    const board = createInitialBoard();
    const legacyBoard = JSON.parse(JSON.stringify(board)) as typeof board;
    delete legacyBoard.columns[0].cards[0].assignee;
    delete legacyBoard.columns[0].cards[0].dueDate;
    delete legacyBoard.columns[0].cards[0].priority;
    delete legacyBoard.columns[0].cards[0].createdAt;

    expect(parseBoard(JSON.stringify(legacyBoard))?.columns[0].cards[0]).toMatchObject({
      cardRef: "WKBACKLOG1",
      assignee: "",
      dueDate: "",
      priority: null,
      comments: [],
    });
  });

  it("formats board dates as dd-MMM-yy", () => {
    expect(formatBoardDate("2026-10-11")).toBe("11-Oct-26");
  });

  it("schedules the automatic snapshot at the end of the local day", () => {
    const beforeEnd = nextLocalDayEnd(new Date(2026, 9, 11, 16, 0, 0));
    const afterEnd = nextLocalDayEnd(new Date(2026, 9, 11, 23, 59, 59, 999));

    expect(beforeEnd).toEqual(new Date(2026, 9, 11, 23, 59, 59, 999));
    expect(afterEnd).toEqual(new Date(2026, 9, 12, 23, 59, 59, 999));
  });

  it("sorts P1 and P2 above other priorities without changing same-tier order", () => {
    const board = createInitialBoard();
    const cards = [
      { ...board.columns[0].cards[0], id: "none", priority: null },
      { ...board.columns[0].cards[1], id: "p2", priority: 2 as const },
      { ...board.columns[0].cards[0], id: "p1", priority: 1 as const },
      { ...board.columns[0].cards[1], id: "p3", priority: 3 as const },
    ];

    expect(sortCardsByPriority(cards).map((card) => card.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "none",
    ]);
  });

  it("restores saved cards with P1 and P2 at the top", () => {
    const board = createInitialBoard();
    board.columns[0].cards[0].priority = null;
    board.columns[0].cards[1].priority = 1;

    const restored = parseBoard(JSON.stringify(board));

    expect(restored?.columns[0].cards.map((card) => card.id)).toEqual([
      "backlog-2",
      "backlog-1",
    ]);
  });

  it("formats a creation timestamp with date and 24-hour time", () => {
    expect(formatCreatedDate("2026-10-11T16:35:00.000Z")).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("formats ISO timestamps consistently for an explicit timezone", () => {
    expect(formatCreatedDate("2026-10-11T01:00:00.000Z", "America/Los_Angeles")).toBe("10-Oct-26 18:00");
    expect(formatCreatedDate("not a date", "UTC")).toBe("");
  });

  it("formats due dates with date and time and migrates legacy date-only values", () => {
    expect(formatDueDate("2026-10-11T16:35")).toMatch(/^11-Oct-26 \d{2}:\d{2}$/);
    expect(formatDueDate("2026-10-11")).toMatch(/^11-Oct-26 \d{2}:\d{2}$/);
  });

  it("creates unique alphanumeric card references", () => {
    const first = createCardReference();
    const second = createCardReference();

    expect(first).toMatch(/^WK[A-Z0-9]{10}$/);
    expect(second).not.toBe(first);
  });
});
