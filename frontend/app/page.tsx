"use client";

import { useState, useSyncExternalStore } from "react";
import styles from "./page.module.css";
import {
  addCardToColumn,
  createInitialBoard,
  deleteCard,
  moveCardBetweenColumns,
  parseBoard,
  renameColumn,
  type Board,
  type Card,
  type ColumnId,
} from "./lib/board";

const initialDrafts = {
  backlog: { title: "", details: "" },
  todo: { title: "", details: "" },
  "in-progress": { title: "", details: "" },
  review: { title: "", details: "" },
  done: { title: "", details: "" },
};

const boardStorageKey = "kanban-board";
const initialBoard = createInitialBoard();
let cachedBoard: Board = initialBoard;
let cachedBoardValue: string | null | undefined;
const boardSubscribers = new Set<() => void>();

function getBoardSnapshot(): Board {
  if (typeof window === "undefined") {
    return initialBoard;
  }

  const serializedBoard = window.localStorage.getItem(boardStorageKey);
  if (serializedBoard !== cachedBoardValue) {
    cachedBoardValue = serializedBoard;
    cachedBoard = parseBoard(serializedBoard) ?? initialBoard;
  }

  return cachedBoard;
}

function subscribeToBoard(subscriber: () => void) {
  boardSubscribers.add(subscriber);
  const handleStorage = () => {
    cachedBoardValue = undefined;
    subscriber();
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    boardSubscribers.delete(subscriber);
    window.removeEventListener("storage", handleStorage);
  };
}

function updateBoard(update: (current: Board) => Board) {
  const nextBoard = update(getBoardSnapshot());
  const serializedBoard = JSON.stringify(nextBoard);
  window.localStorage.setItem(boardStorageKey, serializedBoard);
  cachedBoardValue = serializedBoard;
  cachedBoard = nextBoard;
  boardSubscribers.forEach((subscriber) => subscriber());
}

const columnColors: Record<ColumnId, { background: string; border: string; accent: string }> = {
  backlog: {
    background: "linear-gradient(180deg, rgba(255, 228, 232, 0.95) 0%, rgba(255, 245, 247, 0.95) 100%)",
    border: "rgba(176, 82, 95, 0.22)",
    accent: "#c05263",
  },
  todo: {
    background: "linear-gradient(180deg, rgba(228, 239, 255, 0.96) 0%, rgba(245, 249, 255, 0.96) 100%)",
    border: "rgba(42, 106, 204, 0.22)",
    accent: "#3d7be5",
  },
  "in-progress": {
    background: "linear-gradient(180deg, rgba(226, 250, 234, 0.96) 0%, rgba(244, 255, 247, 0.96) 100%)",
    border: "rgba(41, 141, 93, 0.22)",
    accent: "#2f9f69",
  },
  review: {
    background: "linear-gradient(180deg, rgba(255, 243, 219, 0.96) 0%, rgba(255, 249, 239, 0.96) 100%)",
    border: "rgba(205, 146, 40, 0.24)",
    accent: "#d09120",
  },
  done: {
    background: "linear-gradient(180deg, rgba(222, 248, 232, 0.96) 0%, rgba(244, 255, 248, 0.96) 100%)",
    border: "rgba(35, 122, 85, 0.22)",
    accent: "#278b5d",
  },
};

export default function Home() {
  const board = useSyncExternalStore(
    subscribeToBoard,
    getBoardSnapshot,
    () => initialBoard,
  );
  const [drafts, setDrafts] = useState(initialDrafts);
  const [draggedCard, setDraggedCard] = useState<{ cardId: string; fromColumnId: ColumnId } | null>(null);
  const [isTurningOff, setIsTurningOff] = useState(false);
  const [shutdownMessage, setShutdownMessage] = useState("");
  const [shutdownError, setShutdownError] = useState("");

  const handleTurnOff = async () => {
    setIsTurningOff(true);
    setShutdownError("");

    try {
      const response = await fetch("/api/board/off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error);
      }

      setShutdownMessage(
        `Saved to ${result.file}. Restart with: cd frontend && npm run dev`,
      );
    } catch (error) {
      setIsTurningOff(false);
      setShutdownError(
        error instanceof Error ? error.message : "Could not save the daily snapshot.",
      );
    }
  };

  const updateDraft = (columnId: ColumnId, field: "title" | "details", value: string) => {
    setDrafts((current) => ({
      ...current,
      [columnId]: {
        ...current[columnId],
        [field]: value,
      },
    }));
  };

  const handleAddCard = (columnId: ColumnId) => {
    const draft = drafts[columnId];
    const title = draft.title.trim();

    if (!title) {
      return;
    }

    const newCard: Card = {
      id: `${columnId}-${Date.now()}`,
      title,
      details: draft.details.trim() || "No additional details.",
    };

    updateBoard((current) => addCardToColumn(current, columnId, newCard));
    setDrafts((current) => ({
      ...current,
      [columnId]: { title: "", details: "" },
    }));
  };

  const handleRename = (columnId: ColumnId, title: string) => {
    updateBoard((current) => renameColumn(current, columnId, title));
  };

  const handleDelete = (columnId: ColumnId, cardId: string) => {
    updateBoard((current) => deleteCard(current, columnId, cardId));
  };

  const handleDrop = (targetColumnId: ColumnId) => {
    if (!draggedCard) {
      return;
    }

    updateBoard((current) =>
      moveCardBetweenColumns(
        current,
        draggedCard.fromColumnId,
        targetColumnId,
        draggedCard.cardId,
      ),
    );
    setDraggedCard(null);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleWrap}>
          <p className={styles.eyebrow}>Project board</p>
          <h1>Zeeshan Task Kanban</h1>
          <div className={styles.serverControls}>
            <button
              type="button"
              className={styles.serverButton}
              style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
              onClick={handleTurnOff}
              disabled={isTurningOff}
            >
              {isTurningOff ? "Saving snapshot..." : "Save snapshot & turn off"}
            </button>
            {shutdownMessage && <p className={styles.serverMessage} role="status">{shutdownMessage}</p>}
            {shutdownError && <p className={styles.serverError} role="alert">{shutdownError}</p>}
          </div>
        </div>
      </header>

      <main className={styles.board}>
        {board.columns.map((column) => (
          <section
            key={column.id}
            className={styles.column}
            style={{
              background: columnColors[column.id].background,
              borderColor: columnColors[column.id].border,
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(column.id)}
          >
            <div className={styles.columnHeader}>
              <div
                className={styles.columnAccent}
                style={{ background: columnColors[column.id].accent }}
              />
              <input
                aria-label={`Rename ${column.title} column`}
                value={column.title}
                onChange={(event) => handleRename(column.id, event.target.value)}
                className={styles.columnTitle}
              />
            </div>

            <div className={styles.cardList}>
              {column.cards.map((card) => (
                <article
                  key={card.id}
                  className={styles.card}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDraggedCard({ cardId: card.id, fromColumnId: column.id });
                  }}
                  onDragEnd={() => setDraggedCard(null)}
                >
                  <div className={styles.cardTopRow}>
                    <h3>{card.title}</h3>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      aria-label={`Delete ${card.title}`}
                      onClick={() => handleDelete(column.id, card.id)}
                    >
                      ×
                    </button>
                  </div>
                  <p>{card.details}</p>
                </article>
              ))}
            </div>

            <div className={styles.formBlock}>
              <input
                value={drafts[column.id].title}
                onChange={(event) => updateDraft(column.id, "title", event.target.value)}
                placeholder="Card title"
                aria-label={`Title for ${column.title}`}
              />
              <textarea
                value={drafts[column.id].details}
                onChange={(event) => updateDraft(column.id, "details", event.target.value)}
                placeholder="Details"
                rows={3}
                aria-label={`Details for ${column.title}`}
              />
              <button type="button" onClick={() => handleAddCard(column.id)}>
                Add card
              </button>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
