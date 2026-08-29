import { createBingoStore } from "./firebase-store.js";

const core = globalThis.GuildBingoCore;
const firebaseConfig = globalThis.GuildEventsFirebaseConfig;

if (!core) throw new Error("빙고 규칙 모듈을 불러오지 못했습니다.");

const elements = {
  landingView: document.getElementById("landingView"),
  roomView: document.getElementById("roomView"),
  createRoomForm: document.getElementById("createRoomForm"),
  roomTitleInput: document.getElementById("roomTitleInput"),
  joinRoomForm: document.getElementById("joinRoomForm"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  connectionState: document.getElementById("connectionState"),
  loadingCover: document.getElementById("loadingCover"),
  loadingMessage: document.getElementById("loadingMessage"),
  roomStatusEyebrow: document.getElementById("roomStatusEyebrow"),
  roomTitle: document.getElementById("roomTitle"),
  roomCodeLabel: document.getElementById("roomCodeLabel"),
  shareRoomButton: document.getElementById("shareRoomButton"),
  leaveRoomButton: document.getElementById("leaveRoomButton"),
  winnerBanner: document.getElementById("winnerBanner"),
  winnerNames: document.getElementById("winnerNames"),
  winnerSummary: document.getElementById("winnerSummary"),
  myBoardTitle: document.getElementById("myBoardTitle"),
  myBoardBadge: document.getElementById("myBoardBadge"),
  playerForm: document.getElementById("playerForm"),
  nicknameInput: document.getElementById("nicknameInput"),
  boardInputGrid: document.getElementById("boardInputGrid"),
  boardValidationLabel: document.getElementById("boardValidationLabel"),
  randomBoardButton: document.getElementById("randomBoardButton"),
  clearBoardButton: document.getElementById("clearBoardButton"),
  submittedBoard: document.getElementById("submittedBoard"),
  myNickname: document.getElementById("myNickname"),
  myProgress: document.getElementById("myProgress"),
  myBoardGrid: document.getElementById("myBoardGrid"),
  editBoardButton: document.getElementById("editBoardButton"),
  spectatorMessage: document.getElementById("spectatorMessage"),
  hostPanel: document.getElementById("hostPanel"),
  hostLobbyControls: document.getElementById("hostLobbyControls"),
  startGameButton: document.getElementById("startGameButton"),
  hostPlayControls: document.getElementById("hostPlayControls"),
  randomDrawButton: document.getElementById("randomDrawButton"),
  randomDrawLabel: document.getElementById("randomDrawLabel"),
  remainingNumberCount: document.getElementById("remainingNumberCount"),
  callNumberForm: document.getElementById("callNumberForm"),
  calledNumberInput: document.getElementById("calledNumberInput"),
  manualCallButton: document.getElementById("manualCallButton"),
  undoNumberButton: document.getElementById("undoNumberButton"),
  finishGameButton: document.getElementById("finishGameButton"),
  hostFinishedControls: document.getElementById("hostFinishedControls"),
  undoFinishedButton: document.getElementById("undoFinishedButton"),
  resetGameButton: document.getElementById("resetGameButton"),
  drawStageLabel: document.getElementById("drawStageLabel"),
  drawStageTitle: document.getElementById("drawStageTitle"),
  drawStageDescription: document.getElementById("drawStageDescription"),
  drawMachine: document.getElementById("drawMachine"),
  currentBall: document.getElementById("currentBall"),
  calledCount: document.getElementById("calledCount"),
  calledNumberBoard: document.getElementById("calledNumberBoard"),
  callHistory: document.getElementById("callHistory"),
  playerCount: document.getElementById("playerCount"),
  targetLineLabel: document.getElementById("targetLineLabel"),
  emptyPlayers: document.getElementById("emptyPlayers"),
  playerGrid: document.getElementById("playerGrid"),
  toast: document.getElementById("toast"),
  confirmDialog: document.getElementById("confirmDialog"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmMessage: document.getElementById("confirmMessage"),
  confirmActionButton: document.getElementById("confirmActionButton"),
};

const state = {
  store: null,
  roomId: "",
  room: null,
  players: [],
  roomMeta: null,
  playersMeta: null,
  roomLoaded: false,
  playersLoaded: false,
  editingBoard: false,
  unsubscribeRoom: null,
  unsubscribePlayers: null,
  toastTimer: 0,
  lastRenderedNumber: null,
  autoFinishKey: "",
  randomDrawing: false,
  randomDrawToken: 0,
};

const boardInputs = [];
const calledNumberCells = [];

function createBoardInputs() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < core.BOARD_SIZE; index += 1) {
    const input = document.createElement("input");
    input.className = "board-input";
    input.type = "number";
    input.inputMode = "numeric";
    input.min = String(core.MIN_NUMBER);
    input.max = String(core.MAX_NUMBER);
    input.autocomplete = "off";
    input.setAttribute("aria-label", `${index + 1}번째 빙고 칸`);
    input.dataset.index = String(index);
    input.addEventListener("input", () => validateBoardInputs());
    input.addEventListener("keydown", handleBoardKeydown);
    input.addEventListener("paste", handleBoardPaste);
    boardInputs.push(input);
    fragment.appendChild(input);
  }
  elements.boardInputGrid.replaceChildren(fragment);
}

function createCalledNumberBoard() {
  const fragment = document.createDocumentFragment();
  for (let number = core.MIN_NUMBER; number <= core.MAX_NUMBER; number += 1) {
    const cell = document.createElement("span");
    cell.className = "called-number";
    cell.textContent = String(number);
    cell.dataset.number = String(number);
    calledNumberCells.push(cell);
    fragment.appendChild(cell);
  }
  elements.calledNumberBoard.replaceChildren(fragment);
}

function handleBoardKeydown(event) {
  const index = Number(event.currentTarget.dataset.index);
  if (event.key === "ArrowRight" && index < boardInputs.length - 1) {
    event.preventDefault();
    boardInputs[index + 1].focus();
  } else if (event.key === "ArrowLeft" && index > 0) {
    event.preventDefault();
    boardInputs[index - 1].focus();
  } else if (event.key === "ArrowDown" && index < boardInputs.length - 5) {
    event.preventDefault();
    boardInputs[index + 5].focus();
  } else if (event.key === "ArrowUp" && index >= 5) {
    event.preventDefault();
    boardInputs[index - 5].focus();
  }
}

function handleBoardPaste(event) {
  const text = event.clipboardData?.getData("text") || "";
  if (!/[\s,;/|]/.test(text.trim())) return;
  try {
    const board = core.parseBoardText(text);
    event.preventDefault();
    fillBoardInputs(board);
    showToast("숫자 25개를 빙고판에 채웠습니다.", "success");
  } catch (error) {
    event.preventDefault();
    showToast(describeError(error), "error");
  }
}

function fillBoardInputs(board) {
  boardInputs.forEach((input, index) => {
    input.value = board?.[index] ?? "";
  });
  validateBoardInputs();
}

function boardInputValues() {
  return boardInputs.map((input) => input.value.trim());
}

function validateBoardInputs() {
  const values = boardInputValues();
  const counts = new Map();
  values.forEach((value) => {
    if (!value) return;
    const number = Number(value);
    counts.set(number, (counts.get(number) || 0) + 1);
  });

  let invalidCount = 0;
  let filledCount = 0;
  boardInputs.forEach((input) => {
    const value = input.value.trim();
    const number = Number(value);
    const invalid = Boolean(value) && (
      !Number.isInteger(number) ||
      number < core.MIN_NUMBER ||
      number > core.MAX_NUMBER ||
      counts.get(number) > 1
    );
    input.classList.toggle("invalid", invalid);
    input.setAttribute("aria-invalid", String(invalid));
    if (value) filledCount += 1;
    if (invalid) invalidCount += 1;
  });

  elements.boardValidationLabel.classList.toggle("error", invalidCount > 0);
  if (invalidCount > 0) elements.boardValidationLabel.textContent = "범위 밖 또는 중복 숫자 확인";
  else if (filledCount === core.BOARD_SIZE) elements.boardValidationLabel.textContent = "제출할 수 있어요!";
  else elements.boardValidationLabel.textContent = `${filledCount} / ${core.BOARD_SIZE}칸 입력`;
  return invalidCount === 0 && filledCount === core.BOARD_SIZE;
}

function setLoading(visible, message = "게임 서버에 연결하는 중…") {
  elements.loadingMessage.textContent = message;
  elements.loadingCover.classList.toggle("done", !visible);
}

function setConnection(stateName, label) {
  elements.connectionState.dataset.state = stateName;
  elements.connectionState.querySelector("span").textContent = label;
}

function refreshConnectionState() {
  if (!navigator.onLine) {
    setConnection("error", "인터넷 연결 끊김");
    return;
  }
  const metadata = [state.roomMeta, state.playersMeta].filter(Boolean);
  if (metadata.some((value) => value.hasPendingWrites)) {
    setConnection("syncing", "변경사항 전송 중");
  } else if (metadata.some((value) => value.fromCache)) {
    setConnection("syncing", "서버 다시 연결 중");
  } else {
    setConnection("online", "실시간 연결됨");
  }
}

function showToast(message, type = "") {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast${type ? ` ${type}` : ""}`;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3600);
}

function describeError(error) {
  const code = String(error?.code || "");
  if (code.includes("auth/operation-not-allowed")) return "익명 참가 기능이 아직 활성화되지 않았습니다.";
  if (code.includes("permission-denied")) return "이 작업을 할 권한이 없거나 게임 상태가 이미 바뀌었습니다.";
  if (code.includes("unavailable")) return "게임 서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.";
  if (code.includes("not-found") || code.includes("room/not-found")) return "해당 빙고 방을 찾지 못했습니다.";
  if (code.includes("failed-precondition")) return "게임 데이터 준비가 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.";
  return error?.message || "요청을 처리하지 못했습니다.";
}

function confirmAction({ title, message, actionLabel = "계속하기" }) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmActionButton.textContent = actionLabel;
  elements.confirmDialog.showModal();
  return new Promise((resolve) => {
    elements.confirmDialog.addEventListener("close", () => {
      resolve(elements.confirmDialog.returnValue === "confirm");
    }, { once: true });
  });
}

async function withBusy(button, task) {
  if (button.disabled) return undefined;
  button.disabled = true;
  try {
    return await task();
  } catch (error) {
    showToast(describeError(error), "error");
    return undefined;
  } finally {
    button.disabled = false;
    if (state.room) renderRoom();
  }
}

function updateRoomUrl(roomId = "") {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (roomId) url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url);
}

function unsubscribeRoom() {
  state.unsubscribeRoom?.();
  state.unsubscribePlayers?.();
  state.unsubscribeRoom = null;
  state.unsubscribePlayers = null;
}

function showLanding({ clearUrl = true } = {}) {
  unsubscribeRoom();
  state.roomId = "";
  state.room = null;
  state.players = [];
  state.roomMeta = null;
  state.playersMeta = null;
  state.roomLoaded = false;
  state.playersLoaded = false;
  state.editingBoard = false;
  state.autoFinishKey = "";
  state.lastRenderedNumber = null;
  state.randomDrawing = false;
  state.randomDrawToken += 1;
  elements.landingView.hidden = false;
  elements.roomView.hidden = true;
  document.title = "다 같이 빙고 | 길드 오락실";
  if (clearUrl) updateRoomUrl();
  refreshConnectionState();
}

function enterRoom(roomId) {
  const normalizedId = core.normalizeRoomId(roomId);
  unsubscribeRoom();
  state.roomId = normalizedId;
  state.room = null;
  state.players = [];
  state.roomMeta = null;
  state.playersMeta = null;
  state.roomLoaded = false;
  state.playersLoaded = false;
  state.editingBoard = false;
  state.autoFinishKey = "";
  state.lastRenderedNumber = null;
  state.randomDrawing = false;
  state.randomDrawToken += 1;
  elements.landingView.hidden = true;
  elements.roomView.hidden = false;
  elements.roomCodeLabel.textContent = normalizedId;
  updateRoomUrl(normalizedId);
  setLoading(true, "빙고 방에 들어가는 중…");

  state.unsubscribeRoom = state.store.subscribeRoom(
    normalizedId,
    (snapshot) => {
      state.roomLoaded = true;
      if (!snapshot) {
        setLoading(false);
        showToast("해당 빙고 방을 찾지 못했습니다.", "error");
        showLanding();
        return;
      }
      state.room = snapshot.room;
      state.roomMeta = snapshot;
      renderRoom();
      finishRoomLoadingIfReady();
    },
    handleSubscriptionError,
  );

  state.unsubscribePlayers = state.store.subscribePlayers(
    normalizedId,
    (snapshot) => {
      state.playersLoaded = true;
      state.players = snapshot.players;
      state.playersMeta = snapshot;
      renderRoom();
      finishRoomLoadingIfReady();
    },
    handleSubscriptionError,
  );
}

function finishRoomLoadingIfReady() {
  if (state.roomLoaded && state.playersLoaded && state.room) {
    setLoading(false);
    refreshConnectionState();
  }
}

function handleSubscriptionError(error) {
  setLoading(false);
  setConnection("error", "연결 확인 필요");
  showToast(describeError(error), "error");
}

function currentPlayer() {
  const uid = state.store?.user?.uid;
  return state.players.find((player) => player.uid === uid) || null;
}

function isHost() {
  return Boolean(state.room && state.store?.user?.uid === state.room.ownerUid);
}

function createDisplayBoard(board, calledNumbers, label = "빙고판") {
  const container = document.createElement("div");
  container.className = "board display-board";
  container.setAttribute("aria-label", label);
  const progress = core.boardProgress(board, calledNumbers);
  const completedCells = core.completedCellIndexes(progress);
  board.forEach((number, index) => {
    const cell = document.createElement("span");
    cell.className = "board-cell";
    cell.classList.toggle("marked", progress.markedCells[index]);
    cell.classList.toggle("line-hit", completedCells.has(index));
    const text = document.createElement("span");
    text.textContent = String(number);
    cell.appendChild(text);
    container.appendChild(cell);
  });
  return { container, progress };
}

function renderMyBoard(player) {
  const roomOpen = state.room.status === "lobby";
  const editing = roomOpen && (!player || state.editingBoard);
  elements.playerForm.hidden = !editing;
  elements.submittedBoard.hidden = !player || editing;
  elements.spectatorMessage.hidden = Boolean(player) || roomOpen;

  if (!player && !roomOpen) {
    elements.myBoardTitle.textContent = "관전 화면";
    elements.myBoardBadge.textContent = "관전 중";
    elements.myBoardBadge.classList.remove("ready");
    return;
  }

  elements.myBoardTitle.textContent = "내 빙고판";
  elements.myBoardBadge.textContent = player ? "제출 완료" : "미제출";
  elements.myBoardBadge.classList.toggle("ready", Boolean(player));

  if (player && !editing) {
    const { container, progress } = createDisplayBoard(player.board, state.room.calledNumbers, "내 빙고판");
    elements.myBoardGrid.replaceChildren(...container.childNodes);
    elements.myNickname.textContent = player.nickname;
    elements.myProgress.textContent = `${progress.completedCount} / ${state.room.targetLines} 빙고`;
    elements.editBoardButton.hidden = !roomOpen;
  }
}

function renderHostControls() {
  const host = isHost();
  elements.hostPanel.hidden = !host;
  if (!host) return;
  const status = state.room.status;
  elements.hostLobbyControls.hidden = status !== "lobby";
  elements.hostPlayControls.hidden = status !== "playing";
  elements.hostFinishedControls.hidden = status !== "finished";
  elements.startGameButton.disabled = state.players.length === 0;
  elements.startGameButton.textContent = state.players.length === 0
    ? "참가자를 기다리는 중"
    : `${state.players.length}명과 게임 시작하기`;
  const remainingCount = core.MAX_NUMBER - state.room.calledNumbers.length;
  elements.remainingNumberCount.textContent = String(remainingCount);
  elements.randomDrawButton.classList.toggle("is-drawing", state.randomDrawing);
  elements.randomDrawLabel.textContent = state.randomDrawing
    ? "보골보골 섞는 중…"
    : remainingCount === 0
      ? "모든 숫자를 뽑았어요"
      : "항아리에서 하나 뽑기";
  elements.randomDrawButton.disabled = state.randomDrawing || remainingCount === 0;
  elements.calledNumberInput.disabled = state.randomDrawing;
  elements.manualCallButton.disabled = state.randomDrawing;
  elements.undoNumberButton.disabled = state.randomDrawing || state.room.calledNumbers.length === 0;
  elements.finishGameButton.disabled = state.randomDrawing;
  elements.undoFinishedButton.disabled = state.room.calledNumbers.length === 0;
}

function renderDrawStage(winners) {
  const called = state.room.calledNumbers;
  const lastNumber = called.at(-1) ?? null;
  elements.calledCount.textContent = String(called.length);
  elements.drawMachine.classList.toggle("is-drawing", state.randomDrawing);

  if (state.randomDrawing) {
    elements.currentBall.querySelector("strong").textContent = "?";
    elements.drawStageLabel.textContent = "BUBBLING…";
    elements.drawStageTitle.textContent = "보골보골, 숫자를 섞는 중!";
    elements.drawStageDescription.textContent = `남은 ${core.MAX_NUMBER - called.length}개의 공 중 하나가 곧 나옵니다.`;
    return;
  }

  elements.currentBall.querySelector("strong").textContent = lastNumber ?? "–";

  if (lastNumber !== null && lastNumber !== state.lastRenderedNumber) {
    elements.currentBall.classList.remove("pulse");
    elements.drawMachine.classList.remove("reveal");
    requestAnimationFrame(() => {
      elements.currentBall.classList.add("pulse");
      elements.drawMachine.classList.add("reveal");
    });
  }
  state.lastRenderedNumber = lastNumber;

  if (state.room.status === "lobby") {
    elements.drawStageLabel.textContent = "WAITING FOR PLAYERS";
    elements.drawStageTitle.textContent = state.players.length
      ? `${state.players.length}명의 빙고판이 모였어요`
      : "빙고판을 준비해 주세요";
    elements.drawStageDescription.textContent = "모두 제출하면 방장이 게임을 시작합니다.";
  } else if (state.room.status === "playing") {
    elements.drawStageLabel.textContent = called.length ? `ROLL ${String(called.length).padStart(2, "0")}` : "GAME START";
    elements.drawStageTitle.textContent = lastNumber === null ? "첫 번째 숫자를 뽑아주세요!" : `${lastNumber}번이 나왔습니다!`;
    elements.drawStageDescription.textContent = `먼저 ${state.room.targetLines}빙고를 완성하면 승리합니다.`;
  } else {
    elements.drawStageLabel.textContent = winners.length ? "GAME CLEAR" : "GAME OVER";
    elements.drawStageTitle.textContent = winners.length ? "빙고 완성!" : "게임이 종료되었습니다";
    elements.drawStageDescription.textContent = winners.length
      ? `${winners.map((player) => player.nickname).join(", ")} 님이 목표를 달성했습니다.`
      : "진행자가 게임을 종료했습니다.";
  }
}

function renderCalledNumbers() {
  const called = new Set(state.room.calledNumbers);
  const latest = state.room.calledNumbers.at(-1);
  calledNumberCells.forEach((cell) => {
    const number = Number(cell.dataset.number);
    cell.classList.toggle("called", called.has(number));
    cell.classList.toggle("latest", number === latest);
  });

  const history = [...state.room.calledNumbers].reverse().slice(0, 12);
  if (history.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-history";
    empty.textContent = "아직 나온 숫자가 없습니다.";
    elements.callHistory.replaceChildren(empty);
    return;
  }
  elements.callHistory.replaceChildren(...history.map((number) => {
    const item = document.createElement("b");
    item.textContent = String(number);
    return item;
  }));
}

function renderPlayers() {
  elements.playerCount.textContent = String(state.players.length);
  elements.targetLineLabel.textContent = `먼저 ${state.room.targetLines}빙고를 완성하면 승리!`;
  elements.emptyPlayers.hidden = state.players.length > 0;
  elements.playerGrid.hidden = state.players.length === 0;

  const ranked = core.rankPlayers(state.players, state.room.calledNumbers);
  const called = state.room.calledNumbers;
  const myUid = state.store.user.uid;
  const cards = ranked.map((player, index) => {
    const card = document.createElement("article");
    card.className = "player-card";
    card.classList.toggle("is-me", player.uid === myUid);
    card.classList.toggle("is-winner", player.progress.completedCount >= state.room.targetLines);

    const header = document.createElement("div");
    header.className = "player-card-header";
    const name = document.createElement("strong");
    name.textContent = player.nickname;
    if (player.uid === myUid) {
      const me = document.createElement("span");
      me.textContent = "  ME";
      name.appendChild(me);
    }
    const score = document.createElement("span");
    score.textContent = `${player.progress.completedCount}/${state.room.targetLines}`;
    header.append(name, score);

    const { container } = createDisplayBoard(player.board, called, `${player.nickname}의 빙고판`);
    const footer = document.createElement("div");
    footer.className = "player-progress-row";
    const rank = document.createElement("strong");
    rank.textContent = state.room.status === "lobby" ? `PLAYER ${String(index + 1).padStart(2, "0")}` : `${index + 1}위`;
    const detail = document.createElement("span");
    if (player.progress.completedCount >= state.room.targetLines) detail.textContent = "BINGO!";
    else if (player.progress.nearCount > 0) detail.textContent = `리치 ${player.progress.nearCount}줄`;
    else detail.textContent = `${player.progress.markedCount}칸 체크`;
    footer.append(rank, detail);
    card.append(header, container, footer);
    return card;
  });
  elements.playerGrid.replaceChildren(...cards);
}

function renderWinner(winners) {
  const showWinner = state.room.status === "finished" && winners.length > 0;
  elements.winnerBanner.hidden = !showWinner;
  if (!showWinner) return;
  elements.winnerNames.textContent = winners.map((player) => player.nickname).join(" · ");
  elements.winnerSummary.textContent = winners.length > 1
    ? `같은 숫자에서 ${winners.length}명이 함께 ${state.room.targetLines}빙고를 완성했습니다.`
    : `${state.room.targetLines}빙고를 가장 먼저 완성했습니다.`;
}

function renderRoom() {
  if (!state.room) return;
  document.title = `${state.room.title} | 다 같이 빙고`;
  elements.roomTitle.textContent = state.room.title;
  elements.roomCodeLabel.textContent = state.room.id;
  const statusLabels = {
    lobby: "WAITING ROOM",
    playing: "NOW PLAYING",
    finished: "GAME FINISHED",
  };
  elements.roomStatusEyebrow.textContent = statusLabels[state.room.status];

  const player = currentPlayer();
  const winners = core.winningPlayers(state.players, state.room.calledNumbers, state.room.targetLines);
  renderMyBoard(player);
  renderHostControls();
  renderDrawStage(winners);
  renderCalledNumbers();
  renderPlayers();
  renderWinner(winners);
  refreshConnectionState();

  if (isHost() && state.room.status === "playing" && winners.length > 0) {
    const finishKey = `${state.room.id}:${state.room.calledNumbers.length}`;
    if (state.autoFinishKey !== finishKey) {
      state.autoFinishKey = finishKey;
      state.store.setRoomStatus(state.room.id, "finished").catch((error) => {
        state.autoFinishKey = "";
        showToast(describeError(error), "error");
      });
    }
  }
}

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  await withBusy(submitButton, async () => {
    const targetLines = new FormData(elements.createRoomForm).get("targetLines");
    const roomId = await state.store.createRoom({
      title: elements.roomTitleInput.value,
      targetLines,
    });
    enterRoom(roomId);
    showToast("새 빙고 방을 만들었습니다.", "success");
  });
});

elements.roomCodeInput.addEventListener("input", () => {
  const caret = elements.roomCodeInput.selectionStart;
  elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
  elements.roomCodeInput.setSelectionRange(caret, caret);
});

elements.joinRoomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    enterRoom(elements.roomCodeInput.value);
  } catch (error) {
    showToast(describeError(error), "error");
  }
});

elements.leaveRoomButton.addEventListener("click", () => showLanding());

elements.shareRoomButton.addEventListener("click", async () => {
  if (!state.room) return;
  const url = core.makeRoomUrl(window.location.href, state.room.id);
  try {
    if (navigator.share) {
      await navigator.share({
        title: `${state.room.title} | 다 같이 빙고`,
        text: `빙고 방 코드: ${state.room.id}`,
        url,
      });
    } else {
      await navigator.clipboard.writeText(url);
      showToast("초대 링크를 복사했습니다.", "success");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast("초대 링크를 복사하지 못했습니다.", "error");
  }
});

elements.randomBoardButton.addEventListener("click", () => fillBoardInputs(core.randomBoard()));
elements.clearBoardButton.addEventListener("click", () => {
  fillBoardInputs([]);
  boardInputs[0].focus();
});

elements.playerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  await withBusy(submitButton, async () => {
    const board = core.normalizeBoard(boardInputValues());
    await state.store.savePlayer(state.room.id, {
      nickname: elements.nicknameInput.value,
      board,
    });
    state.editingBoard = false;
    showToast("빙고판을 제출했습니다.", "success");
  });
});

elements.editBoardButton.addEventListener("click", () => {
  const player = currentPlayer();
  if (!player || state.room.status !== "lobby") return;
  state.editingBoard = true;
  elements.nicknameInput.value = player.nickname;
  fillBoardInputs(player.board);
  renderMyBoard(player);
  elements.nicknameInput.focus();
});

elements.startGameButton.addEventListener("click", async () => {
  if (state.players.length === 0) return;
  const confirmed = await confirmAction({
    title: "빙고를 시작할까요?",
    message: `${state.players.length}명의 빙고판이 잠깁니다. 시작 후에는 숫자를 수정하거나 새로 참가할 수 없습니다.`,
    actionLabel: "게임 시작",
  });
  if (!confirmed) return;
  await withBusy(elements.startGameButton, async () => {
    await state.store.setRoomStatus(state.room.id, "playing");
    showToast("게임을 시작했습니다. 항아리에서 첫 숫자를 뽑아주세요!", "success");
  });
});

elements.randomDrawButton.addEventListener("click", async () => {
  if (!state.room || state.randomDrawing || state.room.calledNumbers.length >= core.MAX_NUMBER) return;
  const roomId = state.room.id;
  const token = state.randomDrawToken + 1;
  state.randomDrawToken = token;

  await withBusy(elements.randomDrawButton, async () => {
    state.randomDrawing = true;
    renderRoom();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    await new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 250 : 1800));
    if (state.randomDrawToken !== token || state.room?.id !== roomId) return;

    try {
      const result = await state.store.drawRandomNumber(roomId);
      if (result.exhausted) showToast("1부터 50까지 모든 숫자를 뽑았습니다.");
      else showToast(`${result.number}번 공이 뽑혔습니다!`, "success");
    } finally {
      if (state.randomDrawToken === token) state.randomDrawing = false;
    }
  });
});

elements.callNumberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  await withBusy(submitButton, async () => {
    const result = await state.store.callNumber(state.room.id, elements.calledNumberInput.value);
    elements.calledNumberInput.value = "";
    elements.calledNumberInput.focus();
    if (result.duplicate) showToast(`${result.number}번은 이미 나온 숫자라서 건너뛰었습니다.`);
  });
});

async function undoNumber(button) {
  await withBusy(button, async () => {
    const removed = await state.store.undoLastNumber(state.room.id);
    if (removed === null) showToast("취소할 숫자가 없습니다.");
    else showToast(`${removed}번 입력을 취소했습니다.`);
  });
}

elements.undoNumberButton.addEventListener("click", () => undoNumber(elements.undoNumberButton));
elements.undoFinishedButton.addEventListener("click", () => undoNumber(elements.undoFinishedButton));

elements.finishGameButton.addEventListener("click", async () => {
  const confirmed = await confirmAction({
    title: "게임을 종료할까요?",
    message: "아직 목표 빙고가 나오지 않아도 현재 상태로 게임을 마칩니다.",
    actionLabel: "게임 종료",
  });
  if (!confirmed) return;
  await withBusy(elements.finishGameButton, () => state.store.setRoomStatus(state.room.id, "finished"));
});

elements.resetGameButton.addEventListener("click", async () => {
  const confirmed = await confirmAction({
    title: "새 게임을 준비할까요?",
    message: "나온 숫자는 모두 지워지고 참가자들이 빙고판을 다시 수정할 수 있게 됩니다.",
    actionLabel: "새 게임 준비",
  });
  if (!confirmed) return;
  await withBusy(elements.resetGameButton, async () => {
    await state.store.resetRoom(state.room.id);
    state.autoFinishKey = "";
    showToast("호출 기록을 지우고 대기실로 돌아왔습니다.", "success");
  });
});

window.addEventListener("online", refreshConnectionState);
window.addEventListener("offline", refreshConnectionState);

async function initialize() {
  createBoardInputs();
  createCalledNumberBoard();
  validateBoardInputs();
  setConnection("loading", "연결 준비 중");
  try {
    state.store = await createBingoStore(firebaseConfig);
    setConnection("online", "실시간 연결됨");
    const requestedRoom = new URL(window.location.href).searchParams.get("room");
    if (requestedRoom) {
      enterRoom(requestedRoom);
    } else {
      showLanding({ clearUrl: false });
      setLoading(false);
    }
  } catch (error) {
    setConnection("error", "연결 실패");
    setLoading(false);
    showToast(describeError(error), "error");
  }
}

initialize();
