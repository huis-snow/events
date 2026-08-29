import { createChosungStore } from "./firebase-store.js";
import { createEventBridge, eventRequestFromUrl } from "../event-bridge.js";

const core = globalThis.ChosungEscapeCore;
const firebaseConfig = globalThis.GuildEventsFirebaseConfig;
const eventRequest = eventRequestFromUrl();
if (!core) throw new Error("초성 탈출 규칙 모듈을 불러오지 못했습니다.");

const ids = [
  "landingView", "roomView", "createRoomForm", "roomTitleInput", "joinRoomForm", "roomCodeInput",
  "connectionState", "roomEyebrow", "roomTitle", "roomCodeLabel", "shareButton", "leaveButton",
  "championBanner", "championNames", "championScore", "lobbyStage", "questionSetupForm", "playerWaiting",
  "questionList", "addQuestionButton", "answeringStage", "questionNumber", "clueSteps", "availablePoints",
  "categoryLabel", "clueLabel", "clueDisplay", "clueDescription", "guessForm", "guessInput", "guessFeedback",
  "solvedBox", "solvedPoints", "spectatorBox", "revealedStage", "revealedAnswer", "solverList",
  "revealedWaiting", "identityTitle", "identityBadge", "playerForm", "nicknameInput", "myPlayer", "myAvatar",
  "myNickname", "myScore", "identitySpectator", "hostPanel", "hostLobbyControls", "startGuide",
  "startGameButton", "hostAnsweringControls", "hostProgress", "nextClueButton", "revealAnswerButton",
  "hostRevealedControls", "nextQuestionButton", "hostFinishedControls", "playerCount", "scoreboard",
  "loadingCover", "loadingMessage", "toast",
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const state = {
  store: null,
  eventBridge: null,
  roomId: "",
  room: null,
  players: [],
  roomLoaded: false,
  playersLoaded: false,
  unsubscribeRoom: null,
  unsubscribePlayers: null,
  unsubscribeGuesses: null,
  secrets: new Map(),
  secretsLoaded: false,
  hostDataLoading: false,
  questionFormLoaded: false,
  pendingGuesses: [],
  processingGuessIds: new Set(),
  eventPlayerSaving: false,
  guessPending: false,
  guessCooldownUntil: 0,
  toastTimer: 0,
  busyElements: new Set(),
};

function setLoading(visible, message = "게임 서버에 연결하는 중…") {
  elements.loadingMessage.textContent = message;
  elements.loadingCover.classList.toggle("done", !visible);
}

function setConnection(status, label) {
  elements.connectionState.dataset.state = status;
  elements.connectionState.querySelector("span").textContent = label;
}

function refreshConnection() {
  if (!navigator.onLine) setConnection("error", "인터넷 연결 끊김");
  else if (state.roomLoaded && state.playersLoaded) setConnection("online", "실시간 연결됨");
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2800);
}

function describeError(error) {
  if (error?.code === "permission-denied") return "지금은 이 동작을 할 권한이 없습니다.";
  if (error?.code === "room/not-found") return "초성 탈출 방을 찾지 못했습니다.";
  return error?.message || "요청을 처리하지 못했습니다.";
}

async function withBusy(element, task) {
  if (state.busyElements.has(element)) return;
  state.busyElements.add(element);
  if (element) element.disabled = true;
  try { return await task(); }
  catch (error) { console.error(error); showToast(describeError(error)); }
  finally { state.busyElements.delete(element); if (element) element.disabled = false; renderRoom(); }
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
  history.replaceState({}, "", url);
}

function unsubscribeRoom() {
  state.unsubscribeRoom?.();
  state.unsubscribePlayers?.();
  state.unsubscribeGuesses?.();
  state.unsubscribeRoom = null;
  state.unsubscribePlayers = null;
  state.unsubscribeGuesses = null;
}

function showLanding(clearUrl = true) {
  unsubscribeRoom();
  state.roomId = "";
  state.room = null;
  state.players = [];
  state.roomLoaded = false;
  state.playersLoaded = false;
  state.secrets = new Map();
  state.secretsLoaded = false;
  state.questionFormLoaded = false;
  elements.landingView.hidden = false;
  elements.roomView.hidden = true;
  document.title = "초성 탈출 | 길드 오락실";
  if (clearUrl) updateRoomUrl();
  setLoading(false);
}

function currentPlayer() {
  return state.players.find((player) => player.uid === state.store?.user?.uid) || null;
}

function isHost() {
  return Boolean(state.room && state.room.ownerUid === state.store?.user?.uid);
}

function isEventEligible() {
  return !state.eventBridge || state.eventBridge.isEligible();
}

function syncChosungReadiness(player) {
  if (!state.eventBridge?.isEligible()) return;
  const uid = state.store?.user?.uid;
  if (state.room.status === "lobby") {
    state.eventBridge.setReadiness(player ? "ready" : "entering", player ? "게임 참가 준비 완료" : "참가 등록 중");
    return;
  }
  if (!state.room.activeUids.includes(uid)) {
    state.eventBridge.setReadiness("spectating", "초성 탈출 관전 중");
    return;
  }
  if (state.room.status === "answering") {
    const solved = state.room.solvedUids.includes(uid);
    state.eventBridge.setReadiness(solved ? "submitted" : "playing", solved ? "이번 문제 탈출 완료" : "정답 입력 중");
    return;
  }
  if (state.room.status === "revealed") {
    state.eventBridge.setReadiness("playing", "정답 확인 중");
    return;
  }
  state.eventBridge.setReadiness("finished", "최종 결과 확인 중");
}

function currentSecret() {
  return state.secrets.get(state.room?.currentQuestion) || "";
}

function enterRoom(roomId) {
  const normalizedId = core.normalizeRoomId(roomId);
  unsubscribeRoom();
  state.roomId = normalizedId;
  state.room = null;
  state.players = [];
  state.roomLoaded = false;
  state.playersLoaded = false;
  state.secrets = new Map();
  state.secretsLoaded = false;
  state.hostDataLoading = false;
  state.questionFormLoaded = false;
  state.pendingGuesses = [];
  state.processingGuessIds.clear();
  elements.landingView.hidden = true;
  elements.roomView.hidden = false;
  elements.roomCodeLabel.textContent = normalizedId;
  updateRoomUrl(normalizedId);
  setLoading(true, "초성 탈출 방에 들어가는 중…");

  state.unsubscribeRoom = state.store.subscribeRoom(normalizedId, (snapshot) => {
    state.roomLoaded = true;
    if (!snapshot) {
      showToast("해당 초성 탈출 방을 찾지 못했습니다.");
      showLanding();
      return;
    }
    const previousQuestion = state.room?.currentQuestion;
    state.room = snapshot.room;
    if (previousQuestion !== state.room.currentQuestion) {
      state.guessPending = false;
      state.guessCooldownUntil = 0;
    }
    ensureHostData();
    ensureEventPlayer();
    renderRoom();
    finishLoadingIfReady();
  }, handleSubscriptionError);

  state.unsubscribePlayers = state.store.subscribePlayers(normalizedId, (snapshot) => {
    state.playersLoaded = true;
    state.players = snapshot.players;
    ensureEventPlayer();
    renderRoom();
    finishLoadingIfReady();
  }, handleSubscriptionError);
}

function finishLoadingIfReady() {
  if (state.roomLoaded && state.playersLoaded && state.room) {
    setLoading(false);
    refreshConnection();
  }
}

function handleSubscriptionError(error) {
  console.error(error);
  setLoading(false);
  setConnection("error", "연결 확인 필요");
  showToast(describeError(error));
}

async function ensureEventPlayer() {
  if (!state.eventBridge || state.eventPlayerSaving || currentPlayer() || state.room?.status !== "lobby") return;
  if (!state.eventBridge.isEligible() || !state.eventBridge.participant) return;
  state.eventPlayerSaving = true;
  try { await state.store.savePlayer(state.room.id, state.eventBridge.participant.nickname); }
  catch (error) { showToast(describeError(error)); }
  finally { state.eventPlayerSaving = false; }
}

async function ensureHostData() {
  if (!isHost() || state.hostDataLoading) return;
  state.hostDataLoading = true;
  try {
    if (!state.secretsLoaded) {
      const secrets = await state.store.loadSecrets(state.room.id);
      state.secrets = new Map(secrets.map((item) => [Number(item.id.slice(1)) - 1, item.answer]));
      state.secretsLoaded = true;
      loadQuestionFormFromRoom();
    }
    if (!state.unsubscribeGuesses) {
      state.unsubscribeGuesses = state.store.subscribeGuesses(state.room.id, (guesses) => {
        state.pendingGuesses = guesses.filter((guess) => guess.status === "pending");
        processPendingGuesses();
      }, handleSubscriptionError);
    }
  } catch (error) {
    console.error(error);
    showToast(describeError(error));
  } finally {
    state.hostDataLoading = false;
  }
}

async function processPendingGuesses() {
  if (!isHost() || !state.secretsLoaded || state.room?.status !== "answering") return;
  const pending = state.pendingGuesses.filter((guess) => !state.processingGuessIds.has(guess.id));
  await Promise.all(pending.map(async (guess) => {
    state.processingGuessIds.add(guess.id);
    try {
      const answer = state.secrets.get(Number(guess.question));
      await state.store.resolveGuess(state.room.id, guess, core.answersMatch(guess.text, answer));
    } catch (error) {
      console.error(error);
    } finally {
      state.processingGuessIds.delete(guess.id);
    }
  }));
}

function questionRow(value = {}, index = 0) {
  const row = document.createElement("div");
  row.className = "question-row";
  row.innerHTML = `
    <b>Q${String(index + 1).padStart(2, "0")}</b>
    <label>카테고리<input class="question-category" maxlength="30" value=""></label>
    <label>정답<input class="question-answer" maxlength="30" value="" required></label>
    <label>마지막 설명 힌트<input class="question-description" maxlength="80" value="" required></label>
    <button class="remove-question" type="button" aria-label="${index + 1}번 문제 삭제">×</button>`;
  row.querySelector(".question-category").value = value.category || "";
  row.querySelector(".question-answer").value = value.answer || "";
  row.querySelector(".question-description").value = value.description || "";
  row.querySelector(".remove-question").addEventListener("click", () => {
    if (elements.questionList.children.length <= core.QUESTION_MIN) {
      showToast(`문제는 최소 ${core.QUESTION_MIN}개가 필요합니다.`);
      return;
    }
    row.remove();
    renumberQuestionRows();
  });
  return row;
}

function renumberQuestionRows() {
  Array.from(elements.questionList.children).forEach((row, index) => {
    row.querySelector("b").textContent = `Q${String(index + 1).padStart(2, "0")}`;
    row.querySelector(".remove-question").setAttribute("aria-label", `${index + 1}번 문제 삭제`);
  });
  elements.addQuestionButton.disabled = elements.questionList.children.length >= core.QUESTION_MAX;
}

function setQuestionRows(values) {
  const rows = values.length ? values : Array.from({ length: core.QUESTION_MIN }, () => ({}));
  elements.questionList.replaceChildren(...rows.map(questionRow));
  renumberQuestionRows();
}

function loadQuestionFormFromRoom() {
  if (!isHost() || state.questionFormLoaded) return;
  const values = state.room.questions.map((question, index) => ({
    category: question.category,
    description: question.description,
    answer: state.secrets.get(index) || "",
  }));
  setQuestionRows(values);
  state.questionFormLoaded = true;
}

function questionValues() {
  return Array.from(elements.questionList.children).map((row) => ({
    category: row.querySelector(".question-category").value,
    answer: row.querySelector(".question-answer").value,
    description: row.querySelector(".question-description").value,
  }));
}

function renderIdentity() {
  const player = currentPlayer();
  const roomOpen = state.room.status === "lobby" && isEventEligible();
  elements.playerForm.hidden = !roomOpen || Boolean(player);
  elements.myPlayer.hidden = !player;
  elements.identitySpectator.hidden = Boolean(player) || roomOpen;
  elements.identityTitle.textContent = player ? "내 탈출 정보" : roomOpen ? "참가자 등록" : "관전 화면";
  elements.identityBadge.textContent = player ? "참가 완료" : roomOpen ? "미등록" : "관전 중";
  if (!player) return;
  const index = state.players.findIndex((item) => item.uid === player.uid);
  elements.myAvatar.textContent = String(index + 1).padStart(2, "0");
  elements.myNickname.textContent = player.nickname;
  elements.myScore.textContent = String(player.score || 0);
}

function renderLobby() {
  elements.questionSetupForm.hidden = !isHost();
  elements.playerWaiting.hidden = isHost();
  if (isHost()) loadQuestionFormFromRoom();
}

function renderAnswering() {
  const room = state.room;
  const question = room.questions[room.currentQuestion];
  const clue = core.clueForStage(question, room.clueStage);
  const player = currentPlayer();
  const active = Boolean(player && room.activeUids.includes(player.uid));
  const solved = Boolean(player && room.solvedUids.includes(player.uid));
  elements.questionNumber.textContent = `QUESTION ${String(room.currentQuestion + 1).padStart(2, "0")} / ${String(room.totalQuestions).padStart(2, "0")}`;
  elements.availablePoints.textContent = `${core.pointsForStage(room.clueStage)}P`;
  elements.categoryLabel.textContent = question?.category || "카테고리";
  elements.clueLabel.textContent = clue.label;
  elements.clueDisplay.textContent = clue.hint;
  elements.clueDescription.textContent = clue.description;
  elements.clueSteps.querySelectorAll("i").forEach((step, index) => step.classList.toggle("active", index <= room.clueStage));
  elements.guessForm.hidden = !active || solved;
  elements.solvedBox.hidden = !solved;
  elements.spectatorBox.hidden = active;
  if (solved) elements.solvedPoints.textContent = `+${player.lastAwardPoints || core.pointsForStage(room.clueStage)}P`;
  const cooldown = Date.now() < state.guessCooldownUntil;
  const submit = elements.guessForm.querySelector("button");
  submit.disabled = state.guessPending || cooldown;
  submit.textContent = state.guessPending ? "판정 중…" : cooldown ? "잠시 후 재도전" : "구출 시도";
  const wrong = player?.lastQuestion === room.currentQuestion && player?.lastResult === "wrong" && !solved;
  elements.guessFeedback.hidden = !(state.guessPending || wrong);
  if (state.guessPending) elements.guessFeedback.textContent = "진행자가 정답을 확인하고 있어요…";
  else if (wrong) elements.guessFeedback.textContent = "아직 얼음이 깨지지 않았어요. 3초 후 다시 시도하세요!";
}

function renderRevealed() {
  elements.revealedAnswer.textContent = state.room.revealedAnswer || "정답";
  const solvers = state.room.solvedUids.map((uid) => state.players.find((player) => player.uid === uid)).filter(Boolean);
  elements.solverList.innerHTML = solvers.length
    ? solvers.map((player) => `<span>${escapeHtml(player.nickname)} +${player.lastQuestion === state.room.currentQuestion ? player.lastAwardPoints : 0}P</span>`).join("")
    : "<span>이번 문제 탈출자 없음</span>";
  elements.revealedWaiting.hidden = isHost();
}

function renderHostControls() {
  const host = isHost();
  elements.hostPanel.hidden = !host;
  if (!host) return;
  const status = state.room.status;
  elements.hostLobbyControls.hidden = status !== "lobby";
  elements.hostAnsweringControls.hidden = status !== "answering";
  elements.hostRevealedControls.hidden = status !== "revealed";
  elements.hostFinishedControls.hidden = status !== "finished";
  if (status === "lobby") {
    const ready = state.room.totalQuestions >= core.QUESTION_MIN && state.players.length > 0;
    elements.startGuide.textContent = `${state.room.totalQuestions}/${core.QUESTION_MIN}개 이상 문제 · ${state.players.length}명 참가`;
    elements.startGameButton.disabled = !ready || state.busyElements.has(elements.startGameButton);
    elements.startGameButton.textContent = ready ? `${state.players.length}명과 탈출 시작` : "문제와 참가자를 기다리는 중";
  } else if (status === "answering") {
    elements.hostProgress.textContent = `${state.room.solvedUids.length}/${state.room.activeUids.length}명이 정답을 구출했습니다.`;
    elements.nextClueButton.disabled = state.room.clueStage >= core.CLUE_STAGE_MAX || state.busyElements.has(elements.nextClueButton);
    elements.nextClueButton.textContent = state.room.clueStage >= core.CLUE_STAGE_MAX ? "마지막 힌트까지 공개됨" : `다음 힌트 공개 · ${core.pointsForStage(state.room.clueStage + 1)}P`;
  } else if (status === "revealed") {
    const last = state.room.currentQuestion + 1 >= state.room.totalQuestions;
    elements.nextQuestionButton.textContent = last ? "최종 결과 확정" : `문제 ${state.room.currentQuestion + 2} 시작`;
  }
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function renderScoreboard() {
  const ranked = core.rankPlayers(state.players);
  elements.playerCount.textContent = `${ranked.length}명`;
  elements.scoreboard.innerHTML = ranked.length ? ranked.map((player) => {
    const me = player.uid === state.store.user.uid;
    const solved = state.room.status === "answering" && state.room.solvedUids.includes(player.uid);
    return `<li class="${me ? "me" : ""} ${solved ? "solved" : ""}"><span class="rank">${player.rank}위</span><span class="name">${escapeHtml(player.nickname)}${solved ? " ✓" : ""}</span><strong class="score">${player.score || 0}P</strong></li>`;
  }).join("") : '<li class="empty">아직 참가자가 없어요.</li>';
}

function renderChampion() {
  const show = state.room.status === "finished";
  elements.championBanner.hidden = !show;
  if (!show) return;
  const ranked = core.rankPlayers(state.players);
  const leaders = ranked.filter((player) => player.rank === 1);
  elements.championNames.textContent = leaders.length ? leaders.map((player) => player.nickname).join(" · ") : "최종 우승자 없음";
  elements.championScore.textContent = `${leaders[0]?.score || 0}점`;
  if (state.eventBridge && state.players.length) {
    state.eventBridge.setFinishedResult(state.players.map((player) => ({
      uid: player.uid,
      nickname: player.nickname,
      metrics: [player.score],
      label: `${state.room.totalQuestions}문제 · 게임 점수 ${player.score || 0}점`,
    })), `${leaders.map((player) => player.nickname).join(" · ") || "탈출자 없음"} 최종 선두`);
  }
}

function renderRoom() {
  if (!state.room) return;
  document.title = `${state.room.title} | 초성 탈출`;
  elements.roomTitle.textContent = state.room.title;
  elements.roomCodeLabel.textContent = state.room.id;
  const labels = { lobby: "ESCAPE LOBBY", answering: "WORD FROZEN", revealed: "ANSWER REVEALED", finished: "ESCAPE COMPLETE" };
  elements.roomEyebrow.textContent = labels[state.room.status];
  elements.lobbyStage.hidden = state.room.status !== "lobby";
  elements.answeringStage.hidden = state.room.status !== "answering";
  elements.revealedStage.hidden = !["revealed", "finished"].includes(state.room.status);
  if (state.room.status === "lobby") renderLobby();
  if (state.room.status === "answering") renderAnswering();
  if (["revealed", "finished"].includes(state.room.status)) renderRevealed();
  const player = currentPlayer();
  renderIdentity();
  renderHostControls();
  renderScoreboard();
  renderChampion();
  syncChosungReadiness(player);
  refreshConnection();
}

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const roomId = await state.store.createRoom({ title: elements.roomTitleInput.value });
    enterRoom(roomId);
    showToast("새 초성 탈출 방을 만들었습니다.");
  });
});

elements.joinRoomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try { enterRoom(elements.roomCodeInput.value); }
  catch (error) { showToast(describeError(error)); }
});

elements.roomCodeInput.addEventListener("input", () => {
  elements.roomCodeInput.value = core.normalizeRoomId(elements.roomCodeInput.value).slice(0, 8);
});

elements.playerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    await state.store.savePlayer(state.room.id, elements.nicknameInput.value);
    showToast("탈출 참가 등록을 마쳤습니다.");
  });
});

elements.addQuestionButton.addEventListener("click", () => {
  if (elements.questionList.children.length >= core.QUESTION_MAX) return;
  elements.questionList.appendChild(questionRow({}, elements.questionList.children.length));
  renumberQuestionRows();
});

elements.questionSetupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const questions = core.normalizeQuestions(questionValues());
    await state.store.configureQuestions(state.room.id, questions);
    state.secrets = new Map(questions.map((question, index) => [index, question.answer]));
    state.secretsLoaded = true;
    showToast(`${questions.length}개의 문제를 얼음 속에 저장했습니다.`);
  });
});

elements.startGameButton.addEventListener("click", async () => {
  if (!window.confirm(`${state.players.length}명과 ${state.room.totalQuestions}문제 초성 탈출을 시작할까요?`)) return;
  await withBusy(elements.startGameButton, async () => {
    await state.store.startGame(state.room.id, state.players.map((player) => player.uid));
    await state.eventBridge?.markPlaying();
    showToast("첫 번째 단어가 얼어붙었습니다!");
  });
});

elements.guessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (Date.now() < state.guessCooldownUntil || state.guessPending) return;
  const value = elements.guessInput.value;
  state.guessPending = true;
  renderAnswering();
  try {
    await state.store.submitGuess(state.room.id, state.room.currentQuestion, state.room.clueStage, value);
    elements.guessInput.value = "";
    state.guessCooldownUntil = Date.now() + 3000;
    window.setTimeout(() => { state.guessPending = false; renderRoom(); }, 3100);
  } catch (error) {
    state.guessPending = false;
    showToast(describeError(error));
  }
});

elements.nextClueButton.addEventListener("click", () => withBusy(elements.nextClueButton, () => state.store.revealNextClue(state.room.id)));
elements.revealAnswerButton.addEventListener("click", async () => {
  if (!window.confirm("현재 정답을 공개하고 이 문제를 마칠까요?")) return;
  await withBusy(elements.revealAnswerButton, () => state.store.revealAnswer(state.room.id, currentSecret()));
});
elements.nextQuestionButton.addEventListener("click", async () => {
  const last = state.room.currentQuestion + 1 >= state.room.totalQuestions;
  await withBusy(elements.nextQuestionButton, () => last ? state.store.finishGame(state.room.id) : state.store.nextQuestion(state.room.id));
});

elements.shareButton.addEventListener("click", async () => {
  const url = eventRequest
    ? new URL(`../?event=${eventRequest.eventId}`, window.location.href).href
    : core.makeRoomUrl(window.location.href, state.room.id);
  try { await navigator.clipboard.writeText(url); showToast("초대 링크를 복사했습니다."); }
  catch (_error) { window.prompt("이 링크를 복사해 주세요.", url); }
});

elements.leaveButton.addEventListener("click", () => {
  if (eventRequest) location.href = `../?event=${eventRequest.eventId}&view=score`;
  else showLanding();
});

window.addEventListener("online", refreshConnection);
window.addEventListener("offline", refreshConnection);
window.addEventListener("pagehide", unsubscribeRoom);

async function initialize() {
  setConnection("loading", "연결 준비 중");
  setQuestionRows([]);
  try {
    state.store = await createChosungStore(firebaseConfig);
    if (eventRequest) {
      state.eventBridge = await createEventBridge(firebaseConfig, eventRequest, "chosung");
      if (!state.eventBridge.participant) throw new Error("이벤트 참가 등록을 먼저 완료해 주세요.");
      elements.nicknameInput.value = state.eventBridge.participant.nickname;
      elements.nicknameInput.readOnly = true;
      document.querySelector(".back-link").href = `../?event=${eventRequest.eventId}&view=score`;
    }
    setConnection("online", "실시간 연결됨");
    const requestedRoom = new URL(window.location.href).searchParams.get("room");
    if (requestedRoom) enterRoom(requestedRoom);
    else showLanding(false);
  } catch (error) {
    console.error(error);
    setConnection("error", "연결 실패");
    setLoading(false);
    showToast(describeError(error));
  }
}

initialize();
