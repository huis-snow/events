import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence, getAuth, setPersistence, signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection, doc, getDoc, getFirestore, onSnapshot, runTransaction, serverTimestamp, setDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const eventCore = globalThis.EventCore;

function publicConfig(config) {
  return { apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId };
}

export function eventRequestFromUrl(url = window.location.href) {
  if (!eventCore) return null;
  const params = new URL(url).searchParams;
  const eventId = eventCore.normalizeRoomId(params.get("event"));
  const matchId = String(params.get("match") || "");
  const roomId = eventCore.normalizeRoomId(params.get("room"));
  if (!eventCore.isValidRoomId(eventId) || !/^M\d{3}$/.test(matchId) || !eventCore.isValidRoomId(roomId)) return null;
  return { eventId, matchId, roomId };
}

export async function createEventBridge(config, request, gameType) {
  if (!request) return null;
  const app = getApps().find((candidate) => candidate.name === "guild-events") ||
    initializeApp(publicConfig(config), "guild-events");
  const auth = getAuth(app);
  try { await setPersistence(auth, browserLocalPersistence); } catch (_error) { /* 현재 탭 인증 사용 */ }
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const database = getFirestore(app);
  const eventReference = doc(database, "eventRooms", request.eventId);
  const matchReference = doc(database, "eventRooms", request.eventId, "matches", request.matchId);
  const readinessReference = collection(matchReference, "readiness");
  const participantReference = doc(database, "eventRooms", request.eventId, "participants", auth.currentUser.uid);
  let eventRoom = null;
  let match = null;
  let participant = null;
  let participants = [];
  let readiness = [];
  let finishedResult = null;
  let settleBusy = false;
  let readinessTimer = 0;
  let desiredReadinessKey = "";
  let savedReadinessKey = "";
  let pendingReadiness = null;
  let readinessWrite = Promise.resolve();
  let markPlayingPromise = null;
  const readinessListeners = new Set();
  const unsubscribers = [];

  const [eventSnapshot, matchSnapshot, participantSnapshot] = await Promise.all([
    getDoc(eventReference), getDoc(matchReference), getDoc(participantReference),
  ]);
  if (!eventSnapshot.exists() || !matchSnapshot.exists()) throw new Error("이벤트 게임 정보를 찾지 못했습니다.");
  eventRoom = { id: eventSnapshot.id, ...eventSnapshot.data() };
  match = { id: matchSnapshot.id, ...matchSnapshot.data() };
  participant = participantSnapshot.exists() ? { id: participantSnapshot.id, ...participantSnapshot.data() } : null;
  if (match.gameType !== gameType || match.gameRoomId !== request.roomId) throw new Error("이벤트 게임 주소가 일치하지 않습니다.");

  const shell = document.createElement("section");
  shell.className = "event-bridge-bar";
  shell.innerHTML = `
    <div class="event-bridge-title"><span>EVENT ${request.matchId}</span><strong></strong></div>
    <div class="event-bridge-ranks" aria-label="현재 종합 순위"></div>
    <div class="event-bridge-actions">
      <b class="event-my-score">0P</b>
      <button class="event-settle-button" type="button" hidden>결과 확정 · 점수 합산</button>
      <a href="../?event=${request.eventId}&view=score">종합 스코어</a>
    </div>
    <div class="event-bridge-readiness" aria-label="실시간 참가자 상태">
      <div class="event-readiness-heading"><span>LIVE STATUS</span><strong>참가 상태 확인 중…</strong></div>
      <div class="event-readiness-list" role="list"></div>
    </div>`;
  document.querySelector(".game-header")?.after(shell);
  const titleElement = shell.querySelector(".event-bridge-title strong");
  const ranksElement = shell.querySelector(".event-bridge-ranks");
  const myScoreElement = shell.querySelector(".event-my-score");
  const settleButton = shell.querySelector(".event-settle-button");
  const readinessPanel = shell.querySelector(".event-bridge-readiness");
  const readinessHeading = shell.querySelector(".event-readiness-heading strong");
  const readinessList = shell.querySelector(".event-readiness-list");

  function isHost() { return eventRoom?.ownerUid === auth.currentUser.uid; }
  function isEligible() { return Boolean(match?.participantUids?.includes(auth.currentUser.uid)); }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderReadiness() {
    readinessPanel.hidden = !isHost();
    if (!isHost()) return;
    const eligibleUids = match?.participantUids || [];
    const readinessByUid = new Map(readiness.map((item) => [item.id, item]));
    const readyStatuses = new Set(["ready", "submitted", "playing", "finished"]);
    const readyCount = eligibleUids.filter((uid) => readyStatuses.has(readinessByUid.get(uid)?.status)).length;
    readinessHeading.textContent = match?.status === "preparing"
      ? `게임 준비 ${readyCount}/${eligibleUids.length}명`
      : `실시간 참가 상태 ${eligibleUids.length}명`;
    readinessList.innerHTML = eligibleUids.map((uid, index) => {
      const member = participants.find((item) => item.id === uid);
      const stateItem = readinessByUid.get(uid);
      const nickname = member?.nickname || (uid === participant?.id ? participant.nickname : `참가자 ${index + 1}`);
      const status = stateItem?.status || "offline";
      const label = stateItem?.label || "게임 화면 미입장";
      return `<span class="event-readiness-person" data-status="${status}" role="listitem"><i aria-hidden="true"></i><b>${escapeHtml(nickname)}</b><em>${escapeHtml(label)}</em></span>`;
    }).join("");
  }

  function renderBar() {
    const practice = match?.isPractice === true;
    titleElement.textContent = `${eventRoom?.title || "길드 이벤트"} · ${eventCore.GAME_LABELS[gameType]}${practice ? " · 연습" : ""}`;
    const ranked = eventCore.rankParticipants(participants.map((item) => ({
      ...item,
      joinedAtMs: item.joinedAt?.toMillis?.() || 0,
    })));
    ranksElement.innerHTML = ranked.slice(0, 3).map((item) =>
      `<span><b>${item.rank}</b>${String(item.nickname).replaceAll("<", "&lt;")} <strong>${item.totalScore || 0}P</strong></span>`
    ).join("");
    participant = participants.find((item) => item.id === auth.currentUser.uid) || participant;
    myScoreElement.textContent = participant ? `${participant.totalScore || 0}P` : "관전";
    settleButton.hidden = !(isHost() && finishedResult && match?.status !== "settled");
    settleButton.disabled = settleBusy;
    settleButton.textContent = settleBusy
      ? practice ? "연습 종료 중…" : "점수 합산 중…"
      : practice ? "연습 종료 · 점수 반영 없음" : "결과 확정 · 점수 합산";
    shell.dataset.practice = practice ? "true" : "false";
    if (match?.status === "settled") shell.dataset.settled = "true";
    renderReadiness();
  }

  function flushReadiness() {
    readinessTimer = 0;
    const value = pendingReadiness;
    if (!value || value.key === savedReadinessKey) return;
    pendingReadiness = null;
    readinessWrite = readinessWrite
      .catch(() => undefined)
      .then(() => setDoc(doc(readinessReference, auth.currentUser.uid), {
        gameType,
        status: value.status,
        label: value.label,
        updatedAt: serverTimestamp(),
      }, { merge: true }))
      .then(() => { savedReadinessKey = value.key; })
      .catch((error) => {
        if (desiredReadinessKey === value.key) desiredReadinessKey = "";
        console.error("참가 상태를 동기화하지 못했습니다.", error);
      });
  }

  function setReadiness(status, label) {
    if (!isEligible()) return;
    const cleanStatus = ["entering", "editing", "ready", "playing", "submitted", "finished", "spectating"].includes(status)
      ? status
      : "entering";
    const cleanLabel = String(label || "게임 화면 입장").trim().slice(0, 40) || "게임 화면 입장";
    const key = `${cleanStatus}:${cleanLabel}`;
    if (key === desiredReadinessKey || key === savedReadinessKey) return;
    desiredReadinessKey = key;
    pendingReadiness = { status: cleanStatus, label: cleanLabel, key };
    clearTimeout(readinessTimer);
    readinessTimer = window.setTimeout(flushReadiness, 160);
  }

  function subscribeReadiness(listener) {
    if (typeof listener !== "function") return () => {};
    readinessListeners.add(listener);
    listener(readiness);
    return () => readinessListeners.delete(listener);
  }

  function markPlaying() {
    if (!isHost() || match?.status !== "preparing") return Promise.resolve(true);
    if (markPlayingPromise) return markPlayingPromise;
    markPlayingPromise = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await runTransaction(database, async (transaction) => {
            const [latestEvent, latestMatch] = await Promise.all([
              transaction.get(eventReference), transaction.get(matchReference),
            ]);
            if (!latestEvent.exists() || !latestMatch.exists() || latestMatch.data().status !== "preparing") return;
            transaction.update(matchReference, { status: "playing", updatedAt: serverTimestamp() });
            transaction.update(eventReference, { status: "playing", updatedAt: serverTimestamp() });
          });
          return true;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
          }
        }
      }
      console.error("이벤트 진행 상태를 동기화하지 못했습니다.", lastError);
      return false;
    })().finally(() => { markPlayingPromise = null; });
    return markPlayingPromise;
  }

  function setFinishedResult(entries, summary) {
    if (!Array.isArray(entries) || !entries.length) return;
    finishedResult = { entries, summary: String(summary || "게임 결과 확정").slice(0, 200) };
    renderBar();
  }

  async function settle() {
    if (!isHost() || !finishedResult || settleBusy) return;
    settleBusy = true;
    renderBar();
    try {
      await runTransaction(database, async (transaction) => {
        const [latestEvent, latestMatch] = await Promise.all([
          transaction.get(eventReference), transaction.get(matchReference),
        ]);
        if (!latestEvent.exists() || !latestMatch.exists()) throw new Error("이벤트 결과 방을 찾지 못했습니다.");
        if (latestMatch.data().status === "settled") return;
        if (latestEvent.data().ownerUid !== auth.currentUser.uid) throw new Error("진행자만 결과를 확정할 수 있습니다.");

        if (latestMatch.data().isPractice === true) {
          transaction.update(matchReference, {
            status: "settled",
            awards: {},
            resultSummary: `연습 · ${finishedResult.summary}`.slice(0, 200),
            updatedAt: serverTimestamp(),
          });
          transaction.update(eventReference, { status: "review", updatedAt: serverTimestamp() });
          return;
        }

        const eligible = new Set(latestMatch.data().participantUids || []);
        const uniqueEntries = finishedResult.entries.filter((entry, index, list) =>
          eligible.has(entry.uid) && list.findIndex((item) => item.uid === entry.uid) === index
        );
        const ranked = eventCore.rankGameResults(uniqueEntries);
        const memberReferences = ranked.map((entry) =>
          doc(database, "eventRooms", request.eventId, "participants", entry.uid)
        );
        const memberSnapshots = await Promise.all(memberReferences.map((reference) => transaction.get(reference)));
        const awards = {};
        ranked.forEach((entry, index) => {
          const memberSnapshot = memberSnapshots[index];
          if (!memberSnapshot.exists()) return;
          const points = Number(entry.eventPoints);
          awards[entry.uid] = points;
          transaction.update(memberReferences[index], {
            totalScore: Number(memberSnapshot.data().totalScore || 0) + points,
            updatedAt: serverTimestamp(),
          });
          transaction.set(
            doc(database, "eventRooms", request.eventId, "ledger", `${request.matchId}_${entry.uid}`),
            {
              participantUid: entry.uid,
              matchId: request.matchId,
              gameType,
              points,
              rank: entry.rank,
              reason: String(entry.label || `${entry.rank}위`).slice(0, 100),
              createdAt: serverTimestamp(),
            }
          );
        });
        transaction.update(matchReference, {
          status: "settled",
          awards,
          resultSummary: finishedResult.summary,
          updatedAt: serverTimestamp(),
        });
        transaction.update(eventReference, { status: "review", updatedAt: serverTimestamp() });
      });
    } finally {
      settleBusy = false;
      renderBar();
    }
  }

  settleButton.addEventListener("click", async () => {
    try { await settle(); }
    catch (error) { console.error(error); window.alert(error.message || "결과를 합산하지 못했습니다."); }
  });

  let redirectTimer = 0;
  unsubscribers.push(
    onSnapshot(eventReference, (snapshot) => {
      if (!snapshot.exists()) return;
      eventRoom = { id: snapshot.id, ...snapshot.data() };
      renderBar();
      if (eventRoom.status === "review" || eventRoom.status === "finished") {
        clearTimeout(redirectTimer);
        redirectTimer = window.setTimeout(() => location.replace(`../?event=${request.eventId}`), 1400);
      }
    }),
    onSnapshot(matchReference, (snapshot) => {
      if (!snapshot.exists()) return;
      match = { id: snapshot.id, ...snapshot.data() };
      renderBar();
      readinessListeners.forEach((listener) => listener(readiness));
    }),
    onSnapshot(collection(eventReference, "participants"), (snapshot) => {
      participants = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderBar();
      readinessListeners.forEach((listener) => listener(readiness));
    })
  );
  if (isHost()) {
    unsubscribers.push(onSnapshot(readinessReference, (snapshot) => {
      readiness = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderBar();
      readinessListeners.forEach((listener) => listener(readiness));
    }));
  }

  renderBar();
  return Object.freeze({
    get uid() { return auth.currentUser.uid; },
    get participant() { return participant; },
    get participants() { return participants; },
    get readiness() { return readiness; },
    get match() { return match; },
    get eventRoom() { return eventRoom; },
    isHost,
    isEligible,
    setReadiness,
    subscribeReadiness,
    markPlaying,
    setFinishedResult,
    settle,
    destroy() {
      clearTimeout(redirectTimer);
      clearTimeout(readinessTimer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      readinessListeners.clear();
      shell.remove();
    },
  });
}
