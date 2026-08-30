import { createPushLuckStore } from "./firebase-store.js?v=20260830-concurrency";
import { createEventBridge, eventRequestFromUrl } from "../event-bridge.js?v=20260829-read-opt";
import { attachBackgroundMusic } from "../background-music.js?v=20260829-bgm";

const core = globalThis.OneMoreStepCore;
const firebaseConfig = globalThis.GuildEventsFirebaseConfig;
const eventRequest = eventRequestFromUrl();
if (!core) throw new Error("한 칸만 더! 규칙 모듈을 불러오지 못했습니다.");

const ids = [
  "landingView", "roomView", "createRoomForm", "roomTitleInput", "roundsSelect", "choiceSecondsSelect",
  "joinRoomForm", "roomCodeInput", "connectionState", "roomEyebrow", "roomTitle", "roomCodeLabel",
  "shareButton", "leaveButton", "championBanner", "championNames", "championScore", "lobbyStage",
  "playerWaiting", "choosingStage", "roundNumber", "choiceTimer", "timerValue", "submissionCount",
  "targetValue", "myTotalValue", "distanceLabel", "decisionGrid", "confirmChoiceButton", "submittedBox",
  "submittedChoiceLabel", "spectatorBox", "turnResultStage", "turnResultTitle", "turnResultDescription",
  "stepResults", "turnWaiting", "roundResultStage", "roundTargetValue", "roundRanking", "roundWaiting",
  "identityTitle", "identityBadge", "playerForm", "nicknameInput", "myPlayer", "myAvatar", "myNickname",
  "myScore", "identitySpectator", "hostPanel", "hostLobbyControls", "startGuide", "startGameButton",
  "hostChoosingControls", "hostProgress", "revealButton", "hostResultControls", "nextButton",
  "hostFinishedControls", "playerCount", "scoreboard", "loadingCover", "loadingMessage", "toast",
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const state = {
  store: null, eventBridge: null, roomId: "", room: null, players: [], roomLoaded: false,
  playersLoaded: false, selectedDecision: "", ownChoice: null, ownChoiceLoadingKey: "",
  eventPlayerSaving: false, unsubscribeRoom: null, unsubscribePlayers: null, countdownTimer: 0,
  autoRevealKey: "", toastTimer: 0, busyElements: new Set(),
};

attachBackgroundMusic({ source: "../assets/audio/dont-pick-mine.mp3", button: document.getElementById("soundToggleButton"), label: document.getElementById("soundToggleLabel"), volume: 0.035 });

function escapeHtml(value) { return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function setLoading(visible, message = "게임 서버에 연결하는 중…") { elements.loadingMessage.textContent = message; elements.loadingCover.classList.toggle("done", !visible); }
function setConnection(status, label) { elements.connectionState.dataset.state = status; elements.connectionState.querySelector("span").textContent = label; }
function refreshConnection() { if (!navigator.onLine) setConnection("error", "인터넷 연결 끊김"); else if (state.roomLoaded && state.playersLoaded) setConnection("online", "실시간 연결됨"); }
function showToast(message) { clearTimeout(state.toastTimer); elements.toast.textContent = message; elements.toast.hidden = false; state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3200); }
function describeError(error) {
  if (error?.code === "permission-denied") return "이 작업을 할 권한이 없거나 게임 상태가 이미 바뀌었습니다.";
  if (error?.code === "room/not-found") return "한 칸만 더! 방을 찾지 못했습니다.";
  if (error?.code === "choice/already-submitted") return "이번 선택은 이미 확정했습니다.";
  if (error?.code === "choice/closed") return "이번 턴의 선택 시간이 끝났습니다.";
  return error?.message || "요청을 처리하지 못했습니다.";
}
async function withBusy(element, task) {
  if (state.busyElements.has(element)) return;
  state.busyElements.add(element); if (element) element.disabled = true;
  try { return await task(); } catch (error) { console.error(error); showToast(describeError(error)); }
  finally { state.busyElements.delete(element); if (element) element.disabled = false; renderRoom(); }
}
function updateRoomUrl(roomId = "") {
  const url = new URL(location.href); url.search = ""; url.hash = "";
  if (roomId) { if (eventRequest) { url.searchParams.set("event", eventRequest.eventId); url.searchParams.set("match", eventRequest.matchId); } url.searchParams.set("room", roomId); }
  history.replaceState({}, "", url);
}
function stopCountdown() { clearInterval(state.countdownTimer); state.countdownTimer = 0; }
function unsubscribeRoom() { state.unsubscribeRoom?.(); state.unsubscribePlayers?.(); state.unsubscribeRoom = null; state.unsubscribePlayers = null; stopCountdown(); }
function showLanding(clearUrl = true) {
  unsubscribeRoom(); Object.assign(state, { roomId: "", room: null, players: [], roomLoaded: false, playersLoaded: false, selectedDecision: "", ownChoice: null });
  elements.landingView.hidden = false; elements.roomView.hidden = true; document.title = "한 칸만 더! | 길드 오락실"; if (clearUrl) updateRoomUrl(); setLoading(false);
}
function currentPlayer() { return state.players.find((player) => player.uid === state.store?.user?.uid) || null; }
function isHost() { return Boolean(state.room && state.room.ownerUid === state.store?.user?.uid); }
function isRoundActive(uid) { return Boolean(uid && state.room?.activeUids.includes(uid)); }

function syncReadiness(player) {
  if (!state.eventBridge?.isEligible()) return;
  const uid = state.store?.user?.uid;
  if (state.room.status !== "lobby") void state.eventBridge.markPlaying();
  if (state.room.status === "lobby") state.eventBridge.setReadiness(player ? "ready" : "entering", player ? "한 칸만 더! 참가 준비 완료" : "참가 등록 중");
  else if (!state.room.roundUids.includes(uid)) state.eventBridge.setReadiness("spectating", "한 칸만 더! 관전 중");
  else if (state.room.status === "choosing") {
    const submitted = state.room.submittedUids.includes(uid);
    const inactive = !state.room.activeUids.includes(uid);
    state.eventBridge.setReadiness(inactive ? "playing" : submitted ? "submitted" : "playing", inactive ? "이번 라운드 결과 대기" : submitted ? "선택 확정 완료" : "더 갈지 고민 중");
  } else if (["turnResult", "roundResult"].includes(state.room.status)) state.eventBridge.setReadiness("playing", "주사위 결과 확인 중");
  else state.eventBridge.setReadiness("finished", "최종 결과 확인 중");
}

function enterRoom(roomId) {
  const normalizedId = core.normalizeRoomId(roomId); if (!core.isValidRoomId(normalizedId)) throw new Error("8자리 방 코드를 확인해 주세요.");
  unsubscribeRoom(); Object.assign(state, { roomId: normalizedId, room: null, players: [], roomLoaded: false, playersLoaded: false, selectedDecision: "", ownChoice: null, ownChoiceLoadingKey: "", autoRevealKey: "" });
  elements.landingView.hidden = true; elements.roomView.hidden = false; elements.roomCodeLabel.textContent = normalizedId; updateRoomUrl(normalizedId); setLoading(true, "한 칸만 더! 방에 들어가는 중…");
  state.unsubscribeRoom = state.store.subscribeRoom(normalizedId, (snapshot) => {
    state.roomLoaded = true;
    if (!snapshot) { showToast("해당 한 칸만 더! 방을 찾지 못했습니다."); showLanding(); return; }
    const oldKey = state.room ? `${state.room.round}:${state.room.turn}` : "";
    const newKey = `${snapshot.room.round}:${snapshot.room.turn}`;
    const previousStatus = state.room?.status;
    state.room = snapshot.room;
    if (oldKey !== newKey) { state.selectedDecision = ""; state.ownChoice = null; state.ownChoiceLoadingKey = ""; state.autoRevealKey = ""; }
    if (previousStatus === "choosing" && state.room.status !== "choosing") stopCountdown();
    ensureOwnChoice(); ensureEventPlayer(); renderRoom(); finishLoadingIfReady();
  }, handleSubscriptionError);
  state.unsubscribePlayers = state.store.subscribePlayers(normalizedId, (snapshot) => { state.playersLoaded = true; state.players = snapshot.players; ensureEventPlayer(); renderRoom(); finishLoadingIfReady(); }, handleSubscriptionError);
}
function finishLoadingIfReady() { if (state.roomLoaded && state.playersLoaded && state.room) { setLoading(false); refreshConnection(); } }
function handleSubscriptionError(error) { console.error(error); setLoading(false); setConnection("error", "연결 확인 필요"); showToast(describeError(error)); }
async function ensureEventPlayer() {
  if (!state.eventBridge || state.eventPlayerSaving || currentPlayer() || state.room?.status !== "lobby") return;
  if (!state.eventBridge.isEligible() || !state.eventBridge.participant) return;
  state.eventPlayerSaving = true; try { await state.store.savePlayer(state.room.id, state.eventBridge.participant.nickname); } catch (error) { showToast(describeError(error)); } finally { state.eventPlayerSaving = false; }
}
async function ensureOwnChoice() {
  const uid = state.store?.user?.uid; const room = state.room;
  if (!uid || room?.status !== "choosing" || !room.submittedUids.includes(uid)) return;
  const key = `${room.round}:${room.turn}`;
  if (`${state.ownChoice?.round}:${state.ownChoice?.turn}` === key || state.ownChoiceLoadingKey === key) return;
  state.ownChoiceLoadingKey = key; try { state.ownChoice = await state.store.getOwnChoice(room.id); } catch (error) { console.error(error); } finally { state.ownChoiceLoadingKey = ""; renderRoom(); }
}

function renderIdentity() {
  const player = currentPlayer(); const canRegister = state.room.status === "lobby";
  elements.playerForm.hidden = Boolean(player) || !canRegister; elements.myPlayer.hidden = !player; elements.identitySpectator.hidden = Boolean(player) || canRegister;
  elements.identityTitle.textContent = player ? "내 참가 정보" : canRegister ? "참가자 등록" : "관전 중"; elements.identityBadge.textContent = player ? "참가 중" : canRegister ? "미등록" : "관전";
  if (player) { const index = Math.max(0, state.players.findIndex((item) => item.uid === player.uid)); elements.myAvatar.textContent = String(index + 1).padStart(2, "0"); elements.myNickname.textContent = player.nickname; elements.myScore.textContent = player.score || 0; }
}
function renderLobby() {
  const ready = state.players.length >= 2;
  elements.playerWaiting.textContent = isHost() ? ready ? `${state.players.length}명이 준비됐습니다. 욕심 대결을 시작해 보세요!` : `현재 ${state.players.length}명 · 2명 이상 모이면 시작할 수 있어요.` : "진행자가 참가자를 확인하고 있습니다.";
}
function triggerAutoReveal() {
  if (!isHost() || state.room?.status !== "choosing") return;
  const all = state.room.activeUids.length > 0 && state.room.submittedUids.length >= state.room.activeUids.length;
  const deadline = core.choiceDeadlineMillis(state.room);
  const expired = deadline > 0 && core.choiceSecondsRemaining(state.room) === 0;
  if (!all && !expired) return;
  const key = `${state.room.id}:${state.room.round}:${state.room.turn}`; if (state.autoRevealKey === key) return;
  state.autoRevealKey = key;
  state.store.revealTurn(state.room.id).catch((error) => { console.error(error); state.autoRevealKey = ""; if (!['room/bad-state', 'permission-denied'].includes(error?.code)) showToast(describeError(error)); });
}
function updateCountdown() {
  if (state.room?.status !== "choosing") { stopCountdown(); return; }
  const deadline = core.choiceDeadlineMillis(state.room);
  const remaining = core.choiceSecondsRemaining(state.room);
  elements.timerValue.textContent = deadline ? remaining : "…";
  elements.choiceTimer.dataset.urgent = deadline && remaining <= 3 ? "true" : "false";
  const unavailable = !deadline || remaining === 0;
  elements.decisionGrid.querySelectorAll("button").forEach((button) => { button.disabled = unavailable; });
  if (unavailable) elements.confirmChoiceButton.disabled = true;
  triggerAutoReveal();
}
function syncCountdown() { updateCountdown(); if (!state.countdownTimer) state.countdownTimer = setInterval(updateCountdown, 250); }
function renderChoosing() {
  const room = state.room; const player = currentPlayer(); const uid = player?.uid; const active = isRoundActive(uid); const submitted = Boolean(uid && room.submittedUids.includes(uid)); const total = Number(room.totals?.[uid] || 0);
  elements.roundNumber.textContent = `ROUND ${String(room.round).padStart(2, "0")} / ${String(room.totalRounds).padStart(2, "0")} · TURN ${String(room.turn).padStart(2, "0")}`;
  elements.submissionCount.textContent = `${room.submittedUids.length} / ${room.activeUids.length}`; elements.targetValue.textContent = room.target; elements.myTotalValue.textContent = total; elements.distanceLabel.textContent = uid ? `목표까지 ${Math.max(0, room.target - total)}` : "관전 중";
  elements.decisionGrid.hidden = !active || submitted; elements.confirmChoiceButton.hidden = !active || submitted; elements.submittedBox.hidden = !submitted; elements.spectatorBox.hidden = active;
  if (!active) elements.spectatorBox.textContent = room.bustedUids.includes(uid) ? "이번 라운드는 폭발했습니다. 결과를 기다려 주세요." : room.stoppedUids.includes(uid) ? "현재 합계에서 안전하게 멈췄습니다." : "이번 라운드는 관전 중입니다.";
  elements.decisionGrid.querySelectorAll("button").forEach((button) => button.classList.toggle("selected", state.selectedDecision === button.dataset.decision));
  elements.confirmChoiceButton.disabled = !state.selectedDecision || state.busyElements.has(elements.confirmChoiceButton);
  elements.confirmChoiceButton.textContent = state.selectedDecision === "go" ? "위험을 감수하고 한 칸 더!" : state.selectedDecision === "stop" ? `${total}에서 멈춤 확정` : "선택을 먼저 골라 주세요";
  if (submitted) { const decision = Number(state.ownChoice?.round) === room.round && Number(state.ownChoice?.turn) === room.turn ? state.ownChoice.decision : ""; elements.submittedChoiceLabel.textContent = decision ? (decision === "go" ? "한 칸 더 가기로 했습니다" : `${total}에서 멈추기로 했습니다`) : "선택을 안전하게 저장했습니다"; }
  syncCountdown();
}
function playerName(uid) { return state.players.find((player) => player.uid === uid)?.nickname || "참가자"; }
function renderTurnResult() {
  const room = state.room; const cards = room.roundUids.map((uid) => {
    const busted = room.bustedUids.includes(uid); const stopped = room.stoppedUids.includes(uid); const decision = room.lastDecisions?.[uid]; const roll = Number(room.lastRolls?.[uid] || 0); const total = Number(room.totals?.[uid] || 0); const joinedThisTurn = Object.prototype.hasOwnProperty.call(room.lastDecisions || {}, uid);
    const stateClass = busted ? "busted" : stopped ? "stopped" : "";
    const detail = !joinedThisTurn
      ? busted ? `이전 턴에 ${total}로 폭발` : `${total}에서 이미 멈춤`
      : busted ? `+${roll} · ${total} · 목표 초과!`
      : stopped && decision === "stop" ? `${total}에서 멈춤`
      : stopped ? `+${roll} · ${total} · 최대 턴 자동 멈춤`
      : `+${roll} · 현재 ${total}`;
    return `<article class="step-card ${stateClass}"><strong>${escapeHtml(playerName(uid))}</strong><b>${busted ? "BOOM" : stopped ? "STOP" : "GO"}</b><small>${detail}</small></article>`;
  });
  elements.stepResults.innerHTML = cards.join(""); elements.turnResultTitle.textContent = `${room.turn}번째 주사위 결과!`; elements.turnResultDescription.textContent = `${room.activeUids.length}명이 아직 한 칸 더 갈 수 있습니다.`; elements.turnWaiting.hidden = isHost();
}
function roundEntries() {
  const room = state.room; const safe = core.rankRoundResults(room.roundUids, room.totals, room.bustedUids, room.target); const safeUids = new Set(safe.map((entry) => entry.uid));
  return [...safe, ...room.roundUids.filter((uid) => !safeUids.has(uid)).map((uid) => ({ uid, total: Number(room.totals?.[uid] || 0), rank: 0, distance: -1, points: 0, busted: true }))];
}
function renderRoundResult() {
  elements.roundTargetValue.textContent = state.room.target; const entries = roundEntries();
  elements.roundRanking.innerHTML = entries.length ? entries.map((entry) => `<li class="${entry.rank === 1 ? "winner" : ""} ${entry.busted ? "busted" : ""}"><span class="rank">${entry.busted ? "OUT" : `${entry.rank}위`}</span><span class="name">${escapeHtml(playerName(entry.uid))}</span><span class="total">합계 ${entry.total}</span><strong class="points">+${entry.points}P</strong></li>`).join("") : '<li><span class="name">안전하게 멈춘 참가자가 없습니다.</span></li>';
  elements.roundWaiting.hidden = isHost();
}
function renderHostControls() {
  const host = isHost(); elements.hostPanel.hidden = !host; if (!host) return; const status = state.room.status;
  elements.hostLobbyControls.hidden = status !== "lobby"; elements.hostChoosingControls.hidden = status !== "choosing"; elements.hostResultControls.hidden = !["turnResult", "roundResult"].includes(status); elements.hostFinishedControls.hidden = status !== "finished";
  if (status === "lobby") { const ready = state.players.length >= 2; elements.startGuide.textContent = `${state.players.length}/2명 이상 참가 · ${state.room.totalRounds}라운드`; elements.startGameButton.disabled = !ready; elements.startGameButton.textContent = ready ? `${state.players.length}명과 시작` : "참가자를 기다리는 중"; }
  if (status === "choosing") { elements.hostProgress.textContent = `${state.room.submittedUids.length}/${state.room.activeUids.length}명이 선택했습니다. 미제출자는 공개 시 자동으로 멈춥니다.`; }
  if (status === "turnResult") elements.nextButton.textContent = `턴 ${state.room.turn + 1} 선택 시작`;
  if (status === "roundResult") elements.nextButton.textContent = state.room.round >= state.room.totalRounds ? "최종 결과 확정" : `라운드 ${state.room.round + 1} 시작`;
}
function liveStatus(player) {
  const uid = player.uid; const room = state.room;
  if (["choosing", "turnResult"].includes(room.status) && room.roundUids.includes(uid)) {
    if (room.bustedUids.includes(uid)) return `합계 ${room.totals?.[uid] || 0} · 폭발`;
    if (room.stoppedUids.includes(uid)) return `합계 ${room.totals?.[uid] || 0} · 멈춤`;
    if (room.submittedUids.includes(uid)) return `합계 ${room.totals?.[uid] || 0} · 선택 완료`;
    if (room.activeUids.includes(uid)) return `합계 ${room.totals?.[uid] || 0} · 고민 중`;
  }
  return `${player.roundWins || 0}승 · 정확히 ${player.exactHits || 0}회`;
}
function renderScoreboard() {
  const ranked = core.rankPlayers(state.players); elements.playerCount.textContent = `${ranked.length}명`;
  elements.scoreboard.innerHTML = ranked.length ? ranked.map((player) => { const me = player.uid === state.store.user.uid; const submitted = state.room.status === "choosing" && state.room.submittedUids.includes(player.uid); const busted = state.room.bustedUids.includes(player.uid) && ["choosing", "turnResult"].includes(state.room.status); return `<li class="${me ? "me" : ""} ${submitted ? "submitted" : ""} ${busted ? "busted" : ""}"><span class="rank">${player.rank}위</span><span class="name">${escapeHtml(player.nickname)}<small>${liveStatus(player)}</small></span><strong class="score">${player.score || 0}P</strong></li>`; }).join("") : '<li class="empty">아직 참가자가 없어요.</li>';
}
function renderChampion() {
  const show = state.room.status === "finished"; elements.championBanner.hidden = !show; if (!show) return; const ranked = core.rankPlayers(state.players); const leaders = ranked.filter((player) => player.rank === 1);
  elements.championNames.textContent = leaders.length ? leaders.map((player) => player.nickname).join(" · ") : "최종 우승자 없음"; elements.championScore.textContent = `${leaders[0]?.score || 0}점`;
  if (state.eventBridge && state.players.length) state.eventBridge.setFinishedResult(state.players.map((player) => ({ uid: player.uid, nickname: player.nickname, metrics: [player.score, player.exactHits, player.roundWins, player.safeRounds], label: `정확히 ${player.exactHits || 0}회 · 게임 점수 ${player.score || 0}점` })), `${leaders.map((player) => player.nickname).join(" · ") || "우승자 없음"} 최종 선두`);
}
function renderRoom() {
  if (!state.room) return; document.title = `${state.room.title} | 한 칸만 더!`; elements.roomTitle.textContent = state.room.title; elements.roomCodeLabel.textContent = state.room.id;
  const labels = { lobby: "PUSH LOBBY", choosing: "SECRET DECISION", turnResult: "STEP REVEALED", roundResult: "ROUND COMPLETE", finished: "PUSH COMPLETE" }; elements.roomEyebrow.textContent = labels[state.room.status];
  elements.lobbyStage.hidden = state.room.status !== "lobby"; elements.choosingStage.hidden = state.room.status !== "choosing"; elements.turnResultStage.hidden = state.room.status !== "turnResult"; elements.roundResultStage.hidden = !["roundResult", "finished"].includes(state.room.status);
  if (state.room.status === "lobby") renderLobby(); if (state.room.status === "choosing") renderChoosing(); if (state.room.status === "turnResult") renderTurnResult(); if (["roundResult", "finished"].includes(state.room.status)) renderRoundResult();
  renderIdentity(); renderHostControls(); renderScoreboard(); renderChampion(); syncReadiness(currentPlayer()); refreshConnection();
}

elements.createRoomForm.addEventListener("submit", async (event) => { event.preventDefault(); await withBusy(event.submitter, async () => { const roomId = await state.store.createRoom({ title: elements.roomTitleInput.value, totalRounds: elements.roundsSelect.value, choiceSeconds: elements.choiceSecondsSelect.value }); enterRoom(roomId); showToast("새 한 칸만 더! 방을 만들었습니다."); }); });
elements.joinRoomForm.addEventListener("submit", (event) => { event.preventDefault(); try { enterRoom(elements.roomCodeInput.value); } catch (error) { showToast(describeError(error)); } });
elements.roomCodeInput.addEventListener("input", () => { elements.roomCodeInput.value = core.normalizeRoomId(elements.roomCodeInput.value).slice(0, 8); });
elements.playerForm.addEventListener("submit", async (event) => { event.preventDefault(); await withBusy(event.submitter, async () => { await state.store.savePlayer(state.room.id, elements.nicknameInput.value); showToast("욕심 대결 참가 등록을 마쳤습니다."); }); });
elements.startGameButton.addEventListener("click", async () => { if (!confirm(`${state.players.length}명과 ${state.room.totalRounds}라운드를 시작할까요?`)) return; await withBusy(elements.startGameButton, async () => { await state.store.startGame(state.room.id, state.players.map((player) => player.uid)); void state.eventBridge?.markPlaying(); showToast("첫 번째 목표가 공개됐습니다!"); }); });
elements.decisionGrid.addEventListener("click", (event) => { const button = event.target.closest("button[data-decision]"); if (!button || button.disabled) return; state.selectedDecision = button.dataset.decision; renderChoosing(); });
elements.confirmChoiceButton.addEventListener("click", () => withBusy(elements.confirmChoiceButton, async () => { const decision = state.selectedDecision; await state.store.submitChoice(state.room.id, state.room.round, state.room.turn, decision); state.ownChoice = { round: state.room.round, turn: state.room.turn, decision }; showToast(decision === "go" ? "한 칸 더 가기로 했습니다!" : "현재 합계에서 멈추기로 했습니다."); }));
elements.revealButton.addEventListener("click", () => withBusy(elements.revealButton, () => state.store.revealTurn(state.room.id)));
elements.nextButton.addEventListener("click", () => withBusy(elements.nextButton, async () => { if (state.room.status === "turnResult") await state.store.nextTurn(state.room.id); else if (state.room.round >= state.room.totalRounds) await state.store.finishGame(state.room.id); else await state.store.nextRound(state.room.id); }));
elements.shareButton.addEventListener("click", async () => { const url = eventRequest ? new URL(`../?event=${eventRequest.eventId}`, location.href).href : core.makeRoomUrl(location.href, state.room.id); try { await navigator.clipboard.writeText(url); showToast("초대 링크를 복사했습니다."); } catch (_error) { prompt("이 링크를 복사해 주세요.", url); } });
elements.leaveButton.addEventListener("click", () => { if (eventRequest) location.href = `../?event=${eventRequest.eventId}&view=score`; else showLanding(); });
window.addEventListener("online", refreshConnection); window.addEventListener("offline", refreshConnection); window.addEventListener("pagehide", unsubscribeRoom);

async function initialize() {
  setConnection("loading", "연결 준비 중");
  try {
    state.store = await createPushLuckStore(firebaseConfig);
    if (eventRequest) { state.eventBridge = await createEventBridge(firebaseConfig, eventRequest, "pushluck"); if (!state.eventBridge.participant) throw new Error("이벤트 참가 등록을 먼저 완료해 주세요."); elements.nicknameInput.value = state.eventBridge.participant.nickname; elements.nicknameInput.readOnly = true; document.querySelector(".back-link").href = `../?event=${eventRequest.eventId}&view=score`; }
    setConnection("online", "실시간 연결됨"); const requestedRoom = new URL(location.href).searchParams.get("room"); if (requestedRoom) enterRoom(requestedRoom); else showLanding(false);
  } catch (error) { console.error(error); setConnection("error", "연결 실패"); setLoading(false); showToast(describeError(error)); }
}
initialize();
