import { createEventStore } from "./event-firebase-store.js?v=20260830-timing";
import { attachBackgroundMusic } from "./background-music.js?v=20260829-bgm";

const core = globalThis.EventCore;
const config = globalThis.GuildEventsFirebaseConfig;

const elements = Object.fromEntries(
  [
    "connectionState", "landingView", "eventView", "createEventForm", "findEventForm",
    "eventTitleInput", "hostNicknameInput", "eventCodeInput", "eventEyebrow", "eventTitle",
    "eventCodeLabel", "shareButton", "leaveButton", "joinPanel", "joinEventForm",
    "participantNicknameInput", "middleJoinNotice", "lobbyStage", "lobbyCount", "startEventButton",
    "selectStage", "nextMatchNumber", "bingoTargetSelect", "nunchiRoundsSelect", "nunchiModeSelect", "nunchiTimeSelect", "chosungTimeSelect", "minorityTimeSelect", "timingRoundsSelect",
    "activeStage", "activeKicker", "activeGameNumber", "activeGameName", "activeDescription",
    "enterGameButton", "backToGameSelectButton", "autoMoveNotice", "spectatorNotice", "reviewStage", "reviewGameName",
    "awardList", "nextGameButton", "finishEventButton", "finalStage", "finalPodium",
    "participantCount", "rankingList", "matchHistory", "hostControl", "joinOpenToggle",
    "joinOpenLabel", "soundToggleButton", "soundToggleLabel", "loadingScreen", "toast",
  ].map((id) => [id, document.getElementById(id)])
);

const state = {
  store: null,
  eventId: "",
  event: null,
  participants: [],
  matches: [],
  unsubscribers: [],
  autoMoveTimer: 0,
};

attachBackgroundMusic({
  source: "./assets/audio/next-game-lounge.mp3",
  button: elements.soundToggleButton,
  label: elements.soundToggleLabel,
  volume: 0.045,
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setConnection(label, type = "connected") {
  elements.connectionState.dataset.state = type;
  elements.connectionState.querySelector("span").textContent = label;
}

let toastTimer = 0;
function toast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2800);
}

function loading(active) {
  elements.loadingScreen.hidden = !active;
}

function currentMember() {
  return state.participants.find((participant) => participant.id === state.store?.uid) || null;
}

function currentMatch() {
  return state.matches.find((match) => match.id === state.event?.currentMatchId) || null;
}

function isHost() {
  return Boolean(state.event && state.store?.uid === state.event.ownerUid);
}

function showOnlyStage(stage) {
  [elements.joinPanel, elements.lobbyStage, elements.selectStage, elements.activeStage, elements.reviewStage, elements.finalStage]
    .forEach((element) => { element.hidden = element !== stage; });
}

function gameEntranceUrl(match = currentMatch()) {
  if (!match) return "./";
  return core.gameUrl(match.gameType, state.eventId, match.id, match.gameRoomId);
}

function renderRanking() {
  const ranked = core.rankParticipants(state.participants);
  elements.participantCount.textContent = `${ranked.length}명`;
  elements.lobbyCount.textContent = String(ranked.length);
  if (!ranked.length) {
    elements.rankingList.innerHTML = '<li class="empty-row">아직 참가자가 없어요.</li>';
    return;
  }
  elements.rankingList.innerHTML = ranked.map((participant) => {
    const waiting = state.event &&
      ["preparing", "playing", "review"].includes(state.event.status) &&
      participant.eligibleFromMatch > state.event.matchNumber
      ? "<small>다음 게임부터 참여</small>"
      : "";
    return `<li data-me="${participant.id === state.store.uid}"><span class="rank">${participant.rank}위</span><span class="name">${escapeHtml(participant.nickname)}${waiting}</span><strong class="points">${participant.totalScore || 0}P</strong></li>`;
  }).join("");
}

function renderHistory() {
  const settled = state.matches.filter((match) => match.status === "settled").slice().reverse();
  if (!settled.length) {
    elements.matchHistory.innerHTML = "<p>완료한 게임이 아직 없어요.</p>";
    return;
  }
  const me = currentMember();
  elements.matchHistory.innerHTML = settled.map((match, reverseIndex) => {
    const number = state.matches.length - reverseIndex;
    const myPoint = Number(match.awards?.[me?.id] || 0);
    return `<div class="history-item"><b>${number}경기 · ${escapeHtml(core.GAME_LABELS[match.gameType])}</b><span>${escapeHtml(match.resultSummary || "결과 확정")}</span><strong>${myPoint ? `+${myPoint}P` : "—"}</strong></div>`;
  }).join("");
}

function renderAwards(match) {
  const awards = match?.awards || {};
  const rows = Object.entries(awards)
    .map(([uid, value]) => {
      const participant = state.participants.find((item) => item.id === uid);
      return { uid, points: Number(value), nickname: participant?.nickname || "참가자" };
    })
    .sort((left, right) => right.points - left.points || left.nickname.localeCompare(right.nickname, "ko"));
  elements.awardList.innerHTML = rows.length
    ? rows.map((row, index) => `<div class="award-row"><b>${index + 1}</b><span>${escapeHtml(row.nickname)}</span><strong>+${row.points}P</strong></div>`).join("")
    : "<p>확정된 점수가 없습니다.</p>";
}

function renderFinal() {
  const ranked = core.rankParticipants(state.participants).filter((participant) => participant.rank <= 3);
  elements.finalPodium.innerHTML = ranked.length
    ? ranked.map((participant) => `<div class="podium-person" data-rank="${participant.rank}"><b>${participant.rank}</b><span>${escapeHtml(participant.nickname)}</span><strong>${participant.totalScore || 0}P</strong></div>`).join("")
    : "<p>참가자가 없습니다.</p>";
}

function updateHostVisibility() {
  const host = isHost();
  document.querySelectorAll("[data-host-only]").forEach((element) => { element.hidden = !host; });
  document.querySelectorAll("[data-player-only]").forEach((element) => { element.hidden = host; });
  elements.hostControl.hidden = !host || state.event?.status === "finished";
  if (state.event) {
    elements.joinOpenToggle.checked = Boolean(state.event.joinOpen);
    elements.joinOpenLabel.textContent = state.event.joinOpen ? "열림" : "닫힘";
  }
}

function maybeAutoMove(match, eligible) {
  clearTimeout(state.autoMoveTimer);
  if (!eligible || new URLSearchParams(location.search).get("view") === "score") return;
  const key = `event-auto-moved-${state.eventId}-${match.id}-${match.gameRoomId}`;
  if (sessionStorage.getItem(key)) return;
  elements.autoMoveNotice.hidden = false;
  state.autoMoveTimer = window.setTimeout(() => {
    sessionStorage.setItem(key, "1");
    location.assign(gameEntranceUrl(match));
  }, 1500);
}

function render() {
  if (!state.event) return;
  if (!["preparing", "playing"].includes(state.event.status)) {
    clearTimeout(state.autoMoveTimer);
    state.autoMoveTimer = 0;
  }
  elements.landingView.hidden = true;
  elements.eventView.hidden = false;
  elements.eventTitle.textContent = state.event.title;
  elements.eventCodeLabel.textContent = state.eventId;
  const statusLabels = {
    lobby: "EVENT LOBBY", selecting: "GAME SELECT", preparing: "GAME READY",
    playing: "GAME IN PROGRESS", review: "SCORE REVIEW", finished: "FINAL RESULT",
  };
  elements.eventEyebrow.textContent = statusLabels[state.event.status] || "GUILD EVENT";
  updateHostVisibility();
  renderRanking();
  renderHistory();

  const member = currentMember();
  if (!member) {
    showOnlyStage(elements.joinPanel);
    elements.middleJoinNotice.textContent = state.event.status === "playing" || state.event.status === "review"
      ? "지금 등록하면 0P로 종합 순위에 들어가고 다음 게임부터 참가합니다."
      : "지금 등록하면 현재 준비 중인 게임부터 바로 함께할 수 있어요.";
    if (!state.event.joinOpen || state.event.status === "finished") {
      elements.joinEventForm.hidden = true;
      elements.middleJoinNotice.textContent = "참가 접수가 종료된 이벤트입니다. 현재 순위는 계속 볼 수 있어요.";
    } else {
      elements.joinEventForm.hidden = false;
    }
    return;
  }

  if (state.event.status === "lobby") {
    showOnlyStage(elements.lobbyStage);
  } else if (state.event.status === "selecting") {
    showOnlyStage(elements.selectStage);
    elements.nextMatchNumber.textContent = String(state.event.matchNumber + 1);
  } else if (state.event.status === "preparing" || state.event.status === "playing") {
    showOnlyStage(elements.activeStage);
    const match = currentMatch();
    if (!match) return;
    const eligible = match.participantUids?.includes(state.store.uid);
    elements.activeKicker.textContent = state.event.status === "preparing" ? "GAME READY" : "NOW PLAYING";
    elements.activeGameNumber.textContent = `GAME ${String(state.event.matchNumber).padStart(2, "0")}`;
    elements.activeGameName.textContent = core.GAME_LABELS[match.gameType];
    elements.activeDescription.textContent = state.event.status === "preparing"
      ? "게임 화면에서 개인 준비를 마치면 진행자가 시작합니다."
      : "게임이 진행 중입니다. 다시 입장해 이어서 플레이할 수 있어요.";
    elements.enterGameButton.href = gameEntranceUrl(match);
    elements.enterGameButton.hidden = !eligible;
    elements.backToGameSelectButton.hidden = !isHost() || state.event.status !== "preparing";
    elements.spectatorNotice.hidden = eligible;
    elements.autoMoveNotice.hidden = !eligible || isHost();
    maybeAutoMove(match, eligible && !isHost());
  } else if (state.event.status === "review") {
    showOnlyStage(elements.reviewStage);
    const match = currentMatch();
    elements.reviewGameName.textContent = core.GAME_LABELS[match?.gameType] || "게임";
    renderAwards(match);
  } else if (state.event.status === "finished") {
    showOnlyStage(elements.finalStage);
    renderFinal();
  }
}

function clearSubscriptions() {
  state.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
}

async function openEvent(eventId) {
  const normalizedId = core.normalizeRoomId(eventId);
  if (!core.isValidRoomId(normalizedId)) {
    toast("8자리 이벤트 코드를 확인해 주세요.");
    return false;
  }
  loading(true);
  try {
    const room = await state.store.readEvent(normalizedId);
    if (!room) throw new Error("이벤트 방을 찾지 못했습니다.");
    clearSubscriptions();
    state.eventId = normalizedId;
    state.event = room;
    history.replaceState(null, "", `${location.pathname}?event=${normalizedId}${new URLSearchParams(location.search).get("view") === "score" ? "&view=score" : ""}`);
    const onError = (error) => { console.error(error); setConnection("연결 오류", "error"); toast("실시간 연결을 다시 확인해 주세요."); };
    state.unsubscribers.push(
      state.store.subscribeEvent(normalizedId, (value) => {
        if (!value) { toast("종료되었거나 없는 이벤트입니다."); return; }
        state.event = value; render();
      }, onError),
      state.store.subscribeParticipants(normalizedId, (value) => { state.participants = value; render(); }, onError),
      state.store.subscribeMatches(normalizedId, (value) => { state.matches = value; render(); }, onError)
    );
    render();
    return true;
  } catch (error) {
    console.error(error);
    toast(error.message || "이벤트 방을 열지 못했습니다.");
    return false;
  } finally {
    loading(false);
  }
}

async function action(button, task) {
  const previous = button?.disabled;
  if (button) button.disabled = true;
  try { await task(); }
  catch (error) { console.error(error); toast(error.message || "요청을 처리하지 못했습니다."); }
  finally { if (button) button.disabled = previous; loading(false); }
}

elements.createEventForm.addEventListener("submit", (event) => {
  event.preventDefault();
  action(event.submitter, async () => {
    loading(true);
    const eventId = await state.store.createEvent({ title: elements.eventTitleInput.value, nickname: elements.hostNicknameInput.value });
    await openEvent(eventId);
    toast("이벤트 방을 만들었습니다.");
    loading(false);
  });
});

elements.findEventForm.addEventListener("submit", (event) => {
  event.preventDefault();
  action(event.submitter, () => openEvent(elements.eventCodeInput.value));
});

elements.joinEventForm.addEventListener("submit", (event) => {
  event.preventDefault();
  action(event.submitter, async () => {
    await state.store.joinEvent(state.eventId, elements.participantNicknameInput.value);
    elements.participantNicknameInput.value = "";
    toast("이벤트 참가가 완료됐습니다.");
  });
});

elements.startEventButton.addEventListener("click", () => action(elements.startEventButton, () => state.store.startEvent(state.eventId)));

document.querySelectorAll(".choose-game").forEach((button) => {
  button.addEventListener("click", () => action(button, async () => {
    const gameType = button.dataset.game;
    let options;
    if (gameType === "bingo") {
      options = { gameType, targetLines: elements.bingoTargetSelect.value };
    } else if (gameType === "nunchi") {
      options = {
        gameType,
        totalRounds: elements.nunchiRoundsSelect.value,
        scoreMode: elements.nunchiModeSelect.value,
        choiceSeconds: elements.nunchiTimeSelect.value,
      };
    } else if (gameType === "chosung") {
      options = { gameType, clueSeconds: elements.chosungTimeSelect.value };
    } else if (gameType === "minority") {
      options = { gameType, choiceSeconds: elements.minorityTimeSelect.value };
    } else {
      options = { gameType, totalRounds: elements.timingRoundsSelect.value };
    }
    const match = await state.store.selectGame(state.eventId, options);
    location.assign(core.gameUrl(match.gameType, state.eventId, match.matchId, match.gameRoomId));
  }));
});

elements.nextGameButton.addEventListener("click", () => action(elements.nextGameButton, () => state.store.chooseNextGame(state.eventId)));
elements.backToGameSelectButton.addEventListener("click", () => {
  if (!window.confirm("아직 시작하지 않은 게임 준비를 취소하고 다시 고를까요?\n참가자들의 현재 준비 내용은 삭제됩니다.")) return;
  clearTimeout(state.autoMoveTimer);
  action(elements.backToGameSelectButton, async () => {
    await state.store.cancelPreparedGame(state.eventId);
    toast("게임 선택 화면으로 돌아왔습니다.");
  });
});
elements.finishEventButton.addEventListener("click", () => {
  if (!window.confirm("현재 점수로 이벤트를 최종 결산할까요?")) return;
  action(elements.finishEventButton, () => state.store.finishEvent(state.eventId));
});

elements.joinOpenToggle.addEventListener("change", () => action(elements.joinOpenToggle, () => state.store.setJoinOpen(state.eventId, elements.joinOpenToggle.checked)));
elements.shareButton.addEventListener("click", async () => {
  const url = new URL(`?event=${state.eventId}`, location.href).href;
  try { await navigator.clipboard.writeText(url); toast("초대 링크를 복사했습니다."); }
  catch (_error) { window.prompt("이 링크를 복사해 주세요.", url); }
});
elements.leaveButton.addEventListener("click", () => { location.href = "./"; });
elements.eventCodeInput.addEventListener("input", () => { elements.eventCodeInput.value = core.normalizeRoomId(elements.eventCodeInput.value); });

window.addEventListener("pagehide", clearSubscriptions);

async function initialize() {
  try {
    state.store = await createEventStore(config);
    setConnection("실시간 연결됨");
    const eventId = new URLSearchParams(location.search).get("event");
    if (eventId) await openEvent(eventId);
  } catch (error) {
    console.error(error);
    setConnection("연결 실패", "error");
    toast("Firebase 연결을 시작하지 못했습니다.");
  }
}

initialize();
