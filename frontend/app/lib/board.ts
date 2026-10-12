export type ColumnId = "backlog" | "todo" | "in-progress" | "review" | "done";

export type CardComment = {
  id: string;
  text: string;
  createdAt: string;
};

export type Card = {
  id: string;
  cardRef?: string;
  title: string;
  details: string;
  assignee?: string;
  dueDate?: string;
  priority?: 1 | 2 | 3 | null;
  createdAt?: string;
  comments?: CardComment[];
};

export type BoardColumn = {
  id: ColumnId;
  title: string;
  cards: Card[];
};

export type Board = {
  columns: BoardColumn[];
};

function cardReferenceFromId(id: string): string {
  return `WK${id.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()}`;
}

export function createCardReference(): string {
  return `WK${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

function isCardComment(value: unknown): value is CardComment {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" &&
    "text" in value && typeof value.text === "string" &&
    "createdAt" in value && typeof value.createdAt === "string";
}

function isCard(value: unknown): value is Card {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "title" in value &&
    "details" in value &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.details === "string" &&
    (!("cardRef" in value) || typeof value.cardRef === "string") &&
    (!("assignee" in value) || typeof value.assignee === "string") &&
    (!("dueDate" in value) || typeof value.dueDate === "string") &&
    (!("priority" in value) || value.priority === null || value.priority === 1 || value.priority === 2 || value.priority === 3) &&
    (!("createdAt" in value) || typeof value.createdAt === "string") &&
    (!("comments" in value) || (Array.isArray(value.comments) && value.comments.every(isCardComment)))
  );
}

export function parseCard(value: unknown): Card | null {
  if (!isCard(value)) {
    return null;
  }

  return {
    ...value,
    cardRef: value.cardRef ?? cardReferenceFromId(value.id),
    assignee: value.assignee ?? "",
    dueDate: normalizeDueDate(value.dueDate ?? ""),
    priority: value.priority ?? null,
    createdAt: value.createdAt ?? new Date().toISOString(),
    comments: value.comments ?? [],
  };
}

export function normalizeDueDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value;
}

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
      column.cards.every(isCard)
    );
  });
}

export function parseBoard(serialized: string | null): Board | null {
  if (!serialized) {
    return null;
  }

  try {
    const board: unknown = JSON.parse(serialized);
    if (!isBoard(board)) {
      return null;
    }

    return {
      columns: board.columns.map((column) => ({
        ...column,
        cards: sortCardsByPriority(column.cards.map((card) => parseCard(card)!)),
      })),
    };
  } catch {
    return null;
  }
}

export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nextLocalDayEnd(now = new Date()): Date {
  const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  if (endOfDay <= now) {
    endOfDay.setDate(endOfDay.getDate() + 1);
  }
  return endOfDay;
}

export function formatBoardDate(value: string): string {
  if (!value) {
    return "";
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const [, year, month, day] = match;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).formatToParts(new Date(`${year}-${month}-${day}T00:00:00.000Z`));
  const dateParts = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  return `${dateParts.day}-${dateParts.month}-${dateParts.year}`;
}

function formatDateAndTime(date: string, hour: string, minute: string): string {
  if (!formatBoardDate(date) || !/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return "";
  return `${formatBoardDate(date)} ${hour}:${minute}`;
}

export function formatCreatedDate(value: string, timeZone?: string): string {
  if (!value) {
    return "";
  }

  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (dateOnly) return formatDateAndTime(dateOnly[1], "00", "00");

  const localDateTime = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (localDateTime) return formatDateAndTime(localDateTime[1], localDateTime[2], localDateTime[3]);

  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: timeZone ?? "UTC",
  }).formatToParts(timestamp);
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timeZone ?? "UTC",
  }).format(timestamp);
  return `${dateParts.day}-${dateParts.month}-${dateParts.year} ${time}`;
}

export function formatDueDate(value: string): string {
  return value ? formatCreatedDate(normalizeDueDate(value)) : "";
}

export function sortCardsByPriority(cards: Card[]): Card[] {
  const priorityOrder = (priority: Card["priority"]) => priority ?? 4;
  return [...cards].sort((left, right) => priorityOrder(left.priority) - priorityOrder(right.priority));
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
      cards: demoCardsByColumn[column.id].map((card) => ({
        ...card,
        cardRef: cardReferenceFromId(card.id),
        assignee: "",
        dueDate: "",
        priority: null,
        createdAt: localDateString(),
        comments: [],
      })),
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
      column.id === columnId
        ? { ...column, cards: sortCardsByPriority([...column.cards, card]) }
        : column,
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

export function updateCard(
  board: Board,
  columnId: ColumnId,
  cardId: string,
  changes: Partial<Omit<Card, "id">>,
): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId
        ? {
            ...column,
            cards: sortCardsByPriority(column.cards.map((card) =>
              card.id === cardId ? { ...card, ...changes } : card,
            )),
          }
        : column,
    ),
  };
}

export function moveCardBetweenColumns(
  board: Board,
  fromColumnId: ColumnId,
  toColumnId: ColumnId,
  cardId: string,
  targetIndex?: number,
): Board {
  const sourceColumn = board.columns.find((column) => column.id === fromColumnId);
  const targetColumn = board.columns.find((column) => column.id === toColumnId);

  if (!sourceColumn || !targetColumn) {
    return board;
  }

  const movingCard = sourceColumn.cards.find((card) => card.id === cardId);

  if (!movingCard) {
    return board;
  }

  const sourceCards = sortCardsByPriority(sourceColumn.cards.filter((card) => card.id !== cardId));
  const destinationCards = fromColumnId === toColumnId
    ? sourceCards
    : sortCardsByPriority(targetColumn.cards);
  const insertionIndex = Math.max(0, Math.min(targetIndex ?? destinationCards.length, destinationCards.length));
  destinationCards.splice(insertionIndex, 0, movingCard);
  const orderedDestinationCards = sortCardsByPriority(destinationCards);

  return {
    ...board,
    columns: board.columns.map((column) => {
      if (column.id === fromColumnId) {
        return fromColumnId === toColumnId
          ? { ...column, cards: orderedDestinationCards }
          : { ...column, cards: sourceCards };
      }

      if (column.id === toColumnId) {
        return { ...column, cards: orderedDestinationCards };
      }

      return column;
    }),
  };
}

export function moveOverdueCards(board: Board, nowOrDate: Date | string = new Date()): Board {
  const now = nowOrDate instanceof Date
    ? `${localDateString(nowOrDate)}T${String(nowOrDate.getHours()).padStart(2, "0")}:${String(nowOrDate.getMinutes()).padStart(2, "0")}:${String(nowOrDate.getSeconds()).padStart(2, "0")}`
    : `${nowOrDate}T23:59:59`;
  const isOverdue = (dueDate: string) => `${normalizeDueDate(dueDate).slice(0, 16)}:00` < now;
  let changed = false;
  const columns = board.columns.map((column) => {
    if (column.id === "backlog" || column.id === "done") {
      return column;
    }

    const overdue = column.cards.filter((card) => card.dueDate && isOverdue(card.dueDate));
    if (overdue.length === 0) {
      return column;
    }

    changed = true;
    return { ...column, cards: column.cards.filter((card) => !overdue.includes(card)) };
  });

  if (!changed) {
    return board;
  }

  const overdueCards = board.columns
    .filter((column) => column.id !== "backlog" && column.id !== "done")
    .flatMap((column) => column.cards.filter((card) => card.dueDate && isOverdue(card.dueDate)));

  return {
    ...board,
    columns: columns.map((column) =>
      column.id === "backlog"
        ? { ...column, cards: sortCardsByPriority([...overdueCards, ...column.cards]) }
        : column,
    ),
  };
}
