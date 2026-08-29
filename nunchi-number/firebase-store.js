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
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const core = globalThis.NunchiNumberCore;

if (!core) throw new Error("눈치 숫자 규칙 모듈을 불러오지 못했습니다.");

function publicFirebaseConfig(config) {
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
  };
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function createNunchiStore(config) {
  if (!core.firebaseConfigReady(config)) {
    throw new Error("Firebase 웹 설정이 아직 연결되지 않았습니다.");
  }

  const app = getApps().find((candidate) => candidate.name === "guild-events") ||
    initializeApp(publicFirebaseConfig(config), "guild-events");
  const auth = getAuth(app);
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (_error) {
    // 저장소가 제한된 브라우저에서도 현재 탭 세션은 계속 사용한다.
  }
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);

  const database = getFirestore(app);

  function requireUser() {
    if (!auth.currentUser) throw storeError("auth/unauthenticated", "참가자 연결이 끊겼습니다.");
    return auth.currentUser;
  }

  function roomReference(roomId) {
    return doc(database, "nunchiRooms", core.normalizeRoomId(roomId));
  }

  function playersReference(roomId) {
    return collection(roomReference(roomId), "players");
  }

  function playerReference(roomId, uid = requireUser().uid) {
    return doc(playersReference(roomId), String(uid));
  }

  function choicesReference(roomId) {
    return collection(roomReference(roomId), "choices");
  }

  function choiceReference(roomId, uid = requireUser().uid) {
    return doc(choicesReference(roomId), String(uid));
  }

  async function createRoom(value) {
    const user = requireUser();
    const room = {
      version: core.ROOM_VERSION,
      title: core.normalizeRoomTitle(value?.title),
      totalRounds: core.normalizeTotalRounds(value?.totalRounds),
      scoreMode: core.normalizeScoreMode(value?.scoreMode),
      cardPoints: [],
      status: "lobby",
      round: 0,
      numberMax: 0,
      ownerUid: user.uid,
      activeUids: [],
      submittedUids: [],
      resultRound: 0,
      lastWinningNumber: 0,
      lastWinnerUids: [],
      lastAwardPoints: {},
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
    throw lastError || new Error("눈치 숫자 방을 만들지 못했습니다.");
  }

  function subscribeRoom(roomId, onValue, onError) {
    requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    return onSnapshot(
      roomReference(normalizedId),
      { includeMetadataChanges: true },
      (snapshot) => {
        try {
          if (!snapshot.exists()) {
            onValue(null);
            return;
          }
          onValue({
            room: core.normalizeRoomSnapshot(snapshot.data(), normalizedId),
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
          });
        } catch (error) {
          onError?.(error);
        }
      },
      onError,
    );
  }

  function subscribePlayers(roomId, onValue, onError) {
    requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    return onSnapshot(
      query(playersReference(normalizedId), orderBy("joinedAt", "asc")),
      { includeMetadataChanges: true },
      (snapshot) => {
        try {
          onValue({
            players: snapshot.docs.map((playerDocument) =>
              core.normalizePlayerSnapshot(playerDocument.data(), playerDocument.id),
            ),
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
          });
        } catch (error) {
          onError?.(error);
        }
      },
      onError,
    );
  }

  async function savePlayer(roomId, nickname) {
    const user = requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    const cleanNickname = core.normalizeNickname(nickname);
    const reference = playerReference(normalizedId, user.uid);
    await runTransaction(database, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists()) {
        transaction.update(reference, {
          nickname: cleanNickname,
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.set(reference, {
          nickname: cleanNickname,
          score: 0,
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  }

  async function removePlayer(roomId, uid = requireUser().uid) {
    requireUser();
    await deleteDoc(playerReference(roomId, uid));
  }

  async function startGame(roomId, playerUids) {
    const user = requireUser();
    const activeUids = core.normalizeUidList(playerUids, "참가자 목록");
    if (activeUids.length < 1) throw new Error("게임을 시작하려면 참가자가 한 명 이상 필요합니다.");
    const numberMax = core.numberMaxForPlayers(activeUids.length);
    const roomRef = roomReference(roomId);
    await runTransaction(database, async (transaction) => {
      const roomSnapshot = await transaction.get(roomRef);
      if (!roomSnapshot.exists()) throw storeError("room/not-found", "눈치 숫자 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(roomSnapshot.data(), core.normalizeRoomId(roomId));
      if (room.ownerUid !== user.uid) {
        throw storeError("room/not-owner", "게임을 만든 진행자만 시작할 수 있습니다.");
      }
      if (room.status === "choosing" && room.round === 1) return;
      if (room.status !== "lobby") {
        throw storeError("room/not-lobby", "이미 게임이 시작되었거나 방 상태가 바뀌었습니다.");
      }
      transaction.update(roomRef, {
        status: "choosing",
        round: 1,
        numberMax,
        cardPoints: core.createRoundCardPoints(numberMax, room.scoreMode),
        activeUids,
        submittedUids: [],
        resultRound: 0,
        lastWinningNumber: 0,
        lastWinnerUids: [],
        lastAwardPoints: {},
        updatedAt: serverTimestamp(),
      });
    });
    return numberMax;
  }

  async function submitChoice(roomId, value) {
    const user = requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    const retryableCodes = new Set(["permission-denied", "failed-precondition", "aborted"]);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        return await runTransaction(database, async (transaction) => {
          const roomRef = roomReference(normalizedId);
          const choiceRef = choiceReference(normalizedId, user.uid);
          const roomSnapshot = await transaction.get(roomRef);
          if (!roomSnapshot.exists()) throw storeError("room/not-found", "눈치 숫자 방을 찾지 못했습니다.");
          const previousChoice = await transaction.get(choiceRef);
          const room = core.normalizeRoomSnapshot(roomSnapshot.data(), normalizedId);
          if (room.status !== "choosing") throw storeError("room/not-choosing", "지금은 숫자를 제출할 수 없습니다.");
          if (!room.activeUids.includes(user.uid)) throw storeError("room/not-active", "이번 라운드의 선택 대상이 아닙니다.");
          if (room.submittedUids.includes(user.uid)) {
            if (previousChoice.exists() && Number(previousChoice.data().round) === room.round) {
              return core.normalizeChoiceSnapshot(previousChoice.data(), user.uid, room.numberMax);
            }
            throw storeError("choice/already-submitted", "이번 라운드 숫자는 이미 제출했습니다.");
          }
          if (previousChoice.exists() && Number(previousChoice.data().round) >= room.round) {
            throw storeError("choice/already-submitted", "이번 라운드 숫자는 이미 제출했습니다.");
          }

          const savedChoice = {
            uid: user.uid,
            round: room.round,
            number: core.normalizeChoice(value, room.numberMax),
          };
          transaction.set(choiceRef, {
            round: savedChoice.round,
            number: savedChoice.number,
            createdAt: serverTimestamp(),
          });
          transaction.update(roomRef, {
            submittedUids: [...room.submittedUids, user.uid],
            updatedAt: serverTimestamp(),
          });
          return savedChoice;
        });
      } catch (error) {
        const code = String(error?.code || "").replace(/^firestore\//, "");
        if (!retryableCodes.has(code) || attempt === 11) throw error;
        await new Promise((resolve) => {
          window.setTimeout(resolve, 35 * (attempt + 1) + Math.random() * 90);
        });
      }
    }
    throw new Error("숫자를 제출하지 못했습니다.");
  }

  async function getOwnChoice(roomId, numberMax) {
    const user = requireUser();
    const snapshot = await getDoc(choiceReference(roomId, user.uid));
    if (!snapshot.exists()) return null;
    return core.normalizeChoiceSnapshot(snapshot.data(), user.uid, numberMax);
  }

  async function getChoices(roomId, round, numberMax) {
    requireUser();
    const normalizedRound = core.normalizeRound(round);
    const maximum = core.normalizeNumberMax(numberMax);
    const snapshot = await getDocs(query(choicesReference(roomId), orderBy("number", "asc")));
    return snapshot.docs
      .map((choiceDocument) => core.normalizeChoiceSnapshot(choiceDocument.data(), choiceDocument.id, maximum))
      .filter((choice) => choice.round === normalizedRound);
  }

  async function revealRound(roomId) {
    requireUser();
    await updateDoc(roomReference(roomId), {
      status: "revealed",
      updatedAt: serverTimestamp(),
    });
  }

  async function recordRoundResult(roomId, roundValue, winningNumberValue, awardsValue) {
    requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    const round = core.normalizeRound(roundValue);
    if (!Array.isArray(awardsValue) || awardsValue.length > core.MAX_PLAYERS) {
      throw new Error("라운드 점수 목록이 올바르지 않습니다.");
    }
    const awardUids = core.normalizeUidList(awardsValue.map((award) => award?.uid), "라운드 승자 목록");
    const winningNumber = Number(winningNumberValue);
    if (!Number.isInteger(winningNumber) || winningNumber < 0 || winningNumber > core.MAX_PLAYERS) {
      throw new Error("라운드 승리 숫자가 올바르지 않습니다.");
    }
    if ((winningNumber === 0) !== (awardUids.length === 0)) {
      throw new Error("라운드 승자와 승리 숫자가 일치하지 않습니다.");
    }
    let recorded = false;
    await runTransaction(database, async (transaction) => {
      const roomRef = roomReference(normalizedId);
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists()) throw storeError("room/not-found", "눈치 숫자 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), normalizedId);
      if (room.status !== "revealed" || room.round !== round) return;
      if (room.resultRound >= round) return;
      if (winningNumber > room.numberMax) throw new Error("라운드 승리 숫자가 범위를 벗어났습니다.");
      const awards = awardsValue.map((award) => {
        const number = core.normalizeChoice(award?.number, room.numberMax);
        const points = core.cardPointForNumber(number, room.numberMax, room.scoreMode, room.cardPoints);
        if (Number(award?.points) !== points) throw new Error("라운드 점수가 카드 배치와 일치하지 않습니다.");
        return { uid: String(award.uid), number, points };
      });
      transaction.update(roomRef, {
        resultRound: round,
        lastWinningNumber: winningNumber,
        lastWinnerUids: awardUids,
        lastAwardPoints: Object.fromEntries(awards.map((award) => [award.uid, award.points])),
        updatedAt: serverTimestamp(),
      });
      awards.forEach((award) => {
        transaction.update(playerReference(normalizedId, award.uid), {
          score: increment(award.points),
          updatedAt: serverTimestamp(),
        });
      });
      recorded = true;
    });
    return recorded;
  }

  async function nextRound(roomId, roundValue, activeUidsValue) {
    requireUser();
    const round = core.normalizeRound(roundValue);
    const activeUids = core.normalizeUidList(activeUidsValue, "다음 라운드 참가자 목록");
    if (activeUids.length < 1) throw new Error("다음 라운드 참가자가 필요합니다.");
    const roomRef = roomReference(roomId);
    const roomSnapshot = await getDoc(roomRef);
    if (!roomSnapshot.exists()) throw storeError("room/not-found", "눈치 숫자 방을 찾지 못했습니다.");
    const room = core.normalizeRoomSnapshot(roomSnapshot.data(), core.normalizeRoomId(roomId));
    const numberMax = core.numberMaxForPlayers(activeUids.length);
    await updateDoc(roomRef, {
      status: "choosing",
      round,
      numberMax,
      cardPoints: core.createRoundCardPoints(numberMax, room.scoreMode),
      activeUids,
      submittedUids: [],
      lastWinningNumber: 0,
      lastWinnerUids: [],
      lastAwardPoints: {},
      updatedAt: serverTimestamp(),
    });
  }

  async function finishGame(roomId) {
    requireUser();
    await updateDoc(roomReference(roomId), {
      status: "finished",
      updatedAt: serverTimestamp(),
    });
  }

  return {
    get user() {
      return auth.currentUser;
    },
    createRoom,
    subscribeRoom,
    subscribePlayers,
    savePlayer,
    removePlayer,
    startGame,
    submitChoice,
    getOwnChoice,
    getChoices,
    revealRound,
    recordRoundResult,
    nextRound,
    finishGame,
  };
}
