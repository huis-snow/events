import { createMinorityStore } from "./firebase-store.js?v=20260829-minority";
import { createEventBridge, eventRequestFromUrl } from "../event-bridge.js?v=20260829-read-opt";
import { attachBackgroundMusic } from "../background-music.js?v=20260829-bgm";

const core = globalThis.MinoritySurvivalCore;
const firebaseConfig = globalThis.GuildEventsFirebaseConfig;
const eventRequest = eventRequestFromUrl();
if (!core) throw new Error("소수결 생존 규칙 모듈을 불러오지 못했습니다.");

const ids = [
  "landingView", "roomView", "createRoomForm", "roomTitleInput", "choiceSecondsSelect",
  "joinRoomForm", "roomCodeInput", "connectionState", "roomEyebrow", "roomTitle", "roomCodeLabel",
  "shareButton", "leaveButton", "championBanner", "championNames", "championScore", "lobbyStage",
  "questionSetupForm", "playerWaiting", "questionList", "addQuestionButton", "votingStage", "roundNumber",
  "roundTimer", "roundTimerValue", "roundTimerLabel", "submissionCount", "currentPrompt", "choiceGrid",
  "optionALabel", "optionBLabel", "confirmChoiceButton", "submittedBox", "submittedChoiceLabel",
  "spectatorBox", "revealedStage", "resultTitle", "resultDescription", "resultA", "resultB", "resultALabel",
  "resultBLabel", "resultACount", "resultBCount", "survivorList", "revealedWaiting", "identityTitle",
  "identityBadge", "playerForm", "nicknameInput", "myPlayer", "myAvatar", "myNickname", "myScore",
  "identitySpectator", "hostPanel", "hostLobbyControls", "startGuide", "startGameButton",
  "hostVotingControls", "hostProgress", "revealButton", "hostRevealedControls", "futureQuestionForm",
  "futurePromptInput", "futureOptionAInput", "futureOptionBInput", "nextRoundButton", "hostFinishedControls",
  "playerCount", "scoreboard", "loadingCover", "loadingMessage", "toast",
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const state = {
  store: null,
  eventBridge: null,
  roomId: "",
  room: null,
  players: [],
  questions: [],
  roomLoaded: false,
  playersLoaded: false,
  questionsLoaded: false,
  hostDataLoading: false,
  questionFormLoaded: false,
  futureEditorRound: 0,
  selectedSide: "",
  ownChoice: null,
  ownChoiceLoadingRound: 0,
  unsubscribeRoom: null,
  unsubscribePlayers: null,
  countdownTimer: 0,
  autoRevealKey: "",
  eventPlayerSaving: false,
  toastTimer: 0,
  busyElements: new Set(),
};

attachBackgroundMusic({
  source: "../assets/audio/next-game-lounge.mp3",
  button: document.getElementById("soundToggleButton"),
  label: document.getElementById("soundToggleLabel"),
  volume: 0.04,
});

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

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
  state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3000);
}

function describeError(error) {
  if (error?.code === "permission-denied") return "이 작업을 할 권한이 없거나 라운드 상태가 이미 바뀌었습니다.";
  if (error?.code === "room/not-found") return "소수결 생존 방을 찾지 못했습니다.";
  if (error?.code === "choice/already-submitted") return "이번 선택은 이미 확정했습니다.";
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
  state.unsubscribeRoom = null;
  state.unsubscribePlayers = null;
}

function stopCountdown() {
  window.clearInterval(state.countdownTimer);
  state.countdownTimer = 0;
}

function showLanding(clearUrl = true) {
  unsubscribeRoom();
  stopCountdown();
  state.roomId = "";
  state.room = null;
  state.players = [];
  state.questions = [];
  state.roomLoaded = false;
  state.playersLoaded = false;
  state.questionsLoaded = false;
  state.questionFormLoaded = false;
  state.selectedSide = "";
  state.ownChoice = null;
  elements.landingView.hidden = false;
  elements.roomView.hidden = true;
  document.title = "소수결 생존 | 길드 오락실";
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

function syncReadiness(player) {
  if (!state.eventBridge?.isEligible()) return;
  const uid = state.store?.user?.uid;
  if (state.room.status !== "lobby") void state.eventBridge.markPlaying();
  if (state.room.status === "lobby") {
    state.eventBridge.setReadiness(player ? "ready" : "entering", player ? "생존 게임 참가 준비 완료" : "참가 등록 중");
  } else if (!state.room.activeUids.includes(uid)) {
    state.eventBridge.setReadiness("spectating", "소수결 생존 관전 중");
  } else if (state.room.status === "voting") {
    const submitted = state.room.submittedUids.includes(uid);
    state.eventBridge.setReadiness(submitted ? "submitted" : "playing", submitted ? "선택 제출 완료" : "A/B 선택 중");
  } else if (state.room.status === "revealed") {
    state.eventBridge.setReadiness("playing", "소수결 결과 확인 중");
  } else {
    state.eventBridge.setReadiness("finished", "최종 결과 확인 중");
  }
}

function enterRoom(roomId) {
  const normalizedId = core.normalizeRoomId(roomId);
  unsubscribeRoom();
  stopCountdown();
  state.roomId = normalizedId;
  state.room = null;
  state.players = [];
  state.questions = [];
  state.roomLoaded = false;
  state.playersLoaded = false;
  state.questionsLoaded = false;
  state.hostDataLoading = false;
  state.questionFormLoaded = false;
  state.futureEditorRound = 0;
  state.selectedSide = "";
  state.ownChoice = null;
  state.ownChoiceLoadingRound = 0;
  state.autoRevealKey = "";
  elements.landingView.hidden = true;
  elements.roomView.hidden = false;
  elements.roomCodeLabel.textContent = normalizedId;
  updateRoomUrl(normalizedId);
  setLoading(true, "소수결 생존 방에 들어가는 중…");

  state.unsubscribeRoom = state.store.subscribeRoom(normalizedId, (snapshot) => {
    state.roomLoaded = true;
    if (!snapshot) {
      showToast("해당 소수결 생존 방을 찾지 못했습니다.");
      showLanding();
      return;
    }
    const previousRound = state.room?.currentRound;
    const previousStatus = state.room?.status;
    state.room = snapshot.room;
    if (previousRound !== state.room.currentRound) {
      state.selectedSide = "";
      state.ownChoice = null;
      state.ownChoiceLoadingRound = 0;
      state.autoRevealKey = "";
      state.futureEditorRound = 0;
    }
    if (previousStatus === "voting" && state.room.status !== "voting") stopCountdown();
    ensureHostQuestions();
    ensureOwnChoice();
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

async function ensureHostQuestions() {
  if (!isHost() || state.hostDataLoading || state.questionsLoaded) return;
  state.hostDataLoading = true;
  try {
    state.questions = await state.store.loadQuestions(state.room.id);
    state.questionsLoaded = true;
    loadQuestionForm();
  } catch (error) {
    console.error(error);
    showToast(describeError(error));
  } finally {
    state.hostDataLoading = false;
  }
}

async function ensureOwnChoice() {
  const uid = state.store?.user?.uid;
  if (!uid || state.room?.status !== "voting" || !state.room.submittedUids.includes(uid)) return;
  if (state.ownChoice?.round === state.room.currentRound || state.ownChoiceLoadingRound === state.room.currentRound) return;
  const round = state.room.currentRound;
  state.ownChoiceLoadingRound = round;
  try {
    const choice = await state.store.getOwnChoice(state.room.id);
    if (state.room?.currentRound === round && Number(choice?.round) === round) state.ownChoice = choice;
  } catch (error) { console.error(error); }
  finally { if (state.ownChoiceLoadingRound === round) state.ownChoiceLoadingRound = 0; renderRoom(); }
}

function questionRow(value = {}, index = 0) {
  const row = document.createElement("div");
  row.className = "question-row";
  row.innerHTML = `<b>Q${String(index + 1).padStart(2, "0")}</b><label>질문<input class="question-prompt" maxlength="60" required></label><label>A 선택지<input class="question-a" maxlength="24" required></label><label>B 선택지<input class="question-b" maxlength="24" required></label><button class="remove-question" type="button" aria-label="${index + 1}번 질문 삭제">×</button>`;
  row.querySelector(".question-prompt").value = value.prompt || "";
  row.querySelector(".question-a").value = value.optionA || "";
  row.querySelector(".question-b").value = value.optionB || "";
  row.querySelector(".remove-question").addEventListener("click", () => {
    if (elements.questionList.children.length <= core.QUESTION_MIN) {
      showToast(`질문은 최소 ${core.QUESTION_MIN}개가 필요합니다.`);
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
    row.querySelector(".remove-question").setAttribute("aria-label", `${index + 1}번 질문 삭제`);
  });
  elements.addQuestionButton.disabled = elements.questionList.children.length >= core.QUESTION_MAX;
}

function setQuestionRows(values) {
  const rows = values.length ? values : Array.from({ length: core.QUESTION_MIN }, () => ({}));
  elements.questionList.replaceChildren(...rows.map(questionRow));
  renumberQuestionRows();
}

function loadQuestionForm() {
  if (!isHost() || state.questionFormLoaded) return;
  setQuestionRows(state.questions);
  state.questionFormLoaded = true;
}

function questionValues() {
  return Array.from(elements.questionList.children).map((row) => ({
    prompt: row.querySelector(".question-prompt").value,
    optionA: row.querySelector(".question-a").value,
    optionB: row.querySelector(".question-b").value,
  }));
}

function renderIdentity() {
  const player = currentPlayer();
  const open = state.room.status === "lobby" && isEventEligible();
  elements.playerForm.hidden = !open || Boolean(player);
  elements.myPlayer.hidden = !player;
  elements.identitySpectator.hidden = Boolean(player) || open;
  elements.identityTitle.textContent = player ? "내 생존 정보" : open ? "참가자 등록" : "관전 화면";
  elements.identityBadge.textContent = player ? "참가 완료" : open ? "미등록" : "관전 중";
  if (!player) return;
  elements.myAvatar.textContent = String(state.players.findIndex((item) => item.uid === player.uid) + 1).padStart(2, "0");
  elements.myNickname.textContent = player.nickname;
  elements.myScore.textContent = String(player.score || 0);
}

function renderLobby() {
  elements.questionSetupForm.hidden = !isHost();
  elements.playerWaiting.hidden = isHost();
  if (isHost()) loadQuestionForm();
}

function choiceTimeRemaining() {
  const deadline = core.choiceDeadlineMillis(state.room);
  return deadline ? Math.max(0, deadline - Date.now()) : null;
}

function triggerAutoReveal() {
  if (!isHost() || state.room?.status !== "voting") return;
  const allSubmitted = state.room.activeUids.length > 0 && state.room.submittedUids.length >= state.room.activeUids.length;
  const expired = choiceTimeRemaining() === 0;
  if (!allSubmitted && !expired) return;
  const key = `${state.room.id}:${state.room.currentRound}`;
  if (state.autoRevealKey === key) return;
  state.autoRevealKey = key;
  window.setTimeout(async () => {
    try { await state.store.revealRound(state.room.id); }
    catch (error) {
      console.error(error);
      window.setTimeout(() => {
        if (state.room?.status === "voting" && state.autoRevealKey === key) {
          state.autoRevealKey = "";
          triggerAutoReveal();
        }
      }, 1000);
    }
  }, allSubmitted ? 550 : 0);
}

function updateCountdown() {
  if (state.room?.status !== "voting") { stopCountdown(); return; }
  const remaining = choiceTimeRemaining();
  const seconds = remaining === null ? state.room.choiceSeconds : Math.max(0, Math.ceil(remaining / 1000));
  elements.roundTimerValue.textContent = String(seconds);
  elements.roundTimerLabel.textContent = seconds <= 0 ? "결과 공개 중" : seconds <= 5 ? "선택을 확정하세요!" : "선택 남은 시간";
  elements.roundTimer.dataset.urgent = String(seconds <= 5);
  if (seconds <= 0) {
    elements.confirmChoiceButton.disabled = true;
    elements.choiceGrid.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  }
  triggerAutoReveal();
}

function syncCountdown() {
  updateCountdown();
  if (!state.countdownTimer && state.room?.status === "voting") {
    state.countdownTimer = window.setInterval(updateCountdown, 250);
  }
}

function renderVoting() {
  const room = state.room;
  const player = currentPlayer();
  const active = Boolean(player && room.activeUids.includes(player.uid));
  const submitted = Boolean(player && room.submittedUids.includes(player.uid));
  const closed = choiceTimeRemaining() === 0;
  elements.roundNumber.textContent = `ROUND ${String(room.currentRound).padStart(2, "0")} / ${String(room.totalRounds).padStart(2, "0")}`;
  elements.submissionCount.textContent = `${room.submittedUids.length} / ${room.activeUids.length}`;
  elements.currentPrompt.textContent = room.currentPrompt;
  elements.optionALabel.textContent = room.optionA;
  elements.optionBLabel.textContent = room.optionB;
  elements.choiceGrid.hidden = !active || submitted;
  elements.confirmChoiceButton.hidden = !active || submitted;
  elements.submittedBox.hidden = !submitted;
  elements.spectatorBox.hidden = active;
  elements.choiceGrid.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", state.selectedSide === button.dataset.side);
    button.disabled = closed;
  });
  elements.confirmChoiceButton.disabled = !state.selectedSide || closed || state.busyElements.has(elements.confirmChoiceButton);
  elements.confirmChoiceButton.textContent = state.selectedSide ? `${state.selectedSide} · ${state.selectedSide === "A" ? room.optionA : room.optionB} 확정` : "선택을 먼저 골라 주세요";
  if (submitted) {
    const ownSide = state.ownChoice?.round === room.currentRound ? state.ownChoice.side : "";
    elements.submittedChoiceLabel.textContent = ownSide ? `${ownSide} · ${ownSide === "A" ? room.optionA : room.optionB} 선택 완료` : "내 선택을 안전하게 저장했습니다";
  }
  syncCountdown();
}

function renderResult() {
  const room = state.room;
  const submitted = room.countA + room.countB;
  const rare = room.resultKind === "A" ? room.countA * 4 <= submitted : room.resultKind === "B" ? room.countB * 4 <= submitted : false;
  if (room.resultKind === "TIE") {
    elements.resultTitle.textContent = "완벽한 동률! 모두 생존";
    elements.resultDescription.textContent = "제출한 모두가 1점을 받습니다.";
  } else if (room.resultKind === "NONE") {
    elements.resultTitle.textContent = "만장일치! 생존자 없음";
    elements.resultDescription.textContent = "한쪽에만 몰려 이번 라운드는 0점입니다.";
  } else {
    const option = room.resultKind === "A" ? room.optionA : room.optionB;
    elements.resultTitle.textContent = `${room.resultKind} · ${option} 생존`;
    elements.resultDescription.textContent = rare ? "전체의 25% 이하만 고른 희귀 생존! 3점을 받습니다." : "더 적게 고른 참가자들이 2점을 받습니다.";
  }
  elements.resultALabel.textContent = room.optionA;
  elements.resultBLabel.textContent = room.optionB;
  elements.resultACount.textContent = `${room.countA}명`;
  elements.resultBCount.textContent = `${room.countB}명`;
  elements.resultA.classList.toggle("winner", room.resultKind === "A" || room.resultKind === "TIE");
  elements.resultB.classList.toggle("winner", room.resultKind === "B" || room.resultKind === "TIE");
  const max = Math.max(room.countA, room.countB, 1);
  elements.resultA.querySelector("i").style.height = `${Math.round(room.countA / max * 100)}%`;
  elements.resultB.querySelector("i").style.height = `${Math.round(room.countB / max * 100)}%`;
  const winners = Object.entries(room.lastAwardPoints)
    .filter(([, points]) => Number(points) > 0)
    .map(([uid, points]) => ({ player: state.players.find((item) => item.uid === uid), points: Number(points) }))
    .filter((entry) => entry.player);
  elements.survivorList.innerHTML = winners.length
    ? winners.map(({ player, points }) => `<span>${escapeHtml(player.nickname)} +${points}P</span>`).join("")
    : "<span>이번 라운드 생존자 없음</span>";
  elements.revealedWaiting.hidden = isHost();
}

function populateFutureEditor() {
  const nextRound = state.room.currentRound + 1;
  const question = state.questions.find((item) => Number(item.order) === nextRound);
  if (!question || state.futureEditorRound === nextRound) return;
  elements.futurePromptInput.value = question.prompt || "";
  elements.futureOptionAInput.value = question.optionA || "";
  elements.futureOptionBInput.value = question.optionB || "";
  state.futureEditorRound = nextRound;
}

function renderHostControls() {
  const host = isHost();
  elements.hostPanel.hidden = !host;
  if (!host) return;
  const status = state.room.status;
  elements.hostLobbyControls.hidden = status !== "lobby";
  elements.hostVotingControls.hidden = status !== "voting";
  elements.hostRevealedControls.hidden = status !== "revealed";
  elements.hostFinishedControls.hidden = status !== "finished";
  if (status === "lobby") {
    const ready = state.room.totalRounds >= core.QUESTION_MIN && state.players.length >= 3;
    elements.startGuide.textContent = `${state.room.totalRounds}/${core.QUESTION_MIN}개 이상 질문 · ${state.players.length}/3명 이상 참가`;
    elements.startGameButton.disabled = !ready || state.busyElements.has(elements.startGameButton);
    elements.startGameButton.textContent = ready ? `${state.players.length}명과 생존 시작` : "질문과 참가자를 기다리는 중";
  } else if (status === "voting") {
    elements.hostProgress.textContent = `${state.room.submittedUids.length}/${state.room.activeUids.length}명이 선택을 확정했습니다. 선택 내용은 공개할 때까지 숨겨집니다.`;
    elements.revealButton.disabled = state.busyElements.has(elements.revealButton);
  } else if (status === "revealed") {
    const last = state.room.currentRound >= state.room.totalRounds;
    elements.futureQuestionForm.hidden = last;
    elements.nextRoundButton.textContent = last ? "최종 결과 확정" : `라운드 ${state.room.currentRound + 1} 시작`;
    if (!last) populateFutureEditor();
  }
}

function renderScoreboard() {
  const ranked = core.rankPlayers(state.players);
  elements.playerCount.textContent = `${ranked.length}명`;
  elements.scoreboard.innerHTML = ranked.length ? ranked.map((player) => {
    const me = player.uid === state.store.user.uid;
    const submitted = state.room.status === "voting" && state.room.submittedUids.includes(player.uid);
    const status = submitted ? "선택 완료" : state.room.status === "voting" && state.room.activeUids.includes(player.uid) ? "선택 중" : `${player.survivalWins || 0}회 생존 · 희귀 ${player.rareWins || 0}회`;
    return `<li class="${me ? "me" : ""} ${submitted ? "submitted" : ""}"><span class="rank">${player.rank}위</span><span class="name">${escapeHtml(player.nickname)}<small>${status}</small></span><strong class="score">${player.score || 0}P</strong></li>`;
  }).join("") : '<li class="empty">아직 참가자가 없어요.</li>';
}

function renderChampion() {
  const show = state.room.status === "finished";
  elements.championBanner.hidden = !show;
  if (!show) return;
  const ranked = core.rankPlayers(state.players);
  const leaders = ranked.filter((player) => player.rank === 1);
  elements.championNames.textContent = leaders.length ? leaders.map((player) => player.nickname).join(" · ") : "최종 생존자 없음";
  elements.championScore.textContent = `${leaders[0]?.score || 0}점`;
  if (state.eventBridge && state.players.length) {
    state.eventBridge.setFinishedResult(state.players.map((player) => ({
      uid: player.uid,
      nickname: player.nickname,
      metrics: [player.score, player.rareWins, player.survivalWins],
      label: `${state.room.totalRounds}라운드 · 생존 점수 ${player.score || 0}점`,
    })), `${leaders.map((player) => player.nickname).join(" · ") || "생존자 없음"} 최종 선두`);
  }
}

function renderRoom() {
  if (!state.room) return;
  document.title = `${state.room.title} | 소수결 생존`;
  elements.roomTitle.textContent = state.room.title;
  elements.roomCodeLabel.textContent = state.room.id;
  const labels = { lobby: "SURVIVAL LOBBY", voting: "SECRET VOTE", revealed: "VOTE REVEALED", finished: "SURVIVAL COMPLETE" };
  elements.roomEyebrow.textContent = labels[state.room.status];
  elements.lobbyStage.hidden = state.room.status !== "lobby";
  elements.votingStage.hidden = state.room.status !== "voting";
  elements.revealedStage.hidden = !["revealed", "finished"].includes(state.room.status);
  if (state.room.status === "lobby") renderLobby();
  if (state.room.status === "voting") renderVoting();
  if (["revealed", "finished"].includes(state.room.status)) { stopCountdown(); renderResult(); }
  const player = currentPlayer();
  renderIdentity();
  renderHostControls();
  renderScoreboard();
  renderChampion();
  syncReadiness(player);
  refreshConnection();
}

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const roomId = await state.store.createRoom({ title: elements.roomTitleInput.value, choiceSeconds: elements.choiceSecondsSelect.value });
    enterRoom(roomId);
    showToast("새 소수결 생존 방을 만들었습니다.");
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
    showToast("생존 참가 등록을 마쳤습니다.");
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
    state.questions = questions.map((question, index) => ({ ...question, order: index + 1 }));
    state.questionsLoaded = true;
    showToast(`${questions.length}개의 A/B 질문을 저장했습니다.`);
  });
});

elements.startGameButton.addEventListener("click", async () => {
  if (!window.confirm(`${state.players.length}명과 ${state.room.totalRounds}라운드를 시작할까요? 각 선택 시간은 ${state.room.choiceSeconds}초입니다.`)) return;
  await withBusy(elements.startGameButton, async () => {
    await state.store.startGame(state.room.id, state.players.map((player) => player.uid));
    void state.eventBridge?.markPlaying();
    showToast("첫 번째 비밀 투표를 시작합니다!");
  });
});

elements.choiceGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-side]");
  if (!button || button.disabled) return;
  state.selectedSide = button.dataset.side;
  renderVoting();
});

elements.confirmChoiceButton.addEventListener("click", () => withBusy(elements.confirmChoiceButton, async () => {
  const side = state.selectedSide;
  await state.store.submitChoice(state.room.id, state.room.currentRound, side);
  state.ownChoice = { round: state.room.currentRound, side };
  showToast("선택을 확정했습니다. 공개 전까지 비밀이에요.");
}));

elements.revealButton.addEventListener("click", () => withBusy(elements.revealButton, () => state.store.revealRound(state.room.id)));

elements.futureQuestionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  withBusy(event.submitter, async () => {
    const round = state.room.currentRound + 1;
    const question = core.normalizeQuestion({
      prompt: elements.futurePromptInput.value,
      optionA: elements.futureOptionAInput.value,
      optionB: elements.futureOptionBInput.value,
    });
    await state.store.updateFutureQuestion(state.room.id, round, question);
    const index = state.questions.findIndex((item) => Number(item.order) === round);
    if (index >= 0) state.questions[index] = { ...state.questions[index], ...question };
    showToast("다음 질문을 수정했습니다.");
  });
});

elements.nextRoundButton.addEventListener("click", () => withBusy(elements.nextRoundButton, async () => {
  const last = state.room.currentRound >= state.room.totalRounds;
  if (last) await state.store.finishGame(state.room.id);
  else await state.store.nextRound(state.room.id);
}));

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
    state.store = await createMinorityStore(firebaseConfig);
    if (eventRequest) {
      state.eventBridge = await createEventBridge(firebaseConfig, eventRequest, "minority");
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
