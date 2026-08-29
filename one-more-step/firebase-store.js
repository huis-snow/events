import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { browserLocalPersistence, getAuth, setPersistence, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, orderBy,
  query, runTransaction, serverTimestamp, setDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const core = globalThis.OneMoreStepCore;
if (!core) throw new Error("한 칸만 더! 규칙 모듈을 불러오지 못했습니다.");

function publicFirebaseConfig(config) {
  return { apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId };
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function retryable(error) {
  return ["aborted", "unavailable", "deadline-exceeded", "pushluck/stale-choices"].includes(error?.code);
}

export async function createPushLuckStore(config) {
  if (!core.firebaseConfigReady(config)) throw new Error("Firebase 웹 설정이 아직 연결되지 않았습니다.");
  const app = getApps().find((candidate) => candidate.name === "guild-events") ||
    initializeApp(publicFirebaseConfig(config), "guild-events");
  const auth = getAuth(app);
  try { await setPersistence(auth, browserLocalPersistence); } catch (_error) { /* 현재 탭 인증 사용 */ }
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const database = getFirestore(app);

  function requireUser() {
    if (!auth.currentUser) throw storeError("auth/unauthenticated", "참가자 연결이 끊겼습니다.");
    return auth.currentUser;
  }

  function roomReference(roomId) { return doc(database, "pushLuckRooms", core.normalizeRoomId(roomId)); }
  function playersReference(roomId) { return collection(roomReference(roomId), "players"); }
  function playerReference(roomId, uid = requireUser().uid) { return doc(playersReference(roomId), uid); }
  function choicesReference(roomId) { return collection(roomReference(roomId), "choices"); }
  function choiceReference(roomId, uid = requireUser().uid) { return doc(choicesReference(roomId), uid); }

  async function createRoom(value) {
    const user = requireUser();
    const room = {
      version: core.ROOM_VERSION,
      title: core.normalizeTitle(value?.title),
      status: "lobby",
      ownerUid: user.uid,
      totalRounds: core.normalizeRounds(value?.totalRounds || 3),
      choiceSeconds: core.normalizeChoiceSeconds(value?.choiceSeconds || 10),
      round: 0,
      turn: 0,
      target: 0,
      turnStartedAt: null,
      roundUids: [], activeUids: [], submittedUids: [], stoppedUids: [], bustedUids: [],
      totals: {}, lastDecisions: {}, lastRolls: {}, resultRound: 0,
      lastWinnerUids: [], lastRanks: {}, lastAwardPoints: {}, eventId: "", matchId: "",
    };
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const roomId = core.createRoomId();
      try {
        await setDoc(roomReference(roomId), { ...room, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        return roomId;
      } catch (error) {
        lastError = error;
        if (error?.code !== "permission-denied" && error?.code !== "already-exists") throw error;
      }
    }
    throw lastError || new Error("한 칸만 더! 방을 만들지 못했습니다.");
  }

  function subscribeRoom(roomId, callback, onError) {
    const normalizedId = core.normalizeRoomId(roomId);
    if (!core.isValidRoomId(normalizedId)) throw storeError("room/invalid-id", "8자리 방 코드를 확인해 주세요.");
    return onSnapshot(roomReference(normalizedId), (snapshot) => {
      callback(snapshot.exists() ? { room: core.normalizeRoomSnapshot(snapshot.data(), normalizedId), fromCache: snapshot.metadata.fromCache } : null);
    }, onError);
  }

  function subscribePlayers(roomId, callback, onError) {
    return onSnapshot(query(playersReference(roomId), orderBy("joinedAt", "asc")), (snapshot) => {
      callback({ players: snapshot.docs.map((item) => ({ uid: item.id, ...item.data() })), fromCache: snapshot.metadata.fromCache });
    }, onError);
  }

  async function savePlayer(roomId, nicknameValue) {
    const user = requireUser();
    const nickname = core.normalizeNickname(nicknameValue);
    if (!nickname) throw storeError("player/nickname-required", "참가자 이름을 입력해 주세요.");
    const reference = playerReference(roomId, user.uid);
    const existing = await getDoc(reference);
    if (existing.exists()) {
      await updateDoc(reference, { nickname, updatedAt: serverTimestamp() });
      return;
    }
    await setDoc(reference, {
      nickname, score: 0, roundWins: 0, exactHits: 0, safeRounds: 0, roundsPlayed: 0,
      joinedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  }

  async function removePlayer(roomId, uid) {
    requireUser();
    await deleteDoc(playerReference(roomId, uid));
  }

  function freshRoundFields(uids) {
    return {
      target: core.randomTarget(), turn: 1, turnStartedAt: serverTimestamp(),
      roundUids: uids, activeUids: uids, submittedUids: [], stoppedUids: [], bustedUids: [],
      totals: Object.fromEntries(uids.map((uid) => [uid, 0])),
      lastDecisions: {}, lastRolls: {}, lastWinnerUids: [], lastRanks: {}, lastAwardPoints: {},
    };
  }

  async function startGame(roomId, activeUidsValue) {
    requireUser();
    const activeUids = Array.from(new Set((activeUidsValue || []).map(String)));
    if (activeUids.length < 2) throw new Error("한 칸만 더!는 참가자가 2명 이상 필요합니다.");
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "한 칸만 더! 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.status !== "lobby") throw storeError("room/bad-state", "이미 게임 상태가 바뀌었습니다.");
      transaction.update(reference, {
        status: "choosing", round: 1, resultRound: 0,
        ...freshRoundFields(activeUids), updatedAt: serverTimestamp(),
      });
    });
  }

  async function submitChoice(roomId, roundValue, turnValue, decisionValue) {
    const user = requireUser();
    const round = Number(roundValue);
    const turn = Number(turnValue);
    const decision = core.normalizeDecision(decisionValue);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await runTransaction(database, async (transaction) => {
          const roomRef = roomReference(roomId);
          const choiceRef = choiceReference(roomId, user.uid);
          const [roomSnapshot, choiceSnapshot] = await Promise.all([transaction.get(roomRef), transaction.get(choiceRef)]);
          if (!roomSnapshot.exists()) throw storeError("room/not-found", "한 칸만 더! 방을 찾지 못했습니다.");
          const room = core.normalizeRoomSnapshot(roomSnapshot.data(), roomId);
          if (room.status !== "choosing" || room.round !== round || room.turn !== turn) {
            throw storeError("room/bad-state", "선택할 턴이 이미 바뀌었습니다.");
          }
          if (!room.activeUids.includes(user.uid) || room.submittedUids.includes(user.uid)) {
            throw storeError("choice/already-submitted", "이번 선택은 이미 확정했습니다.");
          }
          if (core.choiceSecondsRemaining(room) === 0) throw storeError("choice/closed", "이번 턴의 선택 시간이 끝났습니다.");
          const existing = choiceSnapshot.data();
          if (choiceSnapshot.exists() && (Number(existing.round) > round || (Number(existing.round) === round && Number(existing.turn) >= turn))) {
            throw storeError("choice/already-submitted", "이번 선택은 이미 확정했습니다.");
          }
          transaction.set(choiceRef, { round, turn, decision, createdAt: serverTimestamp() });
          transaction.update(roomRef, { submittedUids: [...room.submittedUids, user.uid], updatedAt: serverTimestamp() });
        });
        return;
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === 2) throw error;
      }
    }
    throw lastError;
  }

  async function getOwnChoice(roomId) {
    const snapshot = await getDoc(choiceReference(roomId));
    return snapshot.exists() ? snapshot.data() : null;
  }

  async function revealTurn(roomId) {
    requireUser();
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const snapshots = await getDocs(choicesReference(roomId));
        const choices = snapshots.docs.map((item) => ({ uid: item.id, ...item.data() }));
        await runTransaction(database, async (transaction) => {
          const roomRef = roomReference(roomId);
          const roomSnapshot = await transaction.get(roomRef);
          if (!roomSnapshot.exists()) throw storeError("room/not-found", "한 칸만 더! 방을 찾지 못했습니다.");
          const room = core.normalizeRoomSnapshot(roomSnapshot.data(), roomId);
          if (room.status !== "choosing") throw storeError("room/bad-state", "이미 선택 결과가 공개되었습니다.");
          const currentChoices = choices.filter((item) => Number(item.round) === room.round && Number(item.turn) === room.turn);
          const choiceUids = new Set(currentChoices.map((item) => String(item.uid)));
          if (room.submittedUids.some((uid) => !choiceUids.has(uid))) throw storeError("pushluck/stale-choices", "최신 선택을 불러오는 중입니다.");
          const decisions = Object.fromEntries(currentChoices.map((item) => [item.uid, item.decision]));
          const resolved = core.resolveTurn({
            activeUids: room.activeUids, totals: room.totals, decisions,
            target: room.target, turn: room.turn,
          });
          const stoppedUids = [...room.stoppedUids, ...resolved.stoppedUids];
          const bustedUids = [...room.bustedUids, ...resolved.bustedUids];
          let ranked = [];
          let playerSnapshots = [];
          if (resolved.roundComplete) {
            ranked = core.rankRoundResults(room.roundUids, resolved.totals, bustedUids, room.target);
            playerSnapshots = await Promise.all(room.roundUids.map((uid) => transaction.get(playerReference(roomId, uid))));
          }
          const rankByUid = Object.fromEntries(ranked.map((entry) => [entry.uid, entry.rank]));
          const awardByUid = Object.fromEntries(room.roundUids.map((uid) => [uid, ranked.find((entry) => entry.uid === uid)?.points || 0]));
          const winnerUids = ranked.filter((entry) => entry.rank === 1).map((entry) => entry.uid);
          transaction.update(roomRef, {
            status: resolved.roundComplete ? "roundResult" : "turnResult",
            turnStartedAt: null,
            activeUids: resolved.continuingUids,
            submittedUids: [],
            stoppedUids, bustedUids, totals: resolved.totals,
            lastDecisions: resolved.decisions, lastRolls: resolved.rolls,
            resultRound: resolved.roundComplete ? room.round : room.resultRound,
            lastWinnerUids: resolved.roundComplete ? winnerUids : [],
            lastRanks: resolved.roundComplete ? rankByUid : {},
            lastAwardPoints: resolved.roundComplete ? awardByUid : {},
            updatedAt: serverTimestamp(),
          });
          if (resolved.roundComplete) {
            playerSnapshots.forEach((snapshot, index) => {
              if (!snapshot.exists()) return;
              const uid = room.roundUids[index];
              const player = snapshot.data();
              const result = ranked.find((entry) => entry.uid === uid);
              const safe = Boolean(result);
              transaction.update(snapshot.ref, {
                score: Number(player.score || 0) + Number(awardByUid[uid] || 0),
                roundWins: Number(player.roundWins || 0) + (winnerUids.includes(uid) ? 1 : 0),
                exactHits: Number(player.exactHits || 0) + (result?.distance === 0 ? 1 : 0),
                safeRounds: Number(player.safeRounds || 0) + (safe ? 1 : 0),
                roundsPlayed: Number(player.roundsPlayed || 0) + 1,
                updatedAt: serverTimestamp(),
              });
            });
          }
        });
        return;
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === 2) throw error;
      }
    }
    throw lastError;
  }

  async function nextTurn(roomId) {
    requireUser();
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "한 칸만 더! 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.status !== "turnResult" || !room.activeUids.length || room.turn >= core.MAX_TURNS) {
        throw storeError("room/bad-state", "다음 턴 상태가 이미 바뀌었습니다.");
      }
      transaction.update(reference, {
        status: "choosing", turn: room.turn + 1, turnStartedAt: serverTimestamp(),
        submittedUids: [], lastDecisions: {}, lastRolls: {}, updatedAt: serverTimestamp(),
      });
    });
  }

  async function nextRound(roomId) {
    requireUser();
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "한 칸만 더! 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.status !== "roundResult" || room.round >= room.totalRounds) {
        throw storeError("room/bad-state", "다음 라운드 상태가 이미 바뀌었습니다.");
      }
      transaction.update(reference, {
        status: "choosing", round: room.round + 1,
        ...freshRoundFields(room.roundUids), updatedAt: serverTimestamp(),
      });
    });
  }

  async function finishGame(roomId) {
    requireUser();
    await updateDoc(roomReference(roomId), { status: "finished", updatedAt: serverTimestamp() });
  }

  return Object.freeze({
    get user() { return auth.currentUser; },
    createRoom, subscribeRoom, subscribePlayers, savePlayer, removePlayer,
    startGame, submitChoice, getOwnChoice, revealTurn, nextTurn, nextRound, finishGame,
  });
}
