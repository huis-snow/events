import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  arrayUnion,
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
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const core = globalThis.MinoritySurvivalCore;
if (!core) throw new Error("소수결 생존 규칙 모듈을 불러오지 못했습니다.");

function publicFirebaseConfig(config) {
  return { apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId };
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function retryable(error) {
  return ["aborted", "unavailable", "deadline-exceeded", "minority/stale-choices"].includes(error?.code);
}

export async function createMinorityStore(config) {
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
    return doc(database, "minorityRooms", core.normalizeRoomId(roomId));
  }

  function playersReference(roomId) {
    return collection(roomReference(roomId), "players");
  }

  function playerReference(roomId, uid = requireUser().uid) {
    return doc(playersReference(roomId), uid);
  }

  function questionsReference(roomId) {
    return collection(roomReference(roomId), "questions");
  }

  function questionReference(roomId, round) {
    return doc(questionsReference(roomId), `Q${String(round).padStart(2, "0")}`);
  }

  function choicesReference(roomId) {
    return collection(roomReference(roomId), "choices");
  }

  function choiceReference(roomId, uid = requireUser().uid) {
    return doc(choicesReference(roomId), uid);
  }

  async function createRoom(value) {
    const user = requireUser();
    const room = {
      version: core.ROOM_VERSION,
      title: core.normalizeTitle(value?.title),
      status: "lobby",
      ownerUid: user.uid,
      totalRounds: 0,
      currentRound: 0,
      currentPrompt: "",
      optionA: "",
      optionB: "",
      choiceSeconds: core.normalizeChoiceSeconds(value?.choiceSeconds),
      roundStartedAt: null,
      activeUids: [],
      submittedUids: [],
      countA: 0,
      countB: 0,
      resultKind: "",
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
    throw lastError || new Error("소수결 생존 방을 만들지 못했습니다.");
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
      survivalWins: 0,
      rareWins: 0,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async function removePlayer(roomId, uid) {
    requireUser();
    await deleteDoc(playerReference(roomId, uid));
  }

  async function configureQuestions(roomId, values) {
    requireUser();
    const questions = core.normalizeQuestions(values);
    const existing = await getDocs(questionsReference(roomId));
    const existingById = new Map(existing.docs.map((item) => [item.id, item.data()]));
    const batch = writeBatch(database);
    questions.forEach((question, index) => {
      const round = index + 1;
      const reference = questionReference(roomId, round);
      const old = existingById.get(reference.id);
      batch.set(reference, {
        order: round,
        ...question,
        createdAt: old?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      existingById.delete(reference.id);
    });
    existingById.forEach((_value, id) => batch.delete(doc(questionsReference(roomId), id)));
    batch.update(roomReference(roomId), {
      totalRounds: questions.length,
      currentRound: 0,
      currentPrompt: "",
      optionA: "",
      optionB: "",
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  async function loadQuestions(roomId) {
    requireUser();
    const snapshot = await getDocs(query(questionsReference(roomId), orderBy("order", "asc")));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }

  async function updateFutureQuestion(roomId, round, value) {
    requireUser();
    const question = core.normalizeQuestion(value);
    await updateDoc(questionReference(roomId, Number(round)), { ...question, updatedAt: serverTimestamp() });
  }

  async function startGame(roomId, activeUidsValue) {
    requireUser();
    const activeUids = Array.from(new Set((activeUidsValue || []).map(String)));
    if (activeUids.length < 3) throw new Error("소수결은 참가자가 3명 이상 필요합니다.");
    const firstQuestion = await getDoc(questionReference(roomId, 1));
    if (!firstQuestion.exists()) throw new Error("질문을 먼저 저장해 주세요.");
    const question = core.normalizeQuestion(firstQuestion.data());
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "소수결 생존 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.status !== "lobby") throw storeError("room/bad-state", "이미 게임 상태가 바뀌었습니다.");
      if (room.totalRounds < core.QUESTION_MIN) throw new Error("질문을 먼저 저장해 주세요.");
      transaction.update(reference, {
        status: "voting",
        currentRound: 1,
        currentPrompt: question.prompt,
        optionA: question.optionA,
        optionB: question.optionB,
        roundStartedAt: serverTimestamp(),
        activeUids,
        submittedUids: [],
        countA: 0,
        countB: 0,
        resultKind: "",
        lastAwardPoints: {},
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function submitChoice(roomId, roundValue, sideValue) {
    const user = requireUser();
    const round = Number(roundValue);
    const side = sideValue === "A" ? "A" : sideValue === "B" ? "B" : "";
    if (!side) throw new Error("A 또는 B를 골라 주세요.");
    const roomRef = roomReference(roomId);
    const choiceRef = choiceReference(roomId, user.uid);
    const [roomSnapshot, choiceSnapshot] = await Promise.all([getDoc(roomRef), getDoc(choiceRef)]);
    if (!roomSnapshot.exists()) throw storeError("room/not-found", "소수결 생존 방을 찾지 못했습니다.");
    const room = core.normalizeRoomSnapshot(roomSnapshot.data(), roomId);
    if (room.status !== "voting" || room.currentRound !== round) {
      throw storeError("room/bad-state", "투표 라운드가 이미 바뀌었습니다.");
    }
    if (!room.activeUids.includes(user.uid) || room.submittedUids.includes(user.uid)) {
      throw storeError("choice/already-submitted", "이번 선택은 이미 확정했습니다.");
    }
    const deadline = core.choiceDeadlineMillis(room);
    if (deadline && Date.now() >= deadline) throw storeError("choice/closed", "선택 시간이 끝났습니다.");
    if (choiceSnapshot.exists() && Number(choiceSnapshot.data().round) >= round) {
      throw storeError("choice/already-submitted", "이번 선택은 이미 확정했습니다.");
    }
    const batch = writeBatch(database);
    batch.set(choiceRef, { round, side, createdAt: serverTimestamp() });
    batch.update(roomRef, { submittedUids: arrayUnion(user.uid), updatedAt: serverTimestamp() });
    await batch.commit();
  }

  async function getOwnChoice(roomId) {
    const snapshot = await getDoc(choiceReference(roomId));
    return snapshot.exists() ? snapshot.data() : null;
  }

  async function revealRound(roomId) {
    requireUser();
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const choiceSnapshots = await getDocs(choicesReference(roomId));
        const choices = choiceSnapshots.docs.map((item) => ({ uid: item.id, ...item.data() }));
        let finalResult = null;
        await runTransaction(database, async (transaction) => {
          const roomRef = roomReference(roomId);
          const roomSnapshot = await transaction.get(roomRef);
          if (!roomSnapshot.exists()) throw storeError("room/not-found", "소수결 생존 방을 찾지 못했습니다.");
          const room = core.normalizeRoomSnapshot(roomSnapshot.data(), roomId);
          if (room.status !== "voting") throw storeError("room/bad-state", "이미 결과가 공개되었습니다.");
          const roundChoices = choices.filter((choice) => Number(choice.round) === room.currentRound);
          const choiceUids = new Set(roundChoices.map((choice) => String(choice.uid)));
          if (room.submittedUids.some((uid) => !choiceUids.has(uid))) {
            throw storeError("minority/stale-choices", "최신 투표를 불러오는 중입니다.");
          }
          const result = core.scoreRound(roundChoices, room.activeUids);
          const awardedUids = Object.entries(result.awardPoints)
            .filter(([, points]) => Number(points) > 0)
            .map(([uid]) => uid);
          const playerSnapshots = await Promise.all(
            awardedUids.map((uid) => transaction.get(playerReference(roomId, uid)))
          );
          transaction.update(roomRef, {
            status: "revealed",
            roundStartedAt: null,
            countA: result.countA,
            countB: result.countB,
            resultKind: result.resultKind,
            lastAwardPoints: result.awardPoints,
            updatedAt: serverTimestamp(),
          });
          playerSnapshots.forEach((snapshot, index) => {
            if (!snapshot.exists()) return;
            const uid = awardedUids[index];
            const points = Number(result.awardPoints[uid] || 0);
            const player = snapshot.data();
            transaction.update(snapshot.ref, {
              score: Number(player.score || 0) + points,
              survivalWins: Number(player.survivalWins || 0) + (points >= 2 ? 1 : 0),
              rareWins: Number(player.rareWins || 0) + (points === 3 ? 1 : 0),
              updatedAt: serverTimestamp(),
            });
          });
          finalResult = result;
        });
        return finalResult;
      } catch (error) {
        lastError = error;
        if (!retryable(error) || attempt === 2) throw error;
      }
    }
    throw lastError;
  }

  async function nextRound(roomId) {
    requireUser();
    const roomSnapshot = await getDoc(roomReference(roomId));
    if (!roomSnapshot.exists()) throw storeError("room/not-found", "소수결 생존 방을 찾지 못했습니다.");
    const current = core.normalizeRoomSnapshot(roomSnapshot.data(), roomId);
    const next = current.currentRound + 1;
    const questionSnapshot = await getDoc(questionReference(roomId, next));
    if (!questionSnapshot.exists()) throw new Error("다음 질문을 찾지 못했습니다.");
    const question = core.normalizeQuestion(questionSnapshot.data());
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const latestSnapshot = await transaction.get(reference);
      if (!latestSnapshot.exists()) throw storeError("room/not-found", "소수결 생존 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(latestSnapshot.data(), roomId);
      if (room.status !== "revealed" || room.currentRound + 1 !== next || next > room.totalRounds) {
        throw storeError("room/bad-state", "다음 라운드 상태가 이미 바뀌었습니다.");
      }
      transaction.update(reference, {
        status: "voting",
        currentRound: next,
        currentPrompt: question.prompt,
        optionA: question.optionA,
        optionB: question.optionB,
        roundStartedAt: serverTimestamp(),
        submittedUids: [],
        countA: 0,
        countB: 0,
        resultKind: "",
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
    configureQuestions,
    loadQuestions,
    updateFutureQuestion,
    startGame,
    submitChoice,
    getOwnChoice,
    revealRound,
    nextRound,
    finishGame,
  });
}
