"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronLeft, ChevronRight, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import styles from "./page.module.css";
import {
  addCardToColumn,
  createEmptyBoard,
  createCardReference,
  createInitialBoard,
  deleteColumn,
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

function renderLinkedText(text: string) {
  const parts: React.ReactNode[] = [];
  const urlPattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  let lastIndex = 0;

  for (const match of text.matchAll(urlPattern)) {
    const matchedUrl = match[0];
    const url = matchedUrl.replace(/[.,!?;:)\]}]+$/, "");
    const trailingText = matchedUrl.slice(url.length);
    const startIndex = match.index ?? 0;
    parts.push(text.slice(lastIndex, startIndex));
    parts.push(
      <a
        key={`link-${startIndex}`}
        href={/^https?:\/\//i.test(url) ? url : `https://${url}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {url}
      </a>,
    );
    parts.push(trailingText);
    lastIndex = startIndex + matchedUrl.length;
  }

  parts.push(text.slice(lastIndex));
  return parts;
}

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
const boardsStorageKey = "kanban-boards";
const activeBoardStorageKey = "kanban-active-board";
const teamProfileStorageKey = "kanban-team-profile";
type SavedBoard = { id: string; name: string; board: Board };
type TeamProfile = { name: string; logo: string; boardName: string; nameBold: boolean; nameSize: "board" | "small" | "large"; nameColor: string };
const defaultTeamProfile: TeamProfile = {
  name: "Weekly Team",
  logo: "",
  boardName: "Weekly Task Kanban",
  nameBold: true,
  nameSize: "board",
  nameColor: "",
};
const initialBoard = createInitialBoard();
const defaultBoardId = "team-board";
const defaultSavedBoards: SavedBoard[] = [{ id: defaultBoardId, name: defaultTeamProfile.boardName, board: initialBoard }];
let cachedSavedBoards = defaultSavedBoards;
let cachedSavedBoardsValue: string | null | undefined;
let cachedTeamProfile = defaultTeamProfile;
let cachedTeamProfileValue: string | null | undefined;
const teamProfileSubscribers = new Set<() => void>();
const boardSubscribers = new Set<() => void>();
const clockSubscribers = new Set<() => void>();
let clockSnapshot: Date | null = null;
let clockTimer: ReturnType<typeof setInterval> | undefined;

function getSavedBoardsSnapshot(): SavedBoard[] {
  if (typeof window === "undefined") {
    return defaultSavedBoards;
  }

  const serializedBoards = window.localStorage.getItem(boardsStorageKey);
  if (serializedBoards !== cachedSavedBoardsValue) {
    cachedSavedBoardsValue = serializedBoards;
    if (serializedBoards) {
      try {
        const parsed: unknown = JSON.parse(serializedBoards);
        cachedSavedBoards = Array.isArray(parsed)
          ? parsed.flatMap((item): SavedBoard[] => {
            if (typeof item !== "object" || item === null ||
              !("id" in item) || typeof item.id !== "string" ||
              !("name" in item) || typeof item.name !== "string" ||
              !("board" in item)) return [];
            const board = parseBoard(JSON.stringify(item.board));
            return board ? [{ id: item.id, name: item.name, board }] : [];
          })
          : [];
      } catch {
        cachedSavedBoards = [];
      }
    } else {
      let legacyName = defaultTeamProfile.boardName;
      try {
        const profile = JSON.parse(window.localStorage.getItem(teamProfileStorageKey) ?? "{}") as Partial<TeamProfile>;
        if (typeof profile.boardName === "string" && profile.boardName.trim()) legacyName = profile.boardName.trim();
      } catch {
        legacyName = defaultTeamProfile.boardName;
      }
      cachedSavedBoards = [{
        id: defaultBoardId,
        name: legacyName,
        board: parseBoard(window.localStorage.getItem(boardStorageKey)) ?? initialBoard,
      }];
      const migrated = JSON.stringify(cachedSavedBoards);
      window.localStorage.setItem(boardsStorageKey, migrated);
      cachedSavedBoardsValue = migrated;
    }
    if (cachedSavedBoards.length === 0) cachedSavedBoards = defaultSavedBoards;
  }

  return cachedSavedBoards;
}

function getActiveBoardIdSnapshot(): string {
  if (typeof window === "undefined") return defaultBoardId;
  const savedBoards = getSavedBoardsSnapshot();
  const activeId = window.localStorage.getItem(activeBoardStorageKey);
  if (activeId && savedBoards.some((item) => item.id === activeId)) return activeId;
  const fallbackId = savedBoards[0].id;
  window.localStorage.setItem(activeBoardStorageKey, fallbackId);
  return fallbackId;
}

function getBoardSnapshot(): Board {
  const activeBoardId = getActiveBoardIdSnapshot();
  return getSavedBoardsSnapshot().find((item) => item.id === activeBoardId)?.board ?? initialBoard;
}

function saveBoardCollection(savedBoards: SavedBoard[], activeBoardId: string) {
  const serializedBoards = JSON.stringify(savedBoards);
  window.localStorage.setItem(boardsStorageKey, serializedBoards);
  window.localStorage.setItem(activeBoardStorageKey, activeBoardId);
  cachedSavedBoards = savedBoards;
  cachedSavedBoardsValue = serializedBoards;
  boardSubscribers.forEach((subscriber) => subscriber());
}

function subscribeToBoard(subscriber: () => void) {
  boardSubscribers.add(subscriber);
  const handleStorage = () => {
    cachedSavedBoardsValue = undefined;
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

function subscribeToTimeZone(subscriber: () => void) {
  const timer = window.setTimeout(subscriber, 0);
  return () => window.clearTimeout(timer);
}

function getTimeZoneSnapshot() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
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
        name: typeof parsed.name === "string" ? parsed.name.trim() : defaultTeamProfile.name,
        logo: typeof parsed.logo === "string" ? parsed.logo : "",
        boardName: typeof parsed.boardName === "string" && parsed.boardName.trim()
          ? parsed.boardName.trim()
          : defaultTeamProfile.boardName,
        nameBold: typeof parsed.nameBold === "boolean" ? parsed.nameBold : defaultTeamProfile.nameBold,
        nameSize: parsed.nameSize === "small" || parsed.nameSize === "large"
          ? parsed.nameSize
          : defaultTeamProfile.nameSize,
        nameColor: typeof parsed.nameColor === "string" && /^#[\da-f]{6}$/i.test(parsed.nameColor)
          ? parsed.nameColor
          : defaultTeamProfile.nameColor,
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
  const activeBoardId = getActiveBoardIdSnapshot();
  const savedBoards = getSavedBoardsSnapshot().map((item) => item.id === activeBoardId
    ? { ...item, board: nextBoard }
    : item);
  saveBoardCollection(savedBoards, activeBoardId);
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
  const savedBoards = useSyncExternalStore(subscribeToBoard, getSavedBoardsSnapshot, () => defaultSavedBoards);
  const activeBoardId = useSyncExternalStore(subscribeToBoard, getActiveBoardIdSnapshot, () => defaultBoardId);
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
  const timeZone = useSyncExternalStore(subscribeToTimeZone, getTimeZoneSnapshot, () => null);
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
  const [expandedCard, setExpandedCard] = useState<{
    cardId: string;
    columnId: ColumnId;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [openCommentCardId, setOpenCommentCardId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const commentsPanelRef = useRef<HTMLDivElement>(null);
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [teamNameDraft, setTeamNameDraft] = useState("Weekly Team");
  const [teamLogoDraft, setTeamLogoDraft] = useState("");
  const [teamNameBoldDraft, setTeamNameBoldDraft] = useState(true);
  const [teamNameSizeDraft, setTeamNameSizeDraft] = useState<TeamProfile["nameSize"]>("board");
  const [teamNameColorDraft, setTeamNameColorDraft] = useState("");
  const [boardNameDraft, setBoardNameDraft] = useState("Weekly Task Kanban");
  const [customizeError, setCustomizeError] = useState("");
  const teamName = teamProfile.name;
  const teamLogo = teamProfile.logo;
  const boardName = savedBoards.find((item) => item.id === activeBoardId)?.name ?? teamProfile.boardName;

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
    const destination = board.columns.find((column) => column.id === "todo") ?? board.columns[0];

    if (!title || !destination) {
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
        columnAfter: destination.title,
        changedFields: ["title", "details", "owner", "due on", "priority"],
      });
      updateBoard((current) => addCardToColumn(current, destination.id, newCard));
      setDraft({ ...emptyDraft });
      setIsAddingCard(false);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : "Could not record the new card.");
    } finally {
      setIsCreatingCard(false);
    }
  };

  const handleSaveTeamProfile = () => {
    const profile = {
      name: teamNameDraft.trim(),
      logo: teamLogoDraft,
      boardName: boardNameDraft.trim() || "Weekly Task Kanban",
      nameBold: teamNameBoldDraft,
      nameSize: teamNameSizeDraft,
      nameColor: teamNameColorDraft,
    };
    try {
      const activeId = getActiveBoardIdSnapshot();
      saveBoardCollection(getSavedBoardsSnapshot().map((item) => item.id === activeId
        ? { ...item, name: profile.boardName }
        : item), activeId);
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

  const handleDeleteColumn = (columnId: ColumnId) => {
    const column = board.columns.find((item) => item.id === columnId);
    if (!column || board.columns.length <= 1) return;
    const destination = board.columns.find((item) => item.id === "backlog" && item.id !== columnId)
      ?? board.columns.find((item) => item.id !== columnId);
    if (!destination) return;
    const cardMessage = column.cards.length > 0
      ? ` Its ${column.cards.length} cards will move to ${destination.title}.`
      : "";
    if (!window.confirm(`Delete the ${column.title} category?${cardMessage}`)) return;
    updateBoard((current) => deleteColumn(current, columnId));
  };

  const handleAddBoard = () => {
    const id = `board-${crypto.randomUUID()}`;
    const name = `Board ${savedBoards.length + 1}`;
    saveBoardCollection([...savedBoards, { id, name, board: createEmptyBoard() }], id);
    setBoardNameDraft(name);
    setExpandedCard(null);
    setEditingCard(null);
    setOpenCommentCardId(null);
  };

  const handleSwitchBoard = (direction: -1 | 1) => {
    if (savedBoards.length < 2) return;
    const currentIndex = savedBoards.findIndex((item) => item.id === activeBoardId);
    const nextIndex = (currentIndex + direction + savedBoards.length) % savedBoards.length;
    const nextBoard = savedBoards[nextIndex];
    saveBoardCollection(savedBoards, nextBoard.id);
    setBoardNameDraft(nextBoard.name);
    setExpandedCard(null);
    setEditingCard(null);
    setOpenCommentCardId(null);
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
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}>
        <button
          type="button"
          className={styles.sidebarCollapseButton}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        {teamLogo && (
          <span
            className={styles.companyLogo}
            style={{ backgroundImage: `url(${teamLogo})` }}
            role="img"
            aria-label={`${teamName} company picture`}
          />
        )}
        <section className={styles.boardSwitcher} aria-label="Boards">
          <h2>Boards</h2>
          <div className={styles.boardSwitchControls}>
            <button type="button" aria-label="Previous board" title="Previous board" onClick={() => handleSwitchBoard(-1)} disabled={savedBoards.length < 2}>
              <ChevronLeft size={17} />
            </button>
            <span title={boardName}>{boardName}</span>
            <button type="button" aria-label="Next board" title="Next board" onClick={() => handleSwitchBoard(1)} disabled={savedBoards.length < 2}>
              <ChevronRight size={17} />
            </button>
            <button type="button" aria-label="Add board" title="Add board" onClick={handleAddBoard}>
              <Plus size={16} />
            </button>
          </div>
        </section>
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
              setTeamNameBoldDraft(teamProfile.nameBold);
              setTeamNameSizeDraft(teamProfile.nameSize);
              setTeamNameColorDraft(teamProfile.nameColor);
              setBoardNameDraft(boardName);
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
            <input value={draft.assignee} onChange={(event) => updateDraft("assignee", event.target.value)} placeholder="Owners, comma separated (optional)" aria-label="New card owners, comma separated" />
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
            <label htmlFor="team-name">Team label</label>
            <input id="team-name" value={teamNameDraft} onChange={(event) => setTeamNameDraft(event.target.value)} maxLength={40} />
            <label className={styles.companyNameOption}>
              <input
                type="checkbox"
                aria-label="Bold company name"
                checked={teamNameBoldDraft}
                onChange={(event) => setTeamNameBoldDraft(event.target.checked)}
              />
              Bold company name
            </label>
            <label htmlFor="company-name-size">Company name size</label>
            <select
              id="company-name-size"
              value={teamNameSizeDraft}
              onChange={(event) => setTeamNameSizeDraft(event.target.value as TeamProfile["nameSize"])}
            >
              <option value="board">Like board name</option>
              <option value="small">Small</option>
              <option value="large">Large</option>
            </select>
            <label htmlFor="company-name-color">Company name color</label>
            <input
              id="company-name-color"
              type="color"
              value={teamNameColorDraft || "#209dd7"}
              onChange={(event) => setTeamNameColorDraft(event.target.value)}
            />
            {teamNameColorDraft && (
              <button type="button" className={styles.removeLogoButton} onClick={() => setTeamNameColorDraft("")}>
                Use board colors
              </button>
            )}
            <label htmlFor="board-name">Board name</label>
            <input id="board-name" value={boardNameDraft} onChange={(event) => setBoardNameDraft(event.target.value)} maxLength={60} />
            <label className={styles.uploadLogoButton}>
              Choose logo
              <input type="file" accept="image/*" onChange={(event) => handleTeamLogo(event.target.files?.[0])} />
            </label>
            {teamLogoDraft && <button type="button" className={styles.removeLogoButton} onClick={() => setTeamLogoDraft("")}>Remove logo</button>}
            <h3 className={styles.categoryManagementTitle}>Categories</h3>
            <div className={styles.categoryManagement}>
              {board.columns.map((column) => (
                <div key={column.id} className={styles.categoryManagementRow}>
                  <input
                    aria-label={`Rename ${column.title} category`}
                    value={column.title}
                    onChange={(event) => handleRename(column.id, event.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={`Delete ${column.title} category`}
                    title="Delete category"
                    onClick={() => handleDeleteColumn(column.id)}
                    disabled={board.columns.length <= 1}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
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
          <div className={styles.projectEyebrow}>
            <span
              className={styles.companyNameLabel}
              data-size={teamProfile.nameSize}
              style={{
                fontWeight: teamProfile.nameBold ? 700 : 500,
                ...(teamProfile.nameColor ? {
                  color: teamProfile.nameColor,
                  backgroundImage: "none",
                  WebkitTextFillColor: teamProfile.nameColor,
                } : {}),
              }}
            >
              {teamName}
            </span>
          </div>
          <div className={styles.headingBlock}>
            <p className={styles.eyebrow}>Project board</p>
            <h1>{boardName}</h1>
            <time className={styles.dateStamp} dateTime={clock ? localDateString(clock) : undefined}>
              {clock
                ? `${clock.toLocaleDateString(undefined, { weekday: "long" })}, ${formatBoardDate(localDateString(clock))}`
                : "---, -- --- --"}
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
              <span className={`${styles.clockNumeral} ${styles.clockNumeralTop}`}>12</span>
              <span className={`${styles.clockNumeral} ${styles.clockNumeralRight}`}>3</span>
              <span className={`${styles.clockNumeral} ${styles.clockNumeralBottom}`}>6</span>
              <span className={`${styles.clockNumeral} ${styles.clockNumeralLeft}`}>9</span>
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
              {column.cards
                .filter((card) => !expandedCard || expandedCard.columnId !== column.id || expandedCard.cardId === card.id)
                .map((card) => {
                const cardIndex = column.cards.findIndex((item) => item.id === card.id);
                const isEditing = editingCard?.cardId === card.id;
                const owners = (card.assignee ?? "").split(",").map((owner) => owner.trim()).filter(Boolean);
                const isExpanded = expandedCard?.cardId === card.id;
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
                  className={`${styles.card} ${priorityClass} ${isExpanded ? styles.cardExpanded : ""}`}
                  style={isExpanded ? {
                    left: expandedCard.left,
                    top: expandedCard.top,
                    width: expandedCard.width,
                    height: expandedCard.height,
                  } : undefined}
                  draggable={!isEditing && openCommentCardId !== card.id}
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select")) return;
                    if (isExpanded) {
                      setExpandedCard(null);
                      return;
                    }
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const width = Math.min(bounds.width * 1.9, window.innerWidth - 32);
                    setExpandedCard({
                      cardId: card.id,
                      columnId: column.id,
                      width,
                      height: Math.min(bounds.height * 1.9, window.innerHeight - 32),
                      left: Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16)),
                      top: Math.max(16, Math.min(bounds.top - (Math.min(bounds.height * 1.9, window.innerHeight - 32) - bounds.height) / 2, window.innerHeight - Math.min(bounds.height * 1.9, window.innerHeight - 32) - 16)),
                    });
                  }}
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
                    </div>
                    <div className={styles.cardSubRow}>
                      <span className={styles.cardReference}>{card.cardRef}</span>
                      <div className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.editButton}
                          aria-label={`${isEditing ? "Cancel editing" : "Edit"} ${card.title}`}
                          title={isEditing ? "Cancel editing" : "Edit card"}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => isEditing ? setEditingCard(null) : handleEditCard(column.id, card)}
                          disabled={savingCardId === card.id}
                        >
                          {isEditing ? <X size={15} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
                        </button>
                        {isEditing && (
                          <button
                            type="button"
                            className={styles.saveCardButton}
                            aria-label={`Save ${card.title}`}
                            title="Save changes"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => void handleSaveCardEdit(column.title)}
                            disabled={savingCardId === card.id}
                          >
                            <Check size={15} aria-hidden="true" />
                          </button>
                        )}
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
                        <MessageSquare size={15} aria-hidden="true" />
                        {Boolean((card.comments ?? []).length) && <span className={styles.updateCount}>{(card.comments ?? []).length}</span>}
                      </button>
                      <button
                        type="button"
                        className={styles.deleteButton}
                        aria-label={`Delete ${card.title}`}
                        title="Delete card"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this card?")) {
                            void handleDelete(column.id, card.id);
                          }
                        }}
                        disabled={savingCardId === card.id}
                      >
                        ×
                      </button>
                    </div>
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
                    <p>{renderLinkedText(card.details)}</p>
                  )}
                  <div className={styles.cardOwnerRow}>
                    <span className={styles.ownerLabel}>Owners</span>
                    <div className={styles.ownerList}>
                      {owners.length > 0
                        ? owners.map((owner) => <span key={owner} className={styles.assignee}>{owner}</span>)
                        : <span className={styles.assignee}>Unassigned</span>}
                    </div>
                  </div>
                  <div className={styles.cardMeta}>
                    {card.priority && (
                      <span className={`${styles.priority} ${styles[`priority${card.priority}`]}`}>
                        P{card.priority}
                      </span>
                    )}
                    <span className={styles.createdDate}>
                      <span className={styles.createdLabel}>Created</span>
                      {timeZone ? formatCreatedDate(card.createdAt ?? localDateString(), timeZone) : "--"}
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
                            <p>{renderLinkedText(comment.text)}</p>
                            <time>{timeZone ? formatCreatedDate(comment.createdAt, timeZone) : "--"}</time>
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
                      aria-label={`Owners for ${card.title}, comma separated`}
                      placeholder="Owners, comma separated"
                      value={editingCard.draft.assignee ?? ""}
                      onChange={(event) => setEditingCard({ ...editingCard, draft: { ...editingCard.draft, assignee: event.target.value } })}
                    />
                    <label>
                      Due date
                      <input
                        aria-label={`Due on for ${card.title}`}
                        type="datetime-local"
                        value={editingCard.draft.dueDate ?? ""}
                        onChange={(event) => setEditingCard({ ...editingCard, draft: { ...editingCard.draft, dueDate: event.target.value } })}
                      />
                    </label>
                    <label>
                      Priority
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
                    </label>
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
