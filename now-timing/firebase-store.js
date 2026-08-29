import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const core = globalThis.NowTimingCore;
if (!core) throw new Error("지금이다! 규칙 모듈을 불러오지 못했습니다.");

function publicFirebaseConfig(config) {
  return { apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId };
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function retryable(error) {
  return ["aborted", "unavailable", "deadline-exceeded", "timing/stale-attempts"].includes(error?.code);
}

export async function createTimingStore(config) {
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

  function roomReference(roomId) {
    return doc(database, "timingRooms", core.normalizeRoomId(roomId));
  }

  function playersReference(roomId) {
    return collection(roomReference(roomId), "players");
  }

  function playerReference(roomId, uid = requireUser().uid) {
    return doc(playersReference(roomId), uid);
  }

  function attemptsReference(roomId) {
    return collection(roomReference(roomId), "attempts");
  }

  function attemptReference(roomId, uid = requireUser().uid) {
    return doc(attemptsReference(roomId), uid);
  }

  async function createRoom(value) {
    const user = requireUser();
    const room = {
      version: core.ROOM_VERSION,
      title: core.normalizeTitle(value?.title),
      status: "lobby",
      ownerUid: user.uid,
      totalRounds: core.normalizeRounds(value?.totalRounds || 5),
      round: 0,
      targetSeconds: 0,
      announcedAt: null,
      activeUids: [],
      submittedUids: [],
      resultRound: 0,
      lastElapsedMillis: {},
      lastErrorMillis: {},
      lastAwardPoints: {},
      eventId: "",
      matchId: "",
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
    throw lastError || new Error("지금이다! 방을 만들지 못했습니다.");
  }

  function subscribeRoom(roomId, callback, onError) {
    const normalizedId = core.normalizeRoomId(roomId);
    if (!core.isValidRoomId(normalizedId)) throw storeError("room/invalid-id", "8자리 방 코드를 확인해 주세요.");
    return onSnapshot(roomReference(normalizedId), (snapshot) => {
      callback(snapshot.exists() ? {
        room: core.normalizeRoomSnapshot(snapshot.data(), normalizedId),
        fromCache: snapshot.metadata.fromCache,
      } : null);
    }, onError);
  }

  function subscribePlayers(roomId, callback, onError) {
    return onSnapshot(query(playersReference(roomId), orderBy("joinedAt", "asc")), (snapshot) => {
      callback({
        players: snapshot.docs.map((item) => ({ uid: item.id, ...item.data() })),
        fromCache: snapshot.metadata.fromCache,
      });
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
      nickname,
      score: 0,
      wins: 0,
      podiums: 0,
      totalErrorMillis: 0,
      submittedRounds: 0,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async function removePlayer(roomId, uid) {
    requireUser();
    await deleteDoc(playerReference(roomId, uid));
  }

  async function startGame(roomId, activeUidsValue) {
    requireUser();
    const activeUids = Array.from(new Set((activeUidsValue || []).map(String)));
    if (activeUids.length < 2) throw new Error("지금이다!는 참가자가 2명 이상 필요합니다.");
    const targetSeconds = core.randomTargetSeconds();
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "지금이다! 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.status !== "lobby") throw storeError("room/bad-state", "이미 게임 상태가 바뀌었습니다.");
      transaction.update(reference, {
        status: "running",
        round: 1,
        targetSeconds,
        announcedAt: serverTimestamp(),
        activeUids,
        submittedUids: [],
        resultRound: 0,
        lastElapsedMillis: {},
        lastErrorMillis: {},
        lastAwardPoints: {},
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function submitAttempt(roomId, roundValue, elapsedValue) {
    const user = requireUser();
    const round = Number(roundValue);
    const elapsedMillis = Math.round(Number(elapsedValue));
    if (!Number.isInteger(elapsedMillis) || elapsedMillis < 0 || elapsedMillis > 20000) {
      throw new Error("정지 기록이 올바르지 않습니다.");
    }
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await runTransaction(database, async (transaction) => {
          const roomRef = roomReference(roomId);
          const attemptRef = attemptReference(roomId, user.uid);
          const [roomSnapshot, attemptSnapshot] = await Promise.all([
            transaction.get(roomRef), transaction.get(attemptRef),
          ]);
          if (!roomSnapshot.exists()) throw storeError("room/not-found", "지금이다! 방을 찾지 못했습니다.");
          const room = core.normalizeRoomSnapshot(roomSnapshot.data(), roomId);
          if (room.status !== "running" || room.round !== round) {
            throw storeError("room/bad-state", "타이밍 라운드가 이미 바뀌었습니다.");
          }
          if (!room.activeUids.includes(user.uid) || room.submittedUids.includes(user.uid)) {
            throw storeError("attempt/already-submitted", "이번 기록은 이미 확정했습니다.");
          }
          const start = core.roundStartMillis(room);
          const deadline = core.roundDeadlineMillis(room);
          if (!start || Date.now() < start) throw storeError("attempt/not-started", "아직 타이머가 시작되지 않았습니다.");
          if (deadline && Date.now() >= deadline) throw storeError("attempt/closed", "기록 시간이 끝났습니다.");
          if (attemptSnapshot.exists() && Number(attemptSnapshot.data().round) >= round) {
            throw storeError("attempt/already-submitted", "이번 기록은 이미 확정했습니다.");
          }
          transaction.set(attemptRef, { round, elapsedMillis, createdAt: serverTimestamp() });
          transaction.update(roomRef, {
            submittedUids: [...room.submittedUids, user.uid],
            updatedAt: serverTimestamp(),
          });
        });
        return;
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === 2) throw error;
      }
    }
    throw lastError;
  }

  async function getOwnAttempt(roomId) {
    const snapshot = await getDoc(attemptReference(roomId));
    return snapshot.exists() ? snapshot.data() : null;
  }

  async function revealRound(roomId) {
    requireUser();
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const attemptSnapshots = await getDocs(attemptsReference(roomId));
        const attempts = attemptSnapshots.docs.map((item) => ({ uid: item.id, ...item.data() }));
        let finalRanking = [];
        await runTransaction(database, async (transaction) => {
          const roomRef = roomReference(roomId);
          const roomSnapshot = await transaction.get(roomRef);
          if (!roomSnapshot.exists()) throw storeError("room/not-found", "지금이다! 방을 찾지 못했습니다.");
          const room = core.normalizeRoomSnapshot(roomSnapshot.data(), roomId);
          if (room.status !== "running") throw storeError("room/bad-state", "이미 결과가 공개되었습니다.");
          const roundAttempts = attempts.filter((item) => Number(item.round) === room.round);
          const attemptUids = new Set(roundAttempts.map((item) => String(item.uid)));
          if (room.submittedUids.some((uid) => !attemptUids.has(uid))) {
            throw storeError("timing/stale-attempts", "최신 기록을 불러오는 중입니다.");
          }
          const ranked = core.rankAttempts(roundAttempts, room.targetSeconds, room.activeUids);
          const playerSnapshots = await Promise.all(
            ranked.map((entry) => transaction.get(playerReference(roomId, entry.uid)))
          );
          const elapsedMap = Object.fromEntries(ranked.map((entry) => [entry.uid, entry.elapsedMillis]));
          const errorMap = Object.fromEntries(ranked.map((entry) => [entry.uid, entry.errorMillis]));
          const awardMap = Object.fromEntries(ranked.map((entry) => [entry.uid, entry.points]));
          transaction.update(roomRef, {
            status: "revealed",
            announcedAt: null,
            resultRound: room.round,
            lastElapsedMillis: elapsedMap,
            lastErrorMillis: errorMap,
            lastAwardPoints: awardMap,
            updatedAt: serverTimestamp(),
          });
          playerSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists()) return;
            const entry = ranked[index];
            const player = snapshot.data();
            transaction.update(snapshot.ref, {
              score: Number(player.score || 0) + entry.points,
              wins: Number(player.wins || 0) + (entry.rank === 1 ? 1 : 0),
              podiums: Number(player.podiums || 0) + (entry.points > 0 ? 1 : 0),
              totalErrorMillis: Number(player.totalErrorMillis || 0) + entry.errorMillis,
              submittedRounds: Number(player.submittedRounds || 0) + 1,
              updatedAt: serverTimestamp(),
            });
          });
          finalRanking = ranked;
        });
        return finalRanking;
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === 2) throw error;
      }
    }
    throw lastError;
  }

  async function nextRound(roomId) {
    requireUser();
    const targetSeconds = core.randomTargetSeconds();
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "지금이다! 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.status !== "revealed" || room.round >= room.totalRounds) {
        throw storeError("room/bad-state", "다음 라운드 상태가 이미 바뀌었습니다.");
      }
      transaction.update(reference, {
        status: "running",
        round: room.round + 1,
        targetSeconds,
        announcedAt: serverTimestamp(),
        submittedUids: [],
        lastElapsedMillis: {},
        lastErrorMillis: {},
        lastAwardPoints: {},
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function finishGame(roomId) {
    requireUser();
    await updateDoc(roomReference(roomId), { status: "finished", updatedAt: serverTimestamp() });
  }

  return Object.freeze({
    get user() { return auth.currentUser; },
    createRoom,
    subscribeRoom,
    subscribePlayers,
    savePlayer,
    removePlayer,
    startGame,
    submitAttempt,
    getOwnAttempt,
    revealRound,
    nextRound,
    finishGame,
  });
}
