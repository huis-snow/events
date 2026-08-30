import { createTimingStore } from "./firebase-store.js?v=20260830-concurrency";
import { createEventBridge, eventRequestFromUrl } from "../event-bridge.js?v=20260830-practice";
import { attachBackgroundMusic } from "../background-music.js?v=20260829-bgm";

const core = globalThis.NowTimingCore;
const firebaseConfig = globalThis.GuildEventsFirebaseConfig;
const eventRequest = eventRequestFromUrl();
if (!core) throw new Error("지금이다! 규칙 모듈을 불러오지 못했습니다.");

const ids = [
  "landingView", "roomView", "createRoomForm", "roomTitleInput", "roundsSelect", "joinRoomForm",
  "roomCodeInput", "connectionState", "roomEyebrow", "roomTitle", "roomCodeLabel", "shareButton",
  "leaveButton", "championBanner", "championNames", "championScore", "lobbyStage", "playerWaiting",
  "timingStage", "roundNumber", "submissionCount", "targetSeconds", "timerDisplay", "timerPhaseLabel",
  "timerValue", "stopButton", "submittedBox", "submittedTime", "spectatorBox", "resultStage",
  "resultTarget", "attemptList", "resultWaiting", "identityTitle", "identityBadge", "playerForm",
  "nicknameInput", "myPlayer", "myAvatar", "myNickname", "myScore", "identitySpectator", "hostPanel",
  "hostLobbyControls", "startGuide", "startGameButton", "hostRunningControls", "hostProgress",
  "revealButton", "hostRevealedControls", "nextRoundButton", "hostFinishedControls", "playerCount",
  "scoreboard", "loadingCover", "loadingMessage", "toast",
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const state = {
  store: null,
  eventBridge: null,
  roomId: "",
  room: null,
  players: [],
  ownAttempt: null,
  ownAttemptLoadingRound: 0,
  roomLoaded: false,
  playersLoaded: false,
  eventPlayerSaving: false,
  unsubscribeRoom: null,
  unsubscribePlayers: null,
  animationFrame: 0,
  autoRevealKey: "",
  toastTimer: 0,
  busyElements: new Set(),
};

attachBackgroundMusic({
  source: "../assets/audio/next-game-lounge.mp3",
  button: document.getElementById("soundToggleButton"),
  label: document.getElementById("soundToggleLabel"),
  volume: 0.035,
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
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3200);
}

function describeError(error) {
  if (error?.code === "permission-denied") return "이 작업을 할 권한이 없거나 라운드 상태가 이미 바뀌었습니다.";
  if (error?.code === "room/not-found") return "지금이다! 방을 찾지 못했습니다.";
  if (error?.code === "attempt/already-submitted") return "이번 기록은 이미 확정했습니다.";
  if (error?.code === "attempt/not-started") return "아직 타이머가 시작되지 않았습니다.";
  if (error?.code === "attempt/closed") return "이번 라운드의 기록 시간이 끝났습니다.";
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
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = 0;
}

function showLanding(clearUrl = true) {
  unsubscribeRoom();
  state.roomId = "";
  state.room = null;
  state.players = [];
  state.ownAttempt = null;
  state.roomLoaded = false;
  state.playersLoaded = false;
  elements.landingView.hidden = false;
  elements.roomView.hidden = true;
  document.title = "지금이다! | 길드 오락실";
  if (clearUrl) updateRoomUrl();
  setLoading(false);
}

function currentPlayer() {
  return state.players.find((player) => player.uid === state.store?.user?.uid) || null;
}

function isHost() {
  return Boolean(state.room && state.room.ownerUid === state.store?.user?.uid);
}

function syncReadiness(player) {
  if (!state.eventBridge?.isEligible()) return;
  const uid = state.store?.user?.uid;
  if (state.room.status !== "lobby") void state.eventBridge.markPlaying();
  if (state.room.status === "lobby") {
    state.eventBridge.setReadiness(player ? "ready" : "entering", player ? "지금이다! 참가 준비 완료" : "참가 등록 중");
  } else if (!state.room.activeUids.includes(uid)) {
    state.eventBridge.setReadiness("spectating", "지금이다! 관전 중");
  } else if (state.room.status === "running") {
    const submitted = state.room.submittedUids.includes(uid);
    state.eventBridge.setReadiness(submitted ? "submitted" : "playing", submitted ? "타이밍 기록 완료" : "목표 시간 측정 중");
  } else if (state.room.status === "revealed") {
    state.eventBridge.setReadiness("playing", "타이밍 결과 확인 중");
  } else {
    state.eventBridge.setReadiness("finished", "최종 결과 확인 중");
  }
}

function enterRoom(roomId) {
  const normalizedId = core.normalizeRoomId(roomId);
  if (!core.isValidRoomId(normalizedId)) throw new Error("8자리 방 코드를 확인해 주세요.");
  unsubscribeRoom();
  state.roomId = normalizedId;
  state.room = null;
  state.players = [];
  state.ownAttempt = null;
  state.ownAttemptLoadingRound = 0;
  state.roomLoaded = false;
  state.playersLoaded = false;
  state.autoRevealKey = "";
  elements.landingView.hidden = true;
  elements.roomView.hidden = false;
  elements.roomCodeLabel.textContent = normalizedId;
  updateRoomUrl(normalizedId);
  setLoading(true, "지금이다! 방에 들어가는 중…");

  state.unsubscribeRoom = state.store.subscribeRoom(normalizedId, (snapshot) => {
    state.roomLoaded = true;
    if (!snapshot) {
      showToast("해당 지금이다! 방을 찾지 못했습니다.");
      showLanding();
      return;
    }
    const previousRound = state.room?.round;
    const previousStatus = state.room?.status;
    state.room = snapshot.room;
    if (previousRound !== state.room.round) {
      state.ownAttempt = null;
      state.ownAttemptLoadingRound = 0;
      state.autoRevealKey = "";
    }
    if (previousStatus === "running" && state.room.status !== "running") state.autoRevealKey = "";
    ensureOwnAttempt();
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

async function ensureOwnAttempt() {
  const uid = state.store?.user?.uid;
  if (!uid || state.room?.status !== "running" || !state.room.submittedUids.includes(uid)) return;
  if (Number(state.ownAttempt?.round) === state.room.round || state.ownAttemptLoadingRound === state.room.round) return;
  state.ownAttemptLoadingRound = state.room.round;
  try { state.ownAttempt = await state.store.getOwnAttempt(state.room.id); }
  catch (error) { console.error(error); }
  finally { state.ownAttemptLoadingRound = 0; renderRoom(); }
}

function renderIdentity() {
  const player = currentPlayer();
  const canRegister = state.room.status === "lobby";
  elements.playerForm.hidden = Boolean(player) || !canRegister;
  elements.myPlayer.hidden = !player;
  elements.identitySpectator.hidden = Boolean(player) || canRegister;
  elements.identityTitle.textContent = player ? "내 참가 정보" : canRegister ? "참가자 등록" : "관전 중";
  elements.identityBadge.textContent = player ? "참가 중" : canRegister ? "미등록" : "관전";
  if (player) {
    const index = Math.max(0, state.players.findIndex((item) => item.uid === player.uid));
    elements.myAvatar.textContent = String(index + 1).padStart(2, "0");
    elements.myNickname.textContent = player.nickname;
    elements.myScore.textContent = player.score || 0;
  }
}

function renderLobby() {
  const ready = state.players.length >= 2;
  elements.playerWaiting.textContent = isHost()
    ? ready ? `${state.players.length}명이 준비됐습니다. 시작하면 3초 뒤 첫 타이머가 움직여요.` : `현재 ${state.players.length}명 · 2명 이상 모이면 시작할 수 있어요.`
    : "진행자가 참가자를 확인하고 있습니다.";
}

function timingFrame() {
  state.animationFrame = 0;
  if (state.room?.status !== "running") return;
  renderTimer(Date.now());
  state.animationFrame = requestAnimationFrame(timingFrame);
}

function ensureTimingFrame() {
  if (!state.animationFrame && state.room?.status === "running") state.animationFrame = requestAnimationFrame(timingFrame);
}

function triggerAutoReveal(now) {
  if (!isHost() || state.room?.status !== "running") return;
  const allSubmitted = state.room.activeUids.length > 0 && state.room.submittedUids.length >= state.room.activeUids.length;
  const expired = now >= core.roundDeadlineMillis(state.room);
  if (!allSubmitted && !expired) return;
  const key = `${state.room.id}:${state.room.round}`;
  if (state.autoRevealKey === key) return;
  state.autoRevealKey = key;
  state.store.revealRound(state.room.id).catch((error) => {
    console.error(error);
    state.autoRevealKey = "";
    if (!['room/bad-state', 'permission-denied'].includes(error?.code)) showToast(describeError(error));
  });
}

function renderTimer(now) {
  const room = state.room;
  if (!room || room.status !== "running") return;
  const timer = core.timingState(room, now);
  const player = currentPlayer();
  const active = Boolean(player && room.activeUids.includes(player.uid));
  const submitted = Boolean(player && room.submittedUids.includes(player.uid));
  elements.timerDisplay.dataset.phase = timer.phase;
  if (timer.phase === "prepare") {
    elements.timerPhaseLabel.textContent = "준비하세요";
    elements.timerValue.textContent = String(Math.max(1, Math.ceil(timer.prepareMillis / 1000)));
  } else if (timer.phase === "visible") {
    elements.timerPhaseLabel.textContent = "시계를 기억하세요";
    elements.timerValue.textContent = core.formatElapsed(timer.elapsedMillis);
  } else if (timer.phase === "partial") {
    elements.timerPhaseLabel.textContent = "소수점이 사라졌어요";
    elements.timerValue.textContent = core.formatPartialElapsed(timer.elapsedMillis);
  } else if (timer.phase === "hidden") {
    elements.timerPhaseLabel.textContent = "이제 감으로 누르세요!";
    elements.timerValue.textContent = "?.??";
  } else if (timer.phase === "closed") {
    elements.timerPhaseLabel.textContent = "기록 마감";
    elements.timerValue.textContent = "--.--";
  } else {
    elements.timerPhaseLabel.textContent = "타이머 동기화 중";
    elements.timerValue.textContent = "0.00";
  }
  elements.stopButton.disabled = !active || submitted || !["visible", "partial", "hidden"].includes(timer.phase) || state.busyElements.has(elements.stopButton);
  triggerAutoReveal(now);
}

function renderTiming() {
  const room = state.room;
  const player = currentPlayer();
  const active = Boolean(player && room.activeUids.includes(player.uid));
  const submitted = Boolean(player && room.submittedUids.includes(player.uid));
  elements.roundNumber.textContent = `ROUND ${String(room.round).padStart(2, "0")} / ${String(room.totalRounds).padStart(2, "0")}`;
  elements.submissionCount.textContent = `${room.submittedUids.length} / ${room.activeUids.length}`;
  elements.targetSeconds.textContent = room.targetSeconds;
  elements.stopButton.hidden = !active || submitted;
  elements.submittedBox.hidden = !submitted;
  elements.spectatorBox.hidden = active;
  if (submitted) {
    const own = Number(state.ownAttempt?.round) === room.round ? state.ownAttempt : null;
    elements.submittedTime.textContent = own ? `${core.formatElapsed(own.elapsedMillis)}초에 멈췄습니다` : "기록을 안전하게 저장했습니다";
  }
  renderTimer(Date.now());
  ensureTimingFrame();
}

function resultEntries() {
  return Object.entries(state.room.lastElapsedMillis || {}).map(([uid, elapsedMillis]) => ({
    uid,
    elapsedMillis: Number(elapsedMillis),
    errorMillis: Number(state.room.lastErrorMillis?.[uid] || 0),
    points: Number(state.room.lastAwardPoints?.[uid] || 0),
    player: state.players.find((item) => item.uid === uid),
  })).sort((left, right) => left.errorMillis - right.errorMillis || left.elapsedMillis - right.elapsedMillis);
}

function renderResult() {
  elements.resultTarget.textContent = Number(state.room.targetSeconds).toFixed(2);
  let previousError = null;
  let previousRank = 0;
  const entries = resultEntries();
  elements.attemptList.innerHTML = entries.length ? entries.map((entry, index) => {
    const rank = previousError === entry.errorMillis ? previousRank : index + 1;
    previousError = entry.errorMillis;
    previousRank = rank;
    const direction = entry.elapsedMillis === state.room.targetSeconds * 1000 ? "정확히" : entry.elapsedMillis < state.room.targetSeconds * 1000 ? "빠름" : "늦음";
    return `<li class="${rank === 1 ? "winner" : ""}"><span class="rank">${rank}위</span><span class="name">${escapeHtml(entry.player?.nickname || "참가자")}</span><span class="time">${core.formatElapsed(entry.elapsedMillis)}초</span><span class="error">${direction} ${core.formatElapsed(entry.errorMillis)}초</span><strong class="points">+${entry.points}P</strong></li>`;
  }).join("") : '<li><span class="name">제출된 기록이 없습니다.</span></li>';
  elements.resultWaiting.hidden = isHost();
}

function renderHostControls() {
  const host = isHost();
  elements.hostPanel.hidden = !host;
  if (!host) return;
  const status = state.room.status;
  elements.hostLobbyControls.hidden = status !== "lobby";
  elements.hostRunningControls.hidden = status !== "running";
  elements.hostRevealedControls.hidden = status !== "revealed";
  elements.hostFinishedControls.hidden = status !== "finished";
  if (status === "lobby") {
    const ready = state.players.length >= 2;
    elements.startGuide.textContent = `${state.players.length}/2명 이상 참가 · ${state.room.totalRounds}라운드`;
    elements.startGameButton.disabled = !ready || state.busyElements.has(elements.startGameButton);
    elements.startGameButton.textContent = ready ? `${state.players.length}명과 시작` : "참가자를 기다리는 중";
  } else if (status === "running") {
    elements.hostProgress.textContent = `${state.room.submittedUids.length}/${state.room.activeUids.length}명이 기록을 확정했습니다. 전원 제출 또는 마감 시 자동 공개됩니다.`;
    elements.revealButton.disabled = state.busyElements.has(elements.revealButton);
  } else if (status === "revealed") {
    const last = state.room.round >= state.room.totalRounds;
    elements.nextRoundButton.textContent = last ? "최종 결과 확정" : `라운드 ${state.room.round + 1} 시작`;
  }
}

function renderScoreboard() {
  const ranked = core.rankPlayers(state.players);
  elements.playerCount.textContent = `${ranked.length}명`;
  elements.scoreboard.innerHTML = ranked.length ? ranked.map((player) => {
    const me = player.uid === state.store.user.uid;
    const submitted = state.room.status === "running" && state.room.submittedUids.includes(player.uid);
    const average = Number(player.submittedRounds || 0) ? `${core.formatElapsed(player.totalErrorMillis / player.submittedRounds)}초 평균 오차` : "아직 기록 없음";
    const status = submitted ? "기록 완료" : state.room.status === "running" && state.room.activeUids.includes(player.uid) ? "측정 중" : `${player.wins || 0}승 · ${average}`;
    return `<li class="${me ? "me" : ""} ${submitted ? "submitted" : ""}"><span class="rank">${player.rank}위</span><span class="name">${escapeHtml(player.nickname)}<small>${status}</small></span><strong class="score">${player.score || 0}P</strong></li>`;
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
    state.eventBridge.setFinishedResult(state.players.map((player) => {
      const submittedRounds = Number(player.submittedRounds || 0);
      const averageError = submittedRounds ? Number(player.totalErrorMillis || 0) / submittedRounds : 999999;
      return {
        uid: player.uid,
        nickname: player.nickname,
        metrics: [player.score, player.wins, player.podiums, submittedRounds, -averageError],
        label: `평균 오차 ${submittedRounds ? core.formatElapsed(averageError) : "--"}초 · 게임 점수 ${player.score || 0}점`,
      };
    }), `${leaders.map((player) => player.nickname).join(" · ") || "우승자 없음"} 시간 감각 1위`);
  }
}

function renderRoom() {
  if (!state.room) return;
  document.title = `${state.room.title} | 지금이다!`;
  elements.roomTitle.textContent = state.room.title;
  elements.roomCodeLabel.textContent = state.room.id;
  const labels = { lobby: "TIMING LOBBY", running: "FEEL THE SECOND", revealed: "TIMING REVEALED", finished: "TIMING COMPLETE" };
  elements.roomEyebrow.textContent = labels[state.room.status];
  elements.lobbyStage.hidden = state.room.status !== "lobby";
  elements.timingStage.hidden = state.room.status !== "running";
  elements.resultStage.hidden = !["revealed", "finished"].includes(state.room.status);
  if (state.room.status === "lobby") renderLobby();
  if (state.room.status === "running") renderTiming();
  if (["revealed", "finished"].includes(state.room.status)) renderResult();
  renderIdentity();
  renderHostControls();
  renderScoreboard();
  renderChampion();
  syncReadiness(currentPlayer());
  refreshConnection();
}

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const roomId = await state.store.createRoom({ title: elements.roomTitleInput.value, totalRounds: elements.roundsSelect.value });
    enterRoom(roomId);
    showToast("새 지금이다! 방을 만들었습니다.");
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
    showToast("타이밍 대결 참가 등록을 마쳤습니다.");
  });
});

elements.startGameButton.addEventListener("click", async () => {
  if (!window.confirm(`${state.players.length}명과 ${state.room.totalRounds}라운드를 시작할까요?`)) return;
  await withBusy(elements.startGameButton, async () => {
    await state.store.startGame(state.room.id, state.players.map((player) => player.uid));
    void state.eventBridge?.markPlaying();
    showToast("3초 뒤 타이머가 시작됩니다!");
  });
});

elements.stopButton.addEventListener("click", async () => {
  const room = state.room;
  const elapsedMillis = Math.round(Date.now() - core.roundStartMillis(room));
  await withBusy(elements.stopButton, async () => {
    await state.store.submitAttempt(room.id, room.round, elapsedMillis);
    state.ownAttempt = { round: room.round, elapsedMillis };
    showToast(`${core.formatElapsed(elapsedMillis)}초에 기록을 확정했습니다.`);
  });
});

elements.revealButton.addEventListener("click", () => withBusy(elements.revealButton, () => state.store.revealRound(state.room.id)));

elements.nextRoundButton.addEventListener("click", () => withBusy(elements.nextRoundButton, async () => {
  const last = state.room.round >= state.room.totalRounds;
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
  try {
    state.store = await createTimingStore(firebaseConfig);
    if (eventRequest) {
      state.eventBridge = await createEventBridge(firebaseConfig, eventRequest, "timing");
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
