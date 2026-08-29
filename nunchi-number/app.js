import { createNunchiStore } from "./firebase-store.js";
import { createEventBridge, eventRequestFromUrl } from "../event-bridge.js";

const core = globalThis.NunchiNumberCore;
const firebaseConfig = globalThis.GuildEventsFirebaseConfig;
const eventRequest = eventRequestFromUrl();

if (!core) throw new Error("눈치 숫자 규칙 모듈을 불러오지 못했습니다.");

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
  championBanner: document.getElementById("championBanner"),
  championNames: document.getElementById("championNames"),
  championScore: document.getElementById("championScore"),
  lobbyStage: document.getElementById("lobbyStage"),
  lobbyRangePreview: document.getElementById("lobbyRangePreview"),
  lobbyPlayerCount: document.getElementById("lobbyPlayerCount"),
  lobbyScoreRule: document.getElementById("lobbyScoreRule"),
  lobbyScoreGuide: document.getElementById("lobbyScoreGuide"),
  choosingStage: document.getElementById("choosingStage"),
  roundEyebrow: document.getElementById("roundEyebrow"),
  roundScoreMode: document.getElementById("roundScoreMode"),
  roundScoreGuide: document.getElementById("roundScoreGuide"),
  numberMaxLabel: document.getElementById("numberMaxLabel"),
  submittedCount: document.getElementById("submittedCount"),
  activeCount: document.getElementById("activeCount"),
  submissionMeterFill: document.getElementById("submissionMeterFill"),
  submissionHint: document.getElementById("submissionHint"),
  choiceArea: document.getElementById("choiceArea"),
  numberChoiceGrid: document.getElementById("numberChoiceGrid"),
  selectedNumberLabel: document.getElementById("selectedNumberLabel"),
  submitChoiceButton: document.getElementById("submitChoiceButton"),
  choiceLocked: document.getElementById("choiceLocked"),
  lockedNumber: document.getElementById("lockedNumber"),
  lockedPoints: document.getElementById("lockedPoints"),
  roundSpectator: document.getElementById("roundSpectator"),
  resultStage: document.getElementById("resultStage"),
  resultEyebrow: document.getElementById("resultEyebrow"),
  resultTitle: document.getElementById("resultTitle"),
  resultDescription: document.getElementById("resultDescription"),
  winningNumber: document.getElementById("winningNumber"),
  winningPoints: document.getElementById("winningPoints"),
  resultChoiceGrid: document.getElementById("resultChoiceGrid"),
  missingPlayers: document.getElementById("missingPlayers"),
  identityTitle: document.getElementById("identityTitle"),
  identityBadge: document.getElementById("identityBadge"),
  playerForm: document.getElementById("playerForm"),
  nicknameInput: document.getElementById("nicknameInput"),
  myPlayerCard: document.getElementById("myPlayerCard"),
  myAvatarNumber: document.getElementById("myAvatarNumber"),
  myNickname: document.getElementById("myNickname"),
  myScore: document.getElementById("myScore"),
  editNicknameButton: document.getElementById("editNicknameButton"),
  spectatorMessage: document.getElementById("spectatorMessage"),
  hostPanel: document.getElementById("hostPanel"),
  hostLobbyControls: document.getElementById("hostLobbyControls"),
  hostLobbyMessage: document.getElementById("hostLobbyMessage"),
  startGameButton: document.getElementById("startGameButton"),
  hostChoosingControls: document.getElementById("hostChoosingControls"),
  hostChoosingMessage: document.getElementById("hostChoosingMessage"),
  revealRoundButton: document.getElementById("revealRoundButton"),
  hostResultControls: document.getElementById("hostResultControls"),
  hostResultMessage: document.getElementById("hostResultMessage"),
  nextRoundButton: document.getElementById("nextRoundButton"),
  hostFinishedControls: document.getElementById("hostFinishedControls"),
  playerCount: document.getElementById("playerCount"),
  scoreRoundLabel: document.getElementById("scoreRoundLabel"),
  emptyScoreboard: document.getElementById("emptyScoreboard"),
  scoreboardList: document.getElementById("scoreboardList"),
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
  phaseKey: "",
  selectedNumber: null,
  ownChoice: null,
  ownChoiceFetchKey: "",
  roundChoices: null,
  choiceFetchKey: "",
  result: null,
  resultRecordKey: "",
  resultRecordAttempts: 0,
  expectedScores: new Map(),
  editingNickname: false,
  unsubscribeRoom: null,
  unsubscribePlayers: null,
  toastTimer: 0,
  busyElements: new Set(),
  eventBridge: null,
  eventPlayerSaving: false,
};

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
  if (code.includes("permission-denied")) return "이 작업을 할 권한이 없거나 라운드 상태가 이미 바뀌었습니다.";
  if (code.includes("unavailable")) return "게임 서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.";
  if (code.includes("not-found") || code.includes("room/not-found")) return "해당 눈치 숫자 방을 찾지 못했습니다.";
  if (code.includes("choice/already-submitted")) return "이번 라운드 숫자는 이미 제출했습니다.";
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
  if (state.busyElements.has(button) || button.disabled) return undefined;
  state.busyElements.add(button);
  button.disabled = true;
  try {
    return await task();
  } catch (error) {
    showToast(describeError(error), "error");
    return undefined;
  } finally {
    state.busyElements.delete(button);
    renderRoom();
  }
}

function updateRoomUrl(roomId = "") {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (roomId) {
    if (eventRequest) {
      url.searchParams.set("event", eventRequest.eventId);
      url.searchParams.set("match", eventRequest.matchId);
    }
    url.searchParams.set("room", roomId);
  }
  window.history.replaceState({}, "", url);
}

function unsubscribeRoom() {
  state.unsubscribeRoom?.();
  state.unsubscribePlayers?.();
  state.unsubscribeRoom = null;
  state.unsubscribePlayers = null;
}

function resetRoundState() {
  state.selectedNumber = null;
  state.ownChoice = null;
  state.ownChoiceFetchKey = "";
  state.roundChoices = null;
  state.choiceFetchKey = "";
  state.result = null;
  state.resultRecordKey = "";
  state.resultRecordAttempts = 0;
  state.expectedScores = new Map();
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
  state.phaseKey = "";
  state.editingNickname = false;
  resetRoundState();
  elements.landingView.hidden = false;
  elements.roomView.hidden = true;
  document.title = "눈치 숫자 | 길드 오락실";
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
  state.phaseKey = "";
  state.editingNickname = false;
  resetRoundState();
  elements.landingView.hidden = true;
  elements.roomView.hidden = false;
  elements.roomCodeLabel.textContent = normalizedId;
  updateRoomUrl(normalizedId);
  setLoading(true, "눈치 숫자 방에 들어가는 중…");

  state.unsubscribeRoom = state.store.subscribeRoom(
    normalizedId,
    (snapshot) => {
      state.roomLoaded = true;
      if (!snapshot) {
        setLoading(false);
        showToast("해당 눈치 숫자 방을 찾지 못했습니다.", "error");
        showLanding();
        return;
      }
      const nextPhaseKey = `${snapshot.room.status}:${snapshot.room.round}`;
      if (state.phaseKey !== nextPhaseKey) {
        state.phaseKey = nextPhaseKey;
        resetRoundState();
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
    ensureEventPlayer();
  }
}

async function ensureEventPlayer() {
  if (!state.eventBridge || state.eventPlayerSaving || currentPlayer() || state.room?.status !== "lobby") return;
  if (!state.eventBridge.isEligible() || !state.eventBridge.participant) return;
  state.eventPlayerSaving = true;
  try {
    await state.store.savePlayer(state.room.id, state.eventBridge.participant.nickname);
    showToast("이벤트 참가 정보로 자동 등록했습니다.", "success");
  } catch (error) {
    showToast(describeError(error), "error");
  } finally {
    state.eventPlayerSaving = false;
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

function syncNunchiReadiness(player) {
  if (!state.eventBridge?.isEligible()) return;
  const uid = state.store?.user?.uid;
  if (state.room.status === "lobby") {
    state.eventBridge.setReadiness(player ? "ready" : "entering", player ? "게임 참가 준비 완료" : "참가 등록 중");
    return;
  }
  if (!state.room.activeUids.includes(uid)) {
    state.eventBridge.setReadiness("spectating", "이번 라운드 관전 중");
    return;
  }
  if (state.room.status === "choosing") {
    const submitted = state.room.submittedUids.includes(uid);
    state.eventBridge.setReadiness(submitted ? "submitted" : "playing", submitted ? "숫자 제출 완료" : "숫자 선택 중");
    return;
  }
  if (state.room.status === "revealed") {
    state.eventBridge.setReadiness("playing", "라운드 결과 확인 중");
    return;
  }
  state.eventBridge.setReadiness("finished", "최종 결과 확인 중");
}

function playerByUid(uid) {
  return state.players.find((player) => player.uid === uid) || null;
}

function activePlayers() {
  if (!state.room) return [];
  return state.room.activeUids.map(playerByUid).filter(Boolean);
}

function roundLabel(round = state.room?.round || 0) {
  if (!state.room || round === 0) return "대기 중";
  if (round <= state.room.totalRounds) {
    return `ROUND ${String(round).padStart(2, "0")} / ${String(state.room.totalRounds).padStart(2, "0")}`;
  }
  return `SUDDEN DEATH ${String(round - state.room.totalRounds).padStart(2, "0")}`;
}

function buildNumberChoices() {
  if (!state.room || state.room.status !== "choosing") return;
  const buttons = [];
  for (let number = 1; number <= state.room.numberMax; number += 1) {
    const points = core.cardPointForNumber(
      number,
      state.room.numberMax,
      state.room.scoreMode,
      state.room.cardPoints,
    );
    const button = document.createElement("button");
    button.type = "button";
    button.className = "number-choice-button";
    const numberLabel = document.createElement("strong");
    numberLabel.textContent = String(number);
    const pointLabel = document.createElement("small");
    pointLabel.textContent = `${points}P`;
    button.append(numberLabel, pointLabel);
    button.classList.toggle("selected", state.selectedNumber === number);
    button.setAttribute("aria-pressed", String(state.selectedNumber === number));
    button.setAttribute("aria-label", `${number}번 선택, ${points}점 카드`);
    button.addEventListener("click", () => {
      state.selectedNumber = number;
      buildNumberChoices();
      elements.selectedNumberLabel.textContent = String(number);
      elements.submitChoiceButton.disabled = false;
    });
    buttons.push(button);
  }
  elements.numberChoiceGrid.replaceChildren(...buttons);
}

function loadOwnChoiceIfNeeded() {
  const uid = state.store?.user?.uid;
  if (!state.room || !uid || !state.room.submittedUids.includes(uid)) return;
  if (state.ownChoice?.round === state.room.round) return;
  const key = `${state.room.id}:${state.room.round}:${uid}`;
  if (state.ownChoiceFetchKey === key) return;
  state.ownChoiceFetchKey = key;
  state.store.getOwnChoice(state.room.id, state.room.numberMax).then((choice) => {
    if (state.ownChoiceFetchKey !== key || state.room?.round !== choice?.round) return;
    state.ownChoice = choice;
    renderRoom();
  }).catch((error) => {
    showToast(describeError(error), "error");
  });
}

function renderIdentity(player) {
  const roomOpen = state.room.status === "lobby" && (!state.eventBridge || state.eventBridge.isEligible());
  const editing = roomOpen && (!player || state.editingNickname);
  elements.playerForm.hidden = !editing;
  elements.myPlayerCard.hidden = !player || editing;
  elements.spectatorMessage.hidden = Boolean(player) || roomOpen;

  if (!player && !roomOpen) {
    elements.identityTitle.textContent = "관전 화면";
    elements.identityBadge.textContent = "관전 중";
    elements.identityBadge.classList.remove("ready");
    return;
  }

  elements.identityTitle.textContent = player ? "내 참가 정보" : "참가자 등록";
  elements.identityBadge.textContent = player ? "참가 완료" : "미등록";
  elements.identityBadge.classList.toggle("ready", Boolean(player));
  if (!player) return;

  const playerIndex = state.players.findIndex((item) => item.uid === player.uid);
  elements.myAvatarNumber.textContent = String(playerIndex + 1).padStart(2, "0");
  elements.myNickname.textContent = player.nickname;
  elements.myScore.textContent = String(player.score);
  elements.editNicknameButton.hidden = !roomOpen;
}

function renderLobby() {
  const numberMax = core.numberMaxForPlayers(Math.max(1, state.players.length));
  elements.lobbyRangePreview.textContent = String(numberMax);
  elements.lobbyPlayerCount.textContent = String(state.players.length);
  elements.lobbyScoreRule.textContent = core.scoreModeLabel(state.room.scoreMode);
  elements.lobbyScoreGuide.textContent = core.scoreGuide(numberMax, state.room.scoreMode);
}

function renderChoosing() {
  const uid = state.store?.user?.uid;
  const isActive = state.room.activeUids.includes(uid);
  const submitted = state.room.submittedUids.includes(uid);
  const activeCount = state.room.activeUids.length;
  const submittedCount = state.room.submittedUids.length;

  elements.roundEyebrow.textContent = roundLabel();
  elements.numberMaxLabel.textContent = String(state.room.numberMax);
  elements.roundScoreMode.textContent = core.scoreModeLabel(state.room.scoreMode);
  elements.roundScoreGuide.textContent = core.scoreGuide(state.room.numberMax, state.room.scoreMode);
  elements.submittedCount.textContent = String(submittedCount);
  elements.activeCount.textContent = String(activeCount);
  elements.submissionMeterFill.style.width = `${activeCount ? (submittedCount / activeCount) * 100 : 0}%`;
  elements.submissionHint.textContent = submittedCount === activeCount
    ? "모두 골랐습니다! 진행자의 공개를 기다려 주세요."
    : "다른 사람의 숫자는 공개 전까지 보이지 않습니다.";

  elements.choiceArea.hidden = !isActive || submitted;
  elements.choiceLocked.hidden = !isActive || !submitted;
  elements.roundSpectator.hidden = isActive;

  if (isActive && !submitted) {
    buildNumberChoices();
    elements.selectedNumberLabel.textContent = state.selectedNumber === null ? "–" : String(state.selectedNumber);
    elements.submitChoiceButton.disabled = state.selectedNumber === null || state.busyElements.has(elements.submitChoiceButton);
  }
  if (isActive && submitted) {
    const ownNumber = state.ownChoice?.round === state.room.round ? state.ownChoice.number : 0;
    elements.lockedNumber.textContent = ownNumber ? String(ownNumber) : "?";
    elements.lockedPoints.textContent = ownNumber
      ? `${core.cardPointForNumber(ownNumber, state.room.numberMax, state.room.scoreMode, state.room.cardPoints)}점 카드`
      : "점수 확인 중…";
    loadOwnChoiceIfNeeded();
  }
}

function makeResultCard(entry) {
  const points = entry.points;
  const card = document.createElement("article");
  card.className = "result-choice-card";
  card.classList.toggle("duplicate", entry.duplicate);
  card.classList.toggle("winner", entry.winner);
  card.setAttribute(
    "aria-label",
    `${entry.nickname}: ${entry.number}번${entry.winner ? `, 승리, ${points}점` : entry.duplicate ? ", 중복" : ""}`,
  );
  const number = document.createElement("strong");
  number.textContent = String(entry.number);
  const nickname = document.createElement("span");
  nickname.textContent = entry.nickname;
  card.append(number, nickname);
  const pointBadge = document.createElement("small");
  pointBadge.className = entry.winner ? "result-points" : "card-points";
  pointBadge.textContent = entry.winner ? `+${points}P` : `${points}P`;
  card.appendChild(pointBadge);
  return card;
}

function renderResult() {
  elements.resultEyebrow.textContent = `${roundLabel()} RESULT`;
  const result = state.result;
  const numberElement = elements.winningNumber.querySelector("strong");
  const numberCaption = elements.winningNumber.querySelector("small");

  if (!result) {
    elements.resultTitle.textContent = "숫자를 공개합니다!";
    elements.resultDescription.textContent = state.room.scoreMode === "random"
      ? "중복되지 않은 모든 카드를 찾는 중…"
      : "가장 작은 단독 숫자를 찾는 중…";
    numberCaption.textContent = state.room.scoreMode === "random" ? "UNIQUE CARDS" : "WINNING NUMBER";
    numberElement.textContent = "–";
    elements.winningPoints.textContent = "+0P";
    elements.winningNumber.classList.remove("no-winner");
    elements.resultChoiceGrid.replaceChildren();
    elements.missingPlayers.hidden = true;
    return;
  }

  const winners = result.winnerUids.map(playerByUid).filter(Boolean);
  if (winners.length) {
    const totalPoints = result.awards.reduce((sum, award) => sum + award.points, 0);
    if (state.room.scoreMode === "random") {
      const awardLabels = result.awards.map((award) => {
        const nickname = playerByUid(award.uid)?.nickname || "참가자";
        return `${nickname} +${award.points}P`;
      });
      elements.resultTitle.textContent = `${winners.length}명이 현상금 획득!`;
      elements.resultDescription.textContent = awardLabels.join(" · ");
      numberCaption.textContent = "UNIQUE CARDS";
      numberElement.textContent = String(winners.length);
    } else {
      const winner = winners[0];
      const points = result.awards[0].points;
      elements.resultTitle.textContent = `${winner.nickname}, ${result.winningNumber}번으로 +${points}점!`;
      elements.resultDescription.textContent = `중복되지 않은 가장 작은 숫자 · ${core.scoreModeLabel(state.room.scoreMode)} 규칙`;
      numberCaption.textContent = "WINNING NUMBER";
      numberElement.textContent = String(result.winningNumber);
    }
    elements.winningPoints.textContent = `+${totalPoints}P`;
    elements.winningNumber.classList.remove("no-winner");
  } else {
    elements.resultTitle.textContent = "이번 라운드는 승자 없음!";
    elements.resultDescription.textContent = result.entries.length
      ? "단독으로 남은 숫자가 없어 아무도 점수를 얻지 못했습니다."
      : "제출된 숫자가 없어 아무도 점수를 얻지 못했습니다.";
    numberElement.textContent = "×";
    numberCaption.textContent = state.room.scoreMode === "random" ? "UNIQUE CARDS" : "WINNING NUMBER";
    elements.winningPoints.textContent = "+0P";
    elements.winningNumber.classList.add("no-winner");
  }
  elements.resultChoiceGrid.replaceChildren(...result.entries.map(makeResultCard));

  const missingNames = result.missingUids.map((uid) => playerByUid(uid)?.nickname).filter(Boolean);
  elements.missingPlayers.hidden = missingNames.length === 0;
  if (missingNames.length) {
    elements.missingPlayers.textContent = `미제출: ${missingNames.join(" · ")} — 이번 라운드 결과에서 제외되었습니다.`;
  }
}

function loadRoundResultIfNeeded() {
  if (!state.room || !["revealed", "finished"].includes(state.room.status)) return;
  const key = `${state.room.id}:${state.room.round}`;
  if (state.choiceFetchKey === key) return;
  state.choiceFetchKey = key;
  state.store.getChoices(state.room.id, state.room.round, state.room.numberMax).then((choices) => {
    if (state.choiceFetchKey !== key || `${state.room?.id}:${state.room?.round}` !== key) return;
    state.roundChoices = choices;
    state.result = core.computeRoundResult(activePlayers(), choices, {
      numberMax: state.room.numberMax,
      scoreMode: state.room.scoreMode,
      cardPoints: state.room.cardPoints,
    });
    renderRoom();
    recordResultIfHost();
  }).catch((error) => {
    state.choiceFetchKey = "";
    showToast(describeError(error), "error");
  });
}

function recordResultIfHost() {
  if (!isHost() || !state.room || state.room.status !== "revealed" || !state.result) return;
  if (state.room.resultRound >= state.room.round) return;
  const key = `${state.room.id}:${state.room.round}`;
  if (state.resultRecordKey === key) return;
  state.resultRecordKey = key;
  state.resultRecordAttempts += 1;
  state.expectedScores = new Map(state.result.awards.map((award) => [
    award.uid,
    (playerByUid(award.uid)?.score || 0) + award.points,
  ]));
  state.store.recordRoundResult(
    state.room.id,
    state.room.round,
    state.result.winningNumber,
    state.result.awards,
  ).catch((error) => {
    state.resultRecordKey = "";
    state.expectedScores = new Map();
    if (state.resultRecordAttempts < 4 && state.room?.status === "revealed") {
      window.setTimeout(recordResultIfHost, 700 * state.resultRecordAttempts);
    } else {
      showToast(`점수 반영 실패: ${describeError(error)}`, "error");
    }
  });
}

function nextHostAction() {
  if (state.room.resultRound < state.room.round) {
    return { disabled: true, label: "결과 반영 중…", message: "공개된 숫자를 점수에 반영하고 있습니다." };
  }
  const waitingForScores = [...state.expectedScores]
    .some(([uid, score]) => (playerByUid(uid)?.score ?? -1) < score);
  if (waitingForScores) {
    return { disabled: true, label: "점수 동기화 중…", message: "승자의 점수를 모든 화면에 동기화하고 있습니다." };
  }
  if (state.room.round < state.room.totalRounds) {
    return {
      disabled: false,
      label: `${state.room.round + 1}라운드 시작`,
      message: "결과를 확인했다면 전원이 참여하는 다음 라운드를 시작하세요.",
      kind: "next",
      activeUids: state.players.map((player) => player.uid),
    };
  }

  const leaders = core.scoreLeaders(state.players);
  if (leaders.length <= 1) {
    return {
      disabled: false,
      label: "최종 결과 확정",
      message: leaders.length ? `${leaders[0].nickname} 님이 단독 선두입니다.` : "게임 결과를 확정합니다.",
      kind: "finish",
    };
  }
  return {
    disabled: false,
    label: `${leaders.length}명 서든데스 시작`,
    message: `${leaders.map((player) => player.nickname).join(" · ")} 님이 공동 선두입니다. 동점자만 한 라운드를 더 진행합니다.`,
    kind: "sudden",
    activeUids: leaders.map((player) => player.uid),
  };
}

function renderHostControls() {
  const host = isHost();
  elements.hostPanel.hidden = !host;
  if (!host) return;

  const status = state.room.status;
  elements.hostLobbyControls.hidden = status !== "lobby";
  elements.hostChoosingControls.hidden = status !== "choosing";
  elements.hostResultControls.hidden = status !== "revealed";
  elements.hostFinishedControls.hidden = status !== "finished";

  if (status === "lobby") {
    const count = state.players.length;
    const expectedCount = state.eventBridge?.match?.participantUids?.length || 0;
    const waitingCount = Math.max(0, expectedCount - count);
    if (waitingCount > 0) {
      elements.hostLobbyMessage.textContent = `이벤트 참가자 ${waitingCount}명이 게임방에 들어오는 중입니다. 바로 시작하면 현재 등록된 ${count}명만 이번 게임에 참가합니다.`;
    } else if (count === 1) {
      elements.hostLobbyMessage.textContent = "혼자서도 진행 확인용으로 시작할 수 있어요. 실제 눈치 게임은 2명 이상일 때 더 재미있습니다.";
    } else {
      elements.hostLobbyMessage.textContent = "참가 등록이 끝나면 게임을 시작하세요. 시작한 인원으로 숫자 범위가 잠깁니다.";
    }
    elements.startGameButton.textContent = count === 0
      ? "참가 등록을 확인하는 중…"
      : count === 1
        ? "1명 · 테스트 모드로 시작"
        : `${count}명 · 1–${core.numberMaxForPlayers(count)}로 시작`;
    elements.startGameButton.disabled = state.busyElements.has(elements.startGameButton);
  } else if (status === "choosing") {
    const submitted = state.room.submittedUids.length;
    const active = state.room.activeUids.length;
    elements.hostChoosingMessage.textContent = submitted === active
      ? "모두 선택했습니다. 한꺼번에 숫자를 공개하세요!"
      : `${active - submitted}명의 비밀 숫자를 더 기다리고 있습니다.`;
    elements.revealRoundButton.textContent = submitted === active ? "모두의 숫자 공개" : `현재 ${submitted}명 선택 공개`;
    elements.revealRoundButton.disabled = submitted === 0 || state.busyElements.has(elements.revealRoundButton);
  } else if (status === "revealed") {
    const action = nextHostAction();
    elements.hostResultMessage.textContent = action.message;
    elements.nextRoundButton.textContent = action.label;
    elements.nextRoundButton.dataset.action = action.kind || "";
    elements.nextRoundButton.disabled = action.disabled || state.busyElements.has(elements.nextRoundButton);
  }
}

function renderScoreboard() {
  elements.playerCount.textContent = String(state.players.length);
  elements.scoreRoundLabel.textContent = state.room.status === "lobby" ? "대기 중" : roundLabel();
  elements.emptyScoreboard.hidden = state.players.length > 0;
  elements.scoreboardList.hidden = state.players.length === 0;

  const myUid = state.store?.user?.uid;
  const ranked = core.rankPlayers(state.players);
  const rows = ranked.map((player, index) => {
    const row = document.createElement("li");
    row.className = "score-row";
    row.classList.toggle("ready", state.room.status === "choosing" && state.room.submittedUids.includes(player.uid));
    row.classList.toggle("inactive", state.room.status !== "lobby" && !state.room.activeUids.includes(player.uid));
    row.classList.toggle("winner", state.room.resultRound === state.room.round && state.room.lastWinnerUids.includes(player.uid));
    const rank = document.createElement("span");
    rank.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("strong");
    name.textContent = player.nickname;
    if (player.uid === myUid) {
      const me = document.createElement("i");
      me.textContent = "  ME";
      name.appendChild(me);
    }
    const score = document.createElement("b");
    score.textContent = `${player.score}P`;
    row.append(rank, name, score);
    return row;
  });
  elements.scoreboardList.replaceChildren(...rows);
}

function renderChampion() {
  const show = state.room.status === "finished";
  elements.championBanner.hidden = !show;
  if (!show) return;
  const leaders = core.scoreLeaders(state.players);
  elements.championNames.textContent = leaders.length
    ? leaders.map((player) => player.nickname).join(" · ")
    : "최종 우승자 없음";
  const score = leaders[0]?.score || 0;
  elements.championScore.textContent = leaders.length > 1
    ? `${score}점 공동 우승`
    : `${score}점으로 최종 우승`;
}

function renderRoom() {
  if (!state.room) return;
  document.title = `${state.room.title} | 눈치 숫자`;
  elements.roomTitle.textContent = state.room.title;
  elements.roomCodeLabel.textContent = state.room.id;
  const statusLabels = {
    lobby: "WAITING ROOM",
    choosing: state.room.round > state.room.totalRounds ? "SUDDEN DEATH" : "SECRET PICK",
    revealed: "NUMBER REVEALED",
    finished: "GAME FINISHED",
  };
  elements.roomStatusEyebrow.textContent = statusLabels[state.room.status];

  elements.lobbyStage.hidden = state.room.status !== "lobby";
  elements.choosingStage.hidden = state.room.status !== "choosing";
  elements.resultStage.hidden = !["revealed", "finished"].includes(state.room.status);

  const player = currentPlayer();
  renderIdentity(player);
  renderLobby();
  if (state.room.status === "choosing") renderChoosing();
  if (["revealed", "finished"].includes(state.room.status)) {
    renderResult();
    loadRoundResultIfNeeded();
  }
  renderHostControls();
  renderScoreboard();
  renderChampion();
  syncNunchiReadiness(player);
  if (state.eventBridge && state.room.status === "finished" && state.players.length) {
    state.eventBridge.setFinishedResult(state.players.map((entry) => ({
      uid: entry.uid,
      nickname: entry.nickname,
      metrics: [entry.score],
      label: `게임 점수 ${entry.score}점`,
    })), `${core.scoreLeaders(state.players).map((entry) => entry.nickname).join(" · ")} 최종 선두`);
  }
  refreshConnectionState();
}

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  await withBusy(submitButton, async () => {
    const formData = new FormData(elements.createRoomForm);
    const totalRounds = formData.get("totalRounds");
    const scoreMode = formData.get("scoreMode");
    const roomId = await state.store.createRoom({
      title: elements.roomTitleInput.value,
      totalRounds,
      scoreMode,
    });
    enterRoom(roomId);
    showToast("새 눈치 숫자 방을 만들었습니다.", "success");
  });
});

elements.roomCodeInput.addEventListener("input", () => {
  const caret = elements.roomCodeInput.selectionStart;
  elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 8);
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

elements.leaveRoomButton.addEventListener("click", () => {
  if (eventRequest) location.href = `../?event=${eventRequest.eventId}&view=score`;
  else showLanding();
});

elements.shareRoomButton.addEventListener("click", async () => {
  if (!state.room) return;
  const url = eventRequest
    ? new URL(`../?event=${eventRequest.eventId}`, window.location.href).href
    : core.makeRoomUrl(window.location.href, state.room.id);
  try {
    if (navigator.share) {
      await navigator.share({
        title: `${state.room.title} | 눈치 숫자`,
        text: `눈치 숫자 방 코드: ${state.room.id}`,
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

elements.playerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  await withBusy(submitButton, async () => {
    await state.store.savePlayer(state.room.id, elements.nicknameInput.value);
    state.editingNickname = false;
    showToast("참가 등록을 마쳤습니다.", "success");
  });
});

elements.editNicknameButton.addEventListener("click", () => {
  const player = currentPlayer();
  if (!player || state.room.status !== "lobby") return;
  state.editingNickname = true;
  elements.nicknameInput.value = player.nickname;
  renderIdentity(player);
  elements.nicknameInput.focus();
});

elements.startGameButton.addEventListener("click", async () => {
  if (state.players.length === 0) {
    showToast("참가자 자동 등록 중입니다. 잠시 후 다시 눌러 주세요.", "error");
    return;
  }
  const numberMax = core.numberMaxForPlayers(state.players.length);
  const expectedCount = state.eventBridge?.match?.participantUids?.length || 0;
  const waitingCount = Math.max(0, expectedCount - state.players.length);
  const waitingWarning = waitingCount > 0
    ? ` 아직 게임방에 들어오지 않은 이벤트 참가자 ${waitingCount}명은 이번 게임을 관전하게 됩니다.`
    : "";
  const confirmed = await confirmAction({
    title: "눈치 숫자를 시작할까요?",
    message: `${state.players.length}명의 참가자를 잠그고 1–${numberMax} 범위, ${core.scoreModeLabel(state.room.scoreMode)} 규칙으로 시작합니다. 시작 후에는 새 참가 등록과 이름 수정이 닫힙니다.${waitingWarning}`,
    actionLabel: "게임 시작",
  });
  if (!confirmed) return;
  await withBusy(elements.startGameButton, async () => {
    await state.store.startGame(state.room.id, state.players.map((player) => player.uid));
    await state.eventBridge?.markPlaying();
    showToast(`1–${numberMax} 중 비밀 숫자를 골라 주세요!`, "success");
  });
});

elements.submitChoiceButton.addEventListener("click", async () => {
  if (state.selectedNumber === null) return;
  const selected = state.selectedNumber;
  const points = core.cardPointForNumber(
    selected,
    state.room.numberMax,
    state.room.scoreMode,
    state.room.cardPoints,
  );
  await withBusy(elements.submitChoiceButton, async () => {
    state.ownChoice = await state.store.submitChoice(state.room.id, selected);
    showToast(`${selected}번 · ${points}점 카드를 비밀리에 제출했습니다.`, "success");
  });
});

elements.revealRoundButton.addEventListener("click", async () => {
  const submitted = state.room.submittedUids.length;
  const active = state.room.activeUids.length;
  if (submitted === 0) return;
  if (submitted < active) {
    const confirmed = await confirmAction({
      title: "아직 모두 고르지 않았어요",
      message: `${active - submitted}명이 미제출 상태입니다. 지금 공개하면 이번 라운드 결과에서 제외됩니다.`,
      actionLabel: "그대로 공개",
    });
    if (!confirmed) return;
  }
  await withBusy(elements.revealRoundButton, async () => {
    await state.store.revealRound(state.room.id);
    showToast("모두의 숫자를 공개했습니다!", "success");
  });
});

elements.nextRoundButton.addEventListener("click", async () => {
  const action = nextHostAction();
  if (action.disabled) return;
  let confirmed = true;
  if (action.kind === "sudden") {
    confirmed = await confirmAction({
      title: "서든데스를 시작할까요?",
      message: `${action.activeUids.length}명의 공동 선두만 참가합니다. 단독 선두가 생길 때까지 계속됩니다.`,
      actionLabel: "서든데스 시작",
    });
  } else if (action.kind === "finish") {
    confirmed = await confirmAction({
      title: "최종 결과를 확정할까요?",
      message: "점수판의 단독 선두를 최종 우승자로 확정하고 게임을 마칩니다.",
      actionLabel: "결과 확정",
    });
  }
  if (!confirmed) return;

  await withBusy(elements.nextRoundButton, async () => {
    if (action.kind === "finish") {
      await state.store.finishGame(state.room.id);
      showToast("최종 우승자가 결정됐습니다!", "success");
      return;
    }
    await state.store.nextRound(state.room.id, state.room.round + 1, action.activeUids);
    showToast(action.kind === "sudden" ? "동점자 서든데스를 시작합니다!" : "다음 라운드를 시작합니다.", "success");
  });
});

window.addEventListener("online", refreshConnectionState);
window.addEventListener("offline", refreshConnectionState);

async function initialize() {
  setConnection("loading", "연결 준비 중");
  try {
    state.store = await createNunchiStore(firebaseConfig);
    if (eventRequest) {
      state.eventBridge = await createEventBridge(firebaseConfig, eventRequest, "nunchi");
      if (!state.eventBridge.participant) throw new Error("이벤트 참가 등록을 먼저 완료해 주세요.");
      elements.nicknameInput.value = state.eventBridge.participant.nickname;
      elements.nicknameInput.readOnly = true;
      document.querySelector(".back-link").href = `../?event=${eventRequest.eventId}&view=score`;
    }
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
