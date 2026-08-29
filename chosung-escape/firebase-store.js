import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc,
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

const core = globalThis.ChosungEscapeCore;
if (!core) throw new Error("초성 탈출 규칙 모듈을 불러오지 못했습니다.");

function publicFirebaseConfig(config) {
  return { apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId };
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function createChosungStore(config) {
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
    return doc(database, "chosungRooms", core.normalizeRoomId(roomId));
  }

  function playersReference(roomId) {
    return collection(roomReference(roomId), "players");
  }

  function playerReference(roomId, uid = requireUser().uid) {
    return doc(playersReference(roomId), uid);
  }

  function secretsReference(roomId) {
    return collection(roomReference(roomId), "secrets");
  }

  function secretReference(roomId, questionIndex) {
    return doc(secretsReference(roomId), `Q${String(questionIndex + 1).padStart(2, "0")}`);
  }

  function guessesReference(roomId) {
    return collection(roomReference(roomId), "guesses");
  }

  async function createRoom(value) {
    const user = requireUser();
    const room = {
      version: core.ROOM_VERSION,
      title: core.normalizeTitle(value?.title),
      status: "lobby",
      ownerUid: user.uid,
      questions: [],
      totalQuestions: 0,
      currentQuestion: 0,
      clueStage: 0,
      activeUids: [],
      solvedUids: [],
      revealedAnswer: "",
      eventId: "",
      matchId: "",
    };
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const roomId = core.createRoomId();
      try {
        await setDoc(roomReference(roomId), {
          ...room,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return roomId;
      } catch (error) {
        lastError = error;
        if (error?.code !== "permission-denied" && error?.code !== "already-exists") throw error;
      }
    }
    throw lastError || new Error("초성 탈출 방을 만들지 못했습니다.");
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
    } else {
      await setDoc(reference, {
        nickname,
        score: 0,
        solvedQuestions: [],
        lastResult: "none",
        lastQuestion: 0,
        lastAwardPoints: 0,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  async function removePlayer(roomId, uid) {
    requireUser();
    await deleteDoc(playerReference(roomId, uid));
  }

  async function configureQuestions(roomId, values) {
    requireUser();
    const questions = core.normalizeQuestions(values);
    const existing = await getDocs(secretsReference(roomId));
    const existingById = new Map(existing.docs.map((item) => [item.id, item.data()]));
    const batch = writeBatch(database);
    questions.forEach((question, index) => {
      const reference = secretReference(roomId, index);
      const old = existingById.get(reference.id);
      batch.set(reference, {
        answer: question.answer,
        createdAt: old?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      existingById.delete(reference.id);
    });
    existingById.forEach((_value, id) => batch.delete(doc(secretsReference(roomId), id)));
    batch.update(roomReference(roomId), {
      questions: questions.map(core.publicQuestion),
      totalQuestions: questions.length,
      currentQuestion: 0,
      clueStage: 0,
      revealedAnswer: "",
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  async function loadSecrets(roomId) {
    requireUser();
    const snapshot = await getDocs(query(secretsReference(roomId), orderBy("createdAt", "asc")));
    return snapshot.docs.map((item) => ({ id: item.id, answer: String(item.data().answer || "") }));
  }

  async function startGame(roomId, activeUidsValue) {
    requireUser();
    const activeUids = Array.from(new Set((activeUidsValue || []).map(String)));
    if (!activeUids.length) throw new Error("참가자가 한 명 이상 필요합니다.");
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "초성 탈출 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.totalQuestions < core.QUESTION_MIN) throw new Error("문제를 먼저 저장해 주세요.");
      transaction.update(reference, {
        status: "answering",
        currentQuestion: 0,
        clueStage: 0,
        activeUids,
        solvedUids: [],
        revealedAnswer: "",
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function submitGuess(roomId, question, clueStage, textValue) {
    const user = requireUser();
    const text = core.normalizeAnswer(textValue);
    if (!core.answerKey(text)) throw new Error("정답을 입력해 주세요.");
    return addDoc(guessesReference(roomId), {
      uid: user.uid,
      question: Number(question),
      clueStage: core.normalizeClueStage(clueStage),
      text,
      status: "pending",
      correct: false,
      awardedPoints: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  function subscribeGuesses(roomId, callback, onError) {
    return onSnapshot(guessesReference(roomId), (snapshot) => {
      callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    }, onError);
  }

  async function resolveGuess(roomId, guess, correctValue) {
    requireUser();
    let result = null;
    await runTransaction(database, async (transaction) => {
      const roomRef = roomReference(roomId);
      const guessRef = doc(guessesReference(roomId), guess.id);
      const playerRef = playerReference(roomId, guess.uid);
      const [roomSnapshot, guessSnapshot, playerSnapshot] = await Promise.all([
        transaction.get(roomRef), transaction.get(guessRef), transaction.get(playerRef),
      ]);
      if (!roomSnapshot.exists() || !guessSnapshot.exists() || !playerSnapshot.exists()) return;
      const room = core.normalizeRoomSnapshot(roomSnapshot.data(), roomId);
      const storedGuess = guessSnapshot.data();
      if (storedGuess.status !== "pending") return;
      const eligible = room.status === "answering" &&
        storedGuess.question === room.currentQuestion &&
        room.activeUids.includes(storedGuess.uid) &&
        !room.solvedUids.includes(storedGuess.uid);
      const correct = Boolean(correctValue && eligible);
      const points = correct ? core.pointsForStage(storedGuess.clueStage) : 0;
      const player = playerSnapshot.data();
      const solvedQuestions = Array.isArray(player.solvedQuestions) ? player.solvedQuestions : [];
      transaction.update(guessRef, {
        status: "resolved",
        correct,
        awardedPoints: points,
        updatedAt: serverTimestamp(),
      });
      transaction.update(playerRef, {
        score: Number(player.score || 0) + points,
        solvedQuestions: correct ? Array.from(new Set([...solvedQuestions, room.currentQuestion])) : solvedQuestions,
        lastResult: correct ? "correct" : "wrong",
        lastQuestion: room.currentQuestion,
        lastAwardPoints: points,
        updatedAt: serverTimestamp(),
      });
      if (correct) {
        transaction.update(roomRef, {
          solvedUids: Array.from(new Set([...room.solvedUids, storedGuess.uid])),
          updatedAt: serverTimestamp(),
        });
      }
      result = { correct, points };
    });
    return result;
  }

  async function revealNextClue(roomId) {
    requireUser();
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) return;
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.status !== "answering" || room.clueStage >= core.CLUE_STAGE_MAX) return;
      transaction.update(reference, { clueStage: room.clueStage + 1, updatedAt: serverTimestamp() });
    });
  }

  async function revealAnswer(roomId, answerValue) {
    requireUser();
    const answer = core.normalizeAnswer(answerValue);
    if (!answer) throw new Error("공개할 정답을 찾지 못했습니다.");
    await updateDoc(roomReference(roomId), {
      status: "revealed",
      revealedAnswer: answer,
      updatedAt: serverTimestamp(),
    });
  }

  async function nextQuestion(roomId) {
    requireUser();
    await runTransaction(database, async (transaction) => {
      const reference = roomReference(roomId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) return;
      const room = core.normalizeRoomSnapshot(snapshot.data(), roomId);
      if (room.status !== "revealed" || room.currentQuestion + 1 >= room.totalQuestions) return;
      transaction.update(reference, {
        status: "answering",
        currentQuestion: room.currentQuestion + 1,
        clueStage: 0,
        solvedUids: [],
        revealedAnswer: "",
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
    loadSecrets,
    startGame,
    submitGuess,
    subscribeGuesses,
    resolveGuess,
    revealNextClue,
    revealAnswer,
    nextQuestion,
    finishGame,
  });
}
