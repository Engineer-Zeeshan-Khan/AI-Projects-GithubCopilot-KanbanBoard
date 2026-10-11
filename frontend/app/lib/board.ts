export type ColumnId = "backlog" | "todo" | "in-progress" | "review" | "done";

export type Card = {
  id: string;
  title: string;
  details: string;
};

export type BoardColumn = {
  id: ColumnId;
  title: string;
  cards: Card[];
};

export type Board = {
  columns: BoardColumn[];
};

function isBoard(value: unknown): value is Board {
  if (
    typeof value !== "object" ||
    value === null ||
    !("columns" in value) ||
    !Array.isArray(value.columns) ||
    value.columns.length !== columnOrder.length
  ) {
    return false;
  }

  return value.columns.every((column, index) => {
    if (
      typeof column !== "object" ||
      column === null ||
      !("id" in column) ||
      !("title" in column) ||
      !("cards" in column) ||
      !Array.isArray(column.cards)
    ) {
      return false;
    }

    return (
      column.id === columnOrder[index].id &&
      typeof column.title === "string" &&
      column.cards.every(
        (card: unknown) =>
          typeof card === "object" &&
          card !== null &&
          "id" in card &&
          "title" in card &&
          "details" in card &&
          typeof card.id === "string" &&
          typeof card.title === "string" &&
          typeof card.details === "string",
      )
    );
  });
}

export function parseBoard(serialized: string | null): Board | null {
  if (!serialized) {
    return null;
  }

  try {
    const board: unknown = JSON.parse(serialized);
    return isBoard(board) ? board : null;
  } catch {
    return null;
  }
}

const columnOrder: Array<{ id: ColumnId; title: string }> = [
  { id: "backlog", title: "Backlog" },
  { id: "todo", title: "To Do" },
  { id: "in-progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
];

const demoCardsByColumn: Record<ColumnId, Card[]> = {
  backlog: [
    { id: "backlog-1", title: "Customer interview notes", details: "Capture the main feature requests and blockers." },
    { id: "backlog-2", title: "Sprint planning draft", details: "Outline the wins and the riskiest work for the next cycle." },
  ],
  todo: [
    { id: "todo-1", title: "Wireframe homepage", details: "Finalize the primary hero and launch sections." },
    { id: "todo-2", title: "Prepare onboarding checklist", details: "Map each step from sign up to first success moment." },
  ],
  "in-progress": [
    { id: "in-progress-1", title: "Build kanban board layout", details: "Create the column structure and card states." },
    { id: "in-progress-2", title: "Refine drag interactions", details: "Make moving cards feel clear and responsive." },
  ],
  review: [
    { id: "review-1", title: "QA checklist", details: "Review responsiveness, copy clarity, and empty states." },
    { id: "review-2", title: "Marketing copy review", details: "Check the tone to ensure consistency and confidence." },
  ],
  done: [
    { id: "done-1", title: "Brand direction approved", details: "The new palette and typography direction is locked." },
    { id: "done-2", title: "Project kickoff deck", details: "Share the final plan and client timeline." },
  ],
};

export function createInitialBoard(): Board {
  return {
    columns: columnOrder.map((column) => ({
      id: column.id,
      title: column.title,
      cards: demoCardsByColumn[column.id].map((card) => ({ ...card })),
    })),
  };
}

export function renameColumn(board: Board, columnId: ColumnId, newTitle: string): Board {
  if (!newTitle.trim()) {
    return board;
  }

  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId ? { ...column, title: newTitle.trim() } : column,
    ),
  };
}

export function addCardToColumn(board: Board, columnId: ColumnId, card: Card): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId ? { ...column, cards: [...column.cards, card] } : column,
    ),
  };
}

export function deleteCard(board: Board, columnId: ColumnId, cardId: string): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId
        ? { ...column, cards: column.cards.filter((card) => card.id !== cardId) }
        : column,
    ),
  };
}

export function moveCardBetweenColumns(
  board: Board,
  fromColumnId: ColumnId,
  toColumnId: ColumnId,
  cardId: string,
): Board {
  if (fromColumnId === toColumnId) {
    return board;
  }

  const sourceColumn = board.columns.find((column) => column.id === fromColumnId);
  const targetColumn = board.columns.find((column) => column.id === toColumnId);

  if (!sourceColumn || !targetColumn) {
    return board;
  }

  const movingCard = sourceColumn.cards.find((card) => card.id === cardId);

  if (!movingCard) {
    return board;
  }

  return {
    ...board,
    columns: board.columns.map((column) => {
      if (column.id === fromColumnId) {
        return {
          ...column,
          cards: column.cards.filter((card) => card.id !== cardId),
        };
      }

      if (column.id === toColumnId) {
        return {
          ...column,
          cards: [...column.cards, movingCard],
        };
      }

      return column;
    }),
  };
}
