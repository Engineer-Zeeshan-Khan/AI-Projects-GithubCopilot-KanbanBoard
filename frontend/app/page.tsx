"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./page.module.css";
import {
  addCardToColumn,
  createCardReference,
  createInitialBoard,
  deleteCard,
  formatBoardDate,
  formatCreatedDate,
  formatDueDate,
  localDateString,
  moveCardBetweenColumns,
  moveOverdueCards,
  parseBoard,
  renameColumn,
  updateCard,
  type Board,
  type Card,
  type CardComment,
  type ColumnId,
} from "./lib/board";

type CardDraft = {
  title: string;
  details: string;
  assignee: string;
  dueDate: string;
  priority: 1 | 2 | 3 | null;
};

const emptyDraft: CardDraft = {
  title: "",
  details: "",
  assignee: "",
  dueDate: "",
  priority: null,
};

type CardChangeAction = "Created" | "Deleted" | "Moved" | "Reordered" | "Comment added" | "Comment deleted";
type CardChangePayload = {
  action: CardChangeAction;
  cardBefore?: Card;
  cardAfter?: Card;
  columnBefore?: string;
  columnAfter?: string;
  changedFields: string[];
  commentId?: string;
  commentText?: string;
};

async function recordCardChange(event: CardChangePayload) {
  const response = await fetch("/api/board/card-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error);
  }
}

async function recordOverdueCardMoves(before: Board, after: Board) {
  const backlog = after.columns.find((column) => column.id === "backlog");
  if (!backlog) return;

  const backlogIds = new Set(backlog.cards.map((card) => card.id));
  const movedCards = before.columns
    .filter((column) => column.id !== "backlog" && column.id !== "done")
    .flatMap((column) => column.cards
      .filter((card) => backlogIds.has(card.id))
      .map((card) => ({ card, column })));

  await Promise.all(movedCards.map(({ card, column }) => recordCardChange({
    action: "Moved",
    cardBefore: card,
    cardAfter: card,
    columnBefore: column.title,
    columnAfter: backlog.title,
    changedFields: ["column", "due time passed"],
  })));
}

const boardStorageKey = "kanban-board";
const teamProfileStorageKey = "kanban-team-profile";
type TeamProfile = { name: string; logo: string };
const defaultTeamProfile: TeamProfile = { name: "Weekly Team", logo: "" };
let cachedTeamProfile = defaultTeamProfile;
let cachedTeamProfileValue: string | null | undefined;
const teamProfileSubscribers = new Set<() => void>();
const initialBoard = createInitialBoard();
let cachedBoard: Board = initialBoard;
let cachedBoardValue: string | null | undefined;
const boardSubscribers = new Set<() => void>();
const clockSubscribers = new Set<() => void>();
let clockSnapshot: Date | null = null;
let clockTimer: ReturnType<typeof setInterval> | undefined;

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

function getClockSnapshot() {
  return clockSnapshot;
}

function subscribeToClock(subscriber: () => void) {
  clockSubscribers.add(subscriber);
  if (!clockTimer) {
    clockSnapshot = new Date();
    clockTimer = setInterval(() => {
      clockSnapshot = new Date();
      clockSubscribers.forEach((notify) => notify());
    }, 1000);
  }

  return () => {
    clockSubscribers.delete(subscriber);
    if (clockSubscribers.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

function syncBoard(board: Board) {
  void fetch("/api/board/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(board),
    keepalive: true,
  }).catch(() => undefined);
}

function getTeamProfileSnapshot(): TeamProfile {
  if (typeof window === "undefined") {
    return defaultTeamProfile;
  }

  const serializedProfile = window.localStorage.getItem(teamProfileStorageKey);
  if (serializedProfile !== cachedTeamProfileValue) {
    cachedTeamProfileValue = serializedProfile;
    try {
      const parsed = serializedProfile ? JSON.parse(serializedProfile) as Partial<TeamProfile> : {};
      cachedTeamProfile = {
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : defaultTeamProfile.name,
        logo: typeof parsed.logo === "string" ? parsed.logo : "",
      };
    } catch {
      cachedTeamProfile = defaultTeamProfile;
    }
  }

  return cachedTeamProfile;
}

function subscribeToTeamProfile(subscriber: () => void) {
  teamProfileSubscribers.add(subscriber);
  const handleStorage = () => {
    cachedTeamProfileValue = undefined;
    subscriber();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    teamProfileSubscribers.delete(subscriber);
    window.removeEventListener("storage", handleStorage);
  };
}

function saveTeamProfile(profile: TeamProfile) {
  const serializedProfile = JSON.stringify(profile);
  window.localStorage.setItem(teamProfileStorageKey, serializedProfile);
  cachedTeamProfileValue = serializedProfile;
  cachedTeamProfile = profile;
  teamProfileSubscribers.forEach((subscriber) => subscriber());
}

function updateBoard(update: (current: Board) => Board) {
  const nextBoard = moveOverdueCards(update(getBoardSnapshot()));
  const serializedBoard = JSON.stringify(nextBoard);
  window.localStorage.setItem(boardStorageKey, serializedBoard);
  cachedBoardValue = serializedBoard;
  cachedBoard = nextBoard;
  boardSubscribers.forEach((subscriber) => subscriber());
  syncBoard(nextBoard);
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
  const teamProfile = useSyncExternalStore(
    subscribeToTeamProfile,
    getTeamProfileSnapshot,
    () => defaultTeamProfile,
  );
  const [draft, setDraft] = useState<CardDraft>({ ...emptyDraft });
  const clock = useSyncExternalStore(subscribeToClock, getClockSnapshot, () => null);
  const [draggedCard, setDraggedCard] = useState<{ cardId: string; fromColumnId: ColumnId } | null>(null);
  const [isTurningOff, setIsTurningOff] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [snapshotSavedFor, setSnapshotSavedFor] = useState<string | null>(null);
  const [isCreatingCard, setIsCreatingCard] = useState(false);
  const [boardMessage, setBoardMessage] = useState("");
  const [boardError, setBoardError] = useState("");
  const [editingCard, setEditingCard] = useState<{
    cardId: string;
    columnId: ColumnId;
    draft: Card;
  } | null>(null);
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [openCommentCardId, setOpenCommentCardId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const commentsPanelRef = useRef<HTMLDivElement>(null);
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [teamNameDraft, setTeamNameDraft] = useState("Weekly Team");
  const [teamLogoDraft, setTeamLogoDraft] = useState("");
  const [customizeError, setCustomizeError] = useState("");
  const teamName = teamProfile.name;
  const teamLogo = teamProfile.logo;

  useEffect(() => {
    const currentBoard = getBoardSnapshot();
    const overdueBoard = moveOverdueCards(currentBoard);
    if (overdueBoard !== currentBoard) {
      void recordOverdueCardMoves(currentBoard, overdueBoard)
        .then(() => updateBoard(() => overdueBoard))
        .catch((error: unknown) => setBoardError(error instanceof Error ? error.message : "Could not record overdue moves."));
    } else {
      syncBoard(currentBoard);
    }

    const overdueTimer = setInterval(() => {
      const latestBoard = getBoardSnapshot();
      const updatedBoard = moveOverdueCards(latestBoard);
      if (updatedBoard !== latestBoard) {
        void recordOverdueCardMoves(latestBoard, updatedBoard)
          .then(() => updateBoard(() => updatedBoard))
          .catch((error: unknown) => setBoardError(error instanceof Error ? error.message : "Could not record overdue moves."));
      }
    }, 60_000);

    return () => clearInterval(overdueTimer);
  }, []);

  useEffect(() => {
    if (!openCommentCardId) {
      return;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !commentsPanelRef.current?.contains(event.target)) {
        setOpenCommentCardId(null);
        setCommentDraft("");
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [openCommentCardId]);

  const handleBoardAction = async (action: "snapshot" | "off") => {
    const shuttingDown = action === "off";
    const serializedBoard = JSON.stringify(board);
    setIsTurningOff(shuttingDown);
    setIsSavingSnapshot(!shuttingDown);
    setBoardError("");
    setBoardMessage("");

    try {
      const response = await fetch(`/api/board/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializedBoard,
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error);
      }

      if (shuttingDown) {
        setBoardMessage("Snapshot saved. The app is turning off.");
      } else {
        setSnapshotSavedFor(serializedBoard);
      }
    } catch (error) {
      setIsTurningOff(false);
      setIsSavingSnapshot(false);
      setBoardError(
        error instanceof Error ? error.message : "Could not save the daily snapshot.",
      );
    } finally {
      if (!shuttingDown) {
        setIsSavingSnapshot(false);
      }
    }
  };

  const updateDraft = (field: keyof CardDraft, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: field === "priority"
        ? value === "" ? null : Number(value) as CardDraft["priority"]
        : value,
    }));
  };

  const handleAddCard = async () => {
    const title = draft.title.trim();

    if (!title) {
      return;
    }

    const newCard: Card = {
      id: `todo-${Date.now()}`,
      cardRef: createCardReference(),
      title,
      details: draft.details.trim() || "No additional details.",
      assignee: draft.assignee.trim(),
      dueDate: draft.dueDate,
      priority: draft.priority,
      createdAt: new Date().toISOString(),
      comments: [],
    };

    setIsCreatingCard(true);
    setBoardError("");
    try {
      await recordCardChange({
        action: "Created",
        cardAfter: newCard,
        columnAfter: newCard.dueDate && newCard.dueDate.slice(0, 10) < localDateString() ? "Backlog" : "To Do",
        changedFields: ["title", "details", "owner", "due on", "priority"],
      });
      updateBoard((current) => addCardToColumn(current, "todo", newCard));
      setDraft({ ...emptyDraft });
      setIsAddingCard(false);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "Could not record the new card.");
    } finally {
      setIsCreatingCard(false);
    }
  };

  const handleSaveTeamProfile = () => {
    const profile = { name: teamNameDraft.trim() || "Weekly Team", logo: teamLogoDraft };
    try {
      saveTeamProfile(profile);
      setCustomizeError("");
      setCustomizeOpen(false);
    } catch {
      setCustomizeError("Could not save this image in browser storage. Choose a smaller image.");
    }
  };

  const handleTeamLogo = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 1_500_000) {
      setCustomizeError("Choose an image smaller than 1.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setTeamLogoDraft(String(reader.result));
      setCustomizeError("");
    };
    reader.readAsDataURL(file);
  };

  const handleRename = (columnId: ColumnId, title: string) => {
    updateBoard((current) => renameColumn(current, columnId, title));
  };

  const handleDelete = async (columnId: ColumnId, cardId: string) => {
    const column = board.columns.find((item) => item.id === columnId);
    const card = column?.cards.find((item) => item.id === cardId);
    if (!column || !card) return;

    setSavingCardId(cardId);
    setBoardError("");
    try {
      await recordCardChange({
        action: "Deleted",
        cardBefore: card,
        columnBefore: column.title,
        changedFields: ["deleted"],
      });
      updateBoard((current) => deleteCard(current, columnId, cardId));
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "Could not record card deletion.");
    } finally {
      setSavingCardId(null);
    }
  };

  const handleEditCard = (columnId: ColumnId, card: Card) => {
    setBoardError("");
    setEditingCard({ cardId: card.id, columnId, draft: { ...card } });
  };

  const handleSaveCardEdit = async (columnTitle: string) => {
    if (!editingCard) {
      return;
    }

    const currentCard = board.columns
      .find((column) => column.id === editingCard.columnId)
      ?.cards.find((card) => card.id === editingCard.cardId);
    const currentColumn = board.columns.find((column) => column.id === editingCard.columnId);
    if (!currentCard || !currentColumn) {
      setEditingCard(null);
      return;
    }

    setSavingCardId(editingCard.cardId);
    setBoardError("");
    try {
      const afterCard = { ...editingCard.draft };
      const changedFields: string[] = (["title", "details", "assignee", "dueDate", "priority"] as const)
        .filter((field) => currentCard[field] !== afterCard[field])
        .map((field) => field === "assignee" ? "owner" : field === "dueDate" ? "due on" : field);
      const movesToBacklog = Boolean(afterCard.dueDate) &&
        afterCard.dueDate!.slice(0, 10) < localDateString() &&
        currentColumn.id !== "backlog" && currentColumn.id !== "done";
      if (movesToBacklog) changedFields.push("column");
      if (changedFields.length === 0) {
        setEditingCard(null);
        return;
      }

      const response = await fetch("/api/board/card-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          before: currentCard,
          after: afterCard,
          columnBefore: currentColumn.title,
          columnAfter: movesToBacklog ? "Backlog" : columnTitle,
          changedFields,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error);
      }

      const { title, details, assignee, dueDate, priority } = afterCard;
      updateBoard((current) => updateCard(current, editingCard.columnId, editingCard.cardId, {
        title,
        details,
        assignee,
        dueDate,
        priority,
      }));
      setEditingCard(null);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "Could not save card changes.");
    } finally {
      setSavingCardId(null);
    }
  };

  const handleAddComment = async (columnId: ColumnId, card: Card) => {
    const text = commentDraft.trim();
    if (!text) return;

    const column = board.columns.find((item) => item.id === columnId);
    if (!column) return;

    const comment: CardComment = {
      id: crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString(),
    };
    const cardAfter = { ...card, comments: [...(card.comments ?? []), comment] };

    try {
      await recordCardChange({
        action: "Comment added",
        cardBefore: card,
        cardAfter,
        columnBefore: column.title,
        columnAfter: column.title,
        changedFields: ["comments"],
        commentId: comment.id,
        commentText: comment.text,
      });
      updateBoard((current) => updateCard(current, columnId, card.id, { comments: cardAfter.comments }));
      setCommentDraft("");
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "Could not record the comment.");
    }
  };

  const handleDeleteComment = async (columnId: ColumnId, card: Card, comment: CardComment) => {
    const column = board.columns.find((item) => item.id === columnId);
    if (!column) return;

    const cardAfter = { ...card, comments: (card.comments ?? []).filter((item) => item.id !== comment.id) };
    try {
      await recordCardChange({
        action: "Comment deleted",
        cardBefore: card,
        cardAfter,
        columnBefore: column.title,
        columnAfter: column.title,
        changedFields: ["comments"],
        commentId: comment.id,
        commentText: comment.text,
      });
      updateBoard((current) => updateCard(current, columnId, card.id, { comments: cardAfter.comments }));
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "Could not record the comment deletion.");
    }
  };

  const handleDrop = async (targetColumnId: ColumnId, targetIndex?: number) => {
    if (!draggedCard) {
      return;
    }

    const fromColumn = board.columns.find((column) => column.id === draggedCard.fromColumnId);
    const toColumn = board.columns.find((column) => column.id === targetColumnId);
    const cardBefore = fromColumn?.cards.find((card) => card.id === draggedCard.cardId);
    if (!fromColumn || !toColumn || !cardBefore) {
      setDraggedCard(null);
      return;
    }

    const fromIndex = fromColumn.cards.findIndex((card) => card.id === cardBefore.id);
    if (fromColumn.id === toColumn.id && (targetIndex === undefined || targetIndex === fromIndex)) {
      setDraggedCard(null);
      return;
    }

    const cardChangeAction = fromColumn.id === toColumn.id ? "Reordered" : "Moved";
    try {
      await recordCardChange({
        action: cardChangeAction,
        cardBefore,
        cardAfter: cardBefore,
        columnBefore: fromColumn.title,
        columnAfter: toColumn.title,
        changedFields: [cardChangeAction === "Moved" ? "column" : "order"],
      });
      updateBoard((current) => moveCardBetweenColumns(
        current,
        draggedCard.fromColumnId,
        targetColumnId,
        draggedCard.cardId,
        targetIndex,
      ));
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "Could not record card movement.");
    } finally {
      setDraggedCard(null);
    }
  };

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          {teamLogo ? (
            <span className={styles.brandImage} style={{ backgroundImage: `url(${teamLogo})` }} role="img" aria-label={`${teamName} logo`} />
          ) : (
            <span className={styles.brandMark}>{teamName.slice(0, 1).toUpperCase()}</span>
          )}
          <button
            type="button"
            className={styles.teamName}
            onDoubleClick={() => {
              setTeamNameDraft(teamName);
              setTeamLogoDraft(teamLogo);
              setCustomizeOpen(true);
            }}
            aria-label={`${teamName}. Double-click to customize`}
            title="Double-click to customize"
          >
            {teamName}
          </button>
        </div>
        <nav className={styles.sidebarNav} aria-label="Board actions">
          <a className={`${styles.navItem} ${styles.navItemActive}`} href="#board">
            <span aria-hidden="true">▦</span> Board
          </a>
          <button type="button" className={styles.navItem} onClick={() => setIsAddingCard((open) => !open)}>
            <span aria-hidden="true">＋</span>{isAddingCard ? "Close new card" : "Add card"}
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => void handleBoardAction("snapshot")}
            disabled={isSavingSnapshot || isTurningOff || snapshotSavedFor === JSON.stringify(board)}
          >
            <span aria-hidden="true">↓</span>{isSavingSnapshot ? "Saving..." : "Save snapshot"}
          </button>
          <button
            type="button"
            className={`${styles.navItem} ${styles.navItemDanger}`}
            onClick={() => void handleBoardAction("off")}
            disabled={isSavingSnapshot || isTurningOff}
          >
            <span aria-hidden="true">◉</span>{isTurningOff ? "Turning off..." : "Turn off"}
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => {
              setTeamNameDraft(teamName);
              setTeamLogoDraft(teamLogo);
              setCustomizeOpen((open) => !open);
              setCustomizeError("");
            }}
          >
            <span aria-hidden="true">⚙</span> Customize
          </button>
        </nav>
        {isAddingCard && (
          <form
            className={styles.sidebarForm}
            onSubmit={(event) => {
              event.preventDefault();
              handleAddCard();
            }}
          >
            <h2>New card</h2>
            <span className={styles.destinationLabel}>Adding to To Do</span>
            <input autoFocus value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} placeholder="Card title" aria-label="New card title" required />
            <textarea value={draft.details} onChange={(event) => updateDraft("details", event.target.value)} placeholder="Details" aria-label="New card details" rows={3} />
            <input value={draft.assignee} onChange={(event) => updateDraft("assignee", event.target.value)} placeholder="Owner (optional)" aria-label="New card owner" />
            <label className={styles.dateTimeField}>
              <span>Due on</span>
              <input type="datetime-local" value={draft.dueDate} onChange={(event) => updateDraft("dueDate", event.target.value)} aria-label="New card due on" />
            </label>
            <select value={draft.priority ?? ""} onChange={(event) => updateDraft("priority", event.target.value)} aria-label="New card priority">
              <option value="">No priority</option>
              <option value={1}>Priority 1</option>
              <option value={2}>Priority 2</option>
              <option value={3}>Priority 3</option>
            </select>
            <button type="submit" className={styles.createCardButton} disabled={isCreatingCard}>
              {isCreatingCard ? "Recording..." : "Create card"}
            </button>
          </form>
        )}
        {customizeOpen && (
          <section className={styles.customizePanel} aria-label="Customize board">
            <h2>Customize</h2>
            <label htmlFor="team-name">Team or company</label>
            <input id="team-name" value={teamNameDraft} onChange={(event) => setTeamNameDraft(event.target.value)} maxLength={40} />
            <label className={styles.uploadLogoButton}>
              Choose logo
              <input type="file" accept="image/*" onChange={(event) => handleTeamLogo(event.target.files?.[0])} />
            </label>
            {teamLogoDraft && <button type="button" className={styles.removeLogoButton} onClick={() => setTeamLogoDraft("")}>Remove logo</button>}
            {customizeError && <p role="alert" className={styles.customizeError}>{customizeError}</p>}
            <button type="button" className={styles.createCardButton} onClick={handleSaveTeamProfile}>Save</button>
          </section>
        )}
        <div className={styles.sidebarFoot}>
          <span className={styles.localIndicator} />
          Local board
        </div>
      </aside>

      <main className={styles.workspace} id="board">
        <header className={styles.header}>
          <div className={styles.headingBlock}>
            <p className={styles.eyebrow}>Project board</p>
            <h1>Weekly Task Kanban</h1>
            <time className={styles.dateStamp} dateTime={clock ? localDateString(clock) : undefined}>
              {clock ? formatBoardDate(localDateString(clock)) : "-- --- --"}
            </time>
          </div>
          <div className={styles.clockBlock}>
            <div
              className={styles.clockFace}
              role="img"
              aria-label={clock ? `Local time ${clock.toLocaleTimeString()}` : "Local clock"}
            >
              {Array.from({ length: 12 }, (_, mark) => (
                <span key={mark} className={styles.watchTick} style={{ transform: `rotate(${mark * 30}deg)` }} />
              ))}
              <span className={styles.hourHand} style={{ transform: `rotate(${clock ? (clock.getHours() % 12) * 30 + clock.getMinutes() / 2 : 0}deg)` }} />
              <span className={styles.minuteHand} style={{ transform: `rotate(${clock ? clock.getMinutes() * 6 : 0}deg)` }} />
              <span className={styles.secondHand} style={{ transform: `rotate(${clock ? clock.getSeconds() * 6 : 0}deg)` }} />
              <span className={styles.clockPin} />
            </div>
            <span className={styles.clockReadout}>{clock ? clock.toLocaleTimeString() : "--:--:--"}</span>
          </div>
        </header>

        {boardMessage && <p className={styles.boardMessage} role="status">{boardMessage}</p>}
        {boardError && <p className={styles.boardError} role="alert">{boardError}</p>}

        <div className={styles.board}>
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
              {column.cards.map((card, cardIndex) => {
                const isEditing = editingCard?.cardId === card.id;
                const priorityClass = column.id === "done"
                  ? ""
                  : card.priority === 1
                    ? styles.priorityOneGlow
                    : card.priority === 2
                      ? styles.priorityGlow
                      : "";
                return (
                <article
                  key={card.id}
                  className={`${styles.card} ${priorityClass}`}
                  draggable={!isEditing && openCommentCardId !== card.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleDrop(column.id, cardIndex);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDraggedCard({ cardId: card.id, fromColumnId: column.id });
                  }}
                  onDragEnd={() => setDraggedCard(null)}
                >
                  <div className={styles.cardTopRow}>
                    <div className={styles.cardIdentity}>
                      {isEditing ? (
                        <input
                          className={styles.cardTitleInput}
                          aria-label={`Title for ${card.title}`}
                          value={editingCard.draft.title}
                          onChange={(event) => setEditingCard({ ...editingCard, draft: { ...editingCard.draft, title: event.target.value } })}
                        />
                      ) : (
                        <h3>{card.title}</h3>
                      )}
                      <span className={styles.cardReference}>{card.cardRef}</span>
                    </div>
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.editButton}
                        aria-label={`${isEditing ? "Cancel editing" : "Edit"} ${card.title}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => isEditing ? setEditingCard(null) : handleEditCard(column.id, card)}
                        disabled={savingCardId === card.id}
                      >
                        {isEditing ? "Cancel" : "Edit"}
                      </button>
                      {isEditing && (
                        <button
                          type="button"
                          className={styles.saveCardButton}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => void handleSaveCardEdit(column.title)}
                          disabled={savingCardId === card.id}
                        >
                          {savingCardId === card.id ? "Saving..." : "Save"}
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.deleteButton}
                        aria-label={`Delete ${card.title}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => void handleDelete(column.id, card.id)}
                        disabled={savingCardId === card.id}
                      >
                        ×
                      </button>
                    </div>
                    <button
                      type="button"
                      className={styles.commentsButton}
                      aria-expanded={openCommentCardId === card.id}
                      aria-label={`Updates for ${card.title}, ${(card.comments ?? []).length} comments`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => {
                        setOpenCommentCardId(openCommentCardId === card.id ? null : card.id);
                        setCommentDraft("");
                      }}
                    >
                      <span aria-hidden="true">◷</span> Updates{(card.comments ?? []).length > 0 ? ` · ${(card.comments ?? []).length}` : ""}
                    </button>
                  </div>
                  {isEditing ? (
                    <textarea
                      className={styles.cardDetailsInput}
                      aria-label={`Details for ${card.title}`}
                      value={editingCard.draft.details}
                      rows={3}
                      onChange={(event) => setEditingCard({ ...editingCard, draft: { ...editingCard.draft, details: event.target.value } })}
                    />
                  ) : (
                    <p>{card.details}</p>
                  )}
                  <div className={styles.cardMeta}>
                    {card.assignee && <span className={styles.assignee}>Owner: {card.assignee}</span>}
                    {card.priority && (
                      <span className={`${styles.priority} ${styles[`priority${card.priority}`]}`}>
                        P{card.priority}
                      </span>
                    )}
                    <span className={styles.createdDate}>
                      <span className={styles.createdLabel}>Created</span>
                      {formatCreatedDate(card.createdAt ?? localDateString())}
                    </span>
                    {card.dueDate && <span className={styles.dueDate}>Due on {formatDueDate(card.dueDate)}</span>}
                  </div>
                  {openCommentCardId === card.id && (
                    <div
                      className={styles.commentsPanel}
                      ref={commentsPanelRef}
                      onPointerDown={(event) => event.stopPropagation()}
                      role="region"
                      aria-label={`Updates for ${card.title}`}
                    >
                      <div className={styles.commentsList}>
                        {(card.comments ?? []).map((comment) => (
                          <article key={comment.id} className={styles.commentEntry}>
                            <p>{comment.text}</p>
                            <time>{formatCreatedDate(comment.createdAt)}</time>
                            <button
                              type="button"
                              aria-label={`Delete comment ${comment.id}`}
                              onClick={() => void handleDeleteComment(column.id, card, comment)}
                            >
                              Delete
                            </button>
                          </article>
                        ))}
                        {(card.comments ?? []).length === 0 && <p className={styles.emptyComments}>No updates yet</p>}
                      </div>
                      <form
                        className={styles.commentForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleAddComment(column.id, card);
                        }}
                      >
                        <textarea
                          aria-label={`Add comment to ${card.title}`}
                          placeholder="Add an update..."
                          value={commentDraft}
                          rows={2}
                          onChange={(event) => setCommentDraft(event.target.value)}
                          required
                        />
                        <button type="submit" disabled={!commentDraft.trim()}>Comment</button>
                      </form>
                    </div>
                  )}
                  {isEditing && <div className={styles.cardEditFields}>
                    <input
                      aria-label={`Assignee for ${card.title}`}
                      placeholder="Assigned to"
                      value={editingCard.draft.assignee ?? ""}
                      onChange={(event) => setEditingCard({ ...editingCard, draft: { ...editingCard.draft, assignee: event.target.value } })}
                    />
                    <input
                      aria-label={`Due on for ${card.title}`}
                      type="datetime-local"
                      value={editingCard.draft.dueDate ?? ""}
                      onChange={(event) => setEditingCard({ ...editingCard, draft: { ...editingCard.draft, dueDate: event.target.value } })}
                    />
                    <select
                      aria-label={`Priority for ${card.title}`}
                      value={editingCard.draft.priority ?? ""}
                      onChange={(event) => setEditingCard({ ...editingCard, draft: { ...editingCard.draft, priority: event.target.value === "" ? null : Number(event.target.value) as Card["priority"] } })}
                    >
                      <option value="">No priority</option>
                      <option value={1}>Priority 1</option>
                      <option value={2}>Priority 2</option>
                      <option value={3}>Priority 3</option>
                    </select>
                  </div>}
                </article>
                );
              })}
            </div>

          </section>
        ))}
        </div>
      </main>
    </div>
  );
}
