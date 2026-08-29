import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
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

const core = globalThis.EventCore;
if (!core) throw new Error("이벤트 규칙 모듈을 불러오지 못했습니다.");

function publicConfig(config) {
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
  };
}

function snapshotData(snapshot) {
  if (!snapshot.exists()) return null;
  const value = snapshot.data();
  return {
    id: snapshot.id,
    ...value,
    createdAtMs: value.createdAt?.toMillis?.() || 0,
    joinedAtMs: value.joinedAt?.toMillis?.() || 0,
  };
}

function eventError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function createEventStore(config) {
  const app = getApps().find((candidate) => candidate.name === "guild-events") ||
    initializeApp(publicConfig(config), "guild-events");
  const auth = getAuth(app);
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (_error) {
    // 제한된 브라우저에서도 현재 탭의 인증은 계속 사용한다.
  }
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const database = getFirestore(app);

  function user() {
    if (!auth.currentUser) throw eventError("auth/unauthenticated", "참가자 연결이 끊겼습니다.");
    return auth.currentUser;
  }

  function eventRef(eventId) {
    return doc(database, "eventRooms", core.normalizeRoomId(eventId));
  }

  function participantsRef(eventId) {
    return collection(eventRef(eventId), "participants");
  }

  function participantRef(eventId, uid = user().uid) {
    return doc(participantsRef(eventId), uid);
  }

  function matchesRef(eventId) {
    return collection(eventRef(eventId), "matches");
  }

  function matchRef(eventId, matchId) {
    return doc(matchesRef(eventId), matchId);
  }

  function readinessRef(eventId, matchId, participantUid) {
    return doc(matchRef(eventId, matchId), "readiness", participantUid);
  }

  function ledgerRef(eventId) {
    return collection(eventRef(eventId), "ledger");
  }

  async function createEvent(value) {
    const currentUser = user();
    const title = core.normalizeTitle(value?.title) || "오늘의 길드 이벤트";
    const nickname = core.normalizeNickname(value?.nickname);
    if (!nickname) throw eventError("event/nickname-required", "진행자 이름을 입력해 주세요.");

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const eventId = core.createRoomId();
      try {
        await runTransaction(database, async (transaction) => {
          const reference = eventRef(eventId);
          const existing = await transaction.get(reference);
          if (existing.exists()) throw eventError("event/code-collision", "방 코드가 겹쳤습니다.");
          transaction.set(reference, {
            version: 1,
            title,
            status: "lobby",
            ownerUid: currentUser.uid,
            joinOpen: true,
            currentMatchId: "",
            currentGame: "",
            matchNumber: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          transaction.set(participantRef(eventId), {
            nickname,
            totalScore: 0,
            eligibleFromMatch: 1,
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        return eventId;
      } catch (error) {
        if (error?.code !== "event/code-collision" && error?.code !== "permission-denied") throw error;
      }
    }
    throw eventError("event/create-failed", "이벤트 방을 만들지 못했습니다. 다시 시도해 주세요.");
  }

  async function readEvent(eventId) {
    return snapshotData(await getDoc(eventRef(eventId)));
  }

  async function joinEvent(eventId, nicknameValue) {
    const currentUser = user();
    const nickname = core.normalizeNickname(nicknameValue);
    if (!nickname) throw eventError("event/nickname-required", "참가자 이름을 입력해 주세요.");
    const normalizedId = core.normalizeRoomId(eventId);

    await runTransaction(database, async (transaction) => {
      const roomReference = eventRef(normalizedId);
      const memberReference = participantRef(normalizedId);
      const roomSnapshot = await transaction.get(roomReference);
      if (!roomSnapshot.exists()) throw eventError("event/not-found", "이벤트 방을 찾지 못했습니다.");
      const room = roomSnapshot.data();
      if (!room.joinOpen || room.status === "finished") {
        throw eventError("event/join-closed", "참가 접수가 끝난 이벤트입니다.");
      }

      const memberSnapshot = await transaction.get(memberReference);
      let activeMatchReference = null;
      let activeMatchSnapshot = null;
      if (!memberSnapshot.exists() && room.status === "preparing" && room.currentMatchId) {
        activeMatchReference = matchRef(normalizedId, room.currentMatchId);
        activeMatchSnapshot = await transaction.get(activeMatchReference);
      }

      if (memberSnapshot.exists()) {
        transaction.update(memberReference, { nickname, updatedAt: serverTimestamp() });
        return;
      }

      const eligible = core.eligibleFromMatch(room.status, room.matchNumber);
      transaction.set(memberReference, {
        nickname,
        totalScore: 0,
        eligibleFromMatch: eligible,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (activeMatchSnapshot?.exists()) {
        const match = activeMatchSnapshot.data();
        const participantUids = Array.from(new Set([...(match.participantUids || []), currentUser.uid]));
        transaction.update(activeMatchReference, { participantUids, updatedAt: serverTimestamp() });
      }
    });
  }

  function subscribeEvent(eventId, callback, onError) {
    return onSnapshot(eventRef(eventId), (snapshot) => callback(snapshotData(snapshot)), onError);
  }

  function subscribeParticipants(eventId, callback, onError) {
    return onSnapshot(
      query(participantsRef(eventId), orderBy("joinedAt", "asc")),
      (snapshot) => callback(snapshot.docs.map(snapshotData)),
      onError
    );
  }

  function subscribeMatches(eventId, callback, onError) {
    return onSnapshot(
      query(matchesRef(eventId), orderBy("createdAt", "asc")),
      (snapshot) => callback(snapshot.docs.map(snapshotData)),
      onError
    );
  }

  function subscribeLedger(eventId, callback, onError) {
    return onSnapshot(
      query(ledgerRef(eventId), orderBy("createdAt", "asc")),
      (snapshot) => callback(snapshot.docs.map(snapshotData)),
      onError
    );
  }

  async function startEvent(eventId) {
    const room = await readEvent(eventId);
    if (!room || room.ownerUid !== user().uid) throw eventError("event/not-owner", "진행자만 시작할 수 있습니다.");
    await updateDoc(eventRef(eventId), { status: "selecting", updatedAt: serverTimestamp() });
  }

  async function selectGame(eventId, options) {
    const room = await readEvent(eventId);
    if (!room || room.ownerUid !== user().uid) throw eventError("event/not-owner", "진행자만 게임을 고를 수 있습니다.");
    if (!['selecting', 'review'].includes(room.status)) throw eventError("event/bad-state", "지금은 새 게임을 열 수 없습니다.");
    const gameType = options?.gameType;
    if (!core.GAME_TYPES.includes(gameType)) throw eventError("event/bad-game", "지원하지 않는 게임입니다.");

    const participantSnapshots = await getDocs(participantsRef(eventId));
    const participantUids = participantSnapshots.docs
      .filter((snapshot) => Number(snapshot.data().eligibleFromMatch || 1) <= room.matchNumber + 1)
      .map((snapshot) => snapshot.id);
    if (!participantUids.length) throw eventError("event/no-players", "참가자가 한 명 이상 필요합니다.");

    const matchNumber = room.matchNumber + 1;
    const matchId = `M${String(matchNumber).padStart(3, "0")}`;
    const gameRoomId = core.createRoomId();
    const title = `${room.title} · ${core.GAME_LABELS[gameType]}`.slice(0, 40);

    await runTransaction(database, async (transaction) => {
      const roomReference = eventRef(eventId);
      const latestSnapshot = await transaction.get(roomReference);
      if (!latestSnapshot.exists() || latestSnapshot.data().ownerUid !== user().uid) {
        throw eventError("event/not-owner", "진행자 권한을 확인하지 못했습니다.");
      }
      if (!['selecting', 'review'].includes(latestSnapshot.data().status) || latestSnapshot.data().matchNumber !== room.matchNumber) {
        throw eventError("event/bad-state", "다른 화면에서 진행 상태가 바뀌었습니다.");
      }

      transaction.set(matchRef(eventId, matchId), {
        version: 1,
        gameType,
        title,
        status: "preparing",
        gameRoomId,
        participantUids,
        awards: {},
        resultSummary: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (gameType === "bingo") {
        transaction.set(doc(database, "bingoRooms", gameRoomId), {
          version: 1,
          title,
          targetLines: Math.min(5, Math.max(1, Number(options?.targetLines) || 3)),
          status: "lobby",
          ownerUid: user().uid,
          calledNumbers: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (gameType === "nunchi") {
        const rounds = Math.min(10, Math.max(3, Number(options?.totalRounds) || 5));
        const choiceSeconds = [10, 15, 20, 30].includes(Number(options?.choiceSeconds))
          ? Number(options.choiceSeconds)
          : 20;
        const scoreMode = ["descending", "exact", "random"].includes(options?.scoreMode)
          ? options.scoreMode
          : "descending";
        transaction.set(doc(database, "nunchiRooms", gameRoomId), {
          version: 1,
          title,
          totalRounds: rounds,
          choiceSeconds,
          roundStartedAt: null,
          scoreMode,
          cardPoints: [],
          status: "lobby",
          round: 0,
          numberMax: 0,
          ownerUid: user().uid,
          activeUids: [],
          submittedUids: [],
          resultRound: 0,
          lastWinningNumber: 0,
          lastWinnerUids: [],
          lastAwardPoints: {},
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (gameType === "chosung") {
        const clueSeconds = [15, 20, 30].includes(Number(options?.clueSeconds))
          ? Number(options.clueSeconds)
          : 20;
        transaction.set(doc(database, "chosungRooms", gameRoomId), {
          version: 1,
          title,
          status: "lobby",
          ownerUid: user().uid,
          questions: [],
          totalQuestions: 0,
          currentQuestion: 0,
          clueStage: 0,
          clueSeconds,
          stageStartedAt: null,
          activeUids: [],
          solvedUids: [],
          revealedAnswer: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (gameType === "minority") {
        const choiceSeconds = [10, 15, 20].includes(Number(options?.choiceSeconds))
          ? Number(options.choiceSeconds)
          : 15;
        transaction.set(doc(database, "minorityRooms", gameRoomId), {
          version: 1,
          title,
          status: "lobby",
          ownerUid: user().uid,
          totalRounds: 0,
          currentRound: 0,
          currentPrompt: "",
          optionA: "",
          optionB: "",
          choiceSeconds,
          roundStartedAt: null,
          activeUids: [],
          submittedUids: [],
          countA: 0,
          countB: 0,
          resultKind: "",
          lastAwardPoints: {},
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const totalRounds = [3, 5, 7].includes(Number(options?.totalRounds))
          ? Number(options.totalRounds)
          : 5;
        transaction.set(doc(database, "timingRooms", gameRoomId), {
          version: 1,
          title,
          status: "lobby",
          ownerUid: user().uid,
          totalRounds,
          round: 0,
          targetSeconds: 0,
          announcedAt: null,
          activeUids: [],
          submittedUids: [],
          resultRound: 0,
          lastElapsedMillis: {},
          lastErrorMillis: {},
          lastAwardPoints: {},
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.update(roomReference, {
        status: "preparing",
        currentMatchId: matchId,
        currentGame: gameType,
        matchNumber,
        updatedAt: serverTimestamp(),
      });
    });
    return { matchId, gameRoomId, gameType };
  }

  async function chooseNextGame(eventId) {
    const room = await readEvent(eventId);
    if (!room || room.ownerUid !== user().uid) throw eventError("event/not-owner", "진행자만 다음 게임을 열 수 있습니다.");
    await updateDoc(eventRef(eventId), {
      status: "selecting",
      currentMatchId: "",
      currentGame: "",
      updatedAt: serverTimestamp(),
    });
  }

  async function cancelPreparedGame(eventId) {
    const normalizedId = core.normalizeRoomId(eventId);
    const room = await readEvent(normalizedId);
    if (!room || room.ownerUid !== user().uid) {
      throw eventError("event/not-owner", "진행자만 준비 중인 게임을 다시 고를 수 있습니다.");
    }
    if (room.status !== "preparing" || !room.currentMatchId) {
      throw eventError("event/bad-state", "이미 게임이 시작됐거나 준비 상태가 바뀌었습니다.");
    }

    await runTransaction(database, async (transaction) => {
      const roomReference = eventRef(normalizedId);
      const preparedMatchReference = matchRef(normalizedId, room.currentMatchId);
      const latestRoomSnapshot = await transaction.get(roomReference);
      const latestMatchSnapshot = await transaction.get(preparedMatchReference);

      if (!latestRoomSnapshot.exists() || latestRoomSnapshot.data().ownerUid !== user().uid) {
        throw eventError("event/not-owner", "진행자 권한을 확인하지 못했습니다.");
      }
      const latestRoom = latestRoomSnapshot.data();
      if (
        latestRoom.status !== "preparing" ||
        latestRoom.currentMatchId !== room.currentMatchId ||
        latestRoom.matchNumber !== room.matchNumber ||
        !latestMatchSnapshot.exists() ||
        latestMatchSnapshot.data().status !== "preparing"
      ) {
        throw eventError("event/bad-state", "다른 화면에서 게임 준비 상태가 바뀌었습니다.");
      }

      const preparedMatch = latestMatchSnapshot.data();
      const gameCollections = {
        bingo: "bingoRooms",
        nunchi: "nunchiRooms",
        chosung: "chosungRooms",
        minority: "minorityRooms",
        timing: "timingRooms",
      };
      const gameCollection = gameCollections[preparedMatch.gameType];
      if (!gameCollection) throw eventError("event/bad-game", "준비 중인 게임 정보를 확인하지 못했습니다.");

      preparedMatch.participantUids.forEach((participantUid) => {
        transaction.delete(readinessRef(normalizedId, room.currentMatchId, participantUid));
      });
      transaction.delete(doc(database, gameCollection, preparedMatch.gameRoomId));
      transaction.delete(preparedMatchReference);
      transaction.update(roomReference, {
        status: "selecting",
        currentMatchId: "",
        currentGame: "",
        matchNumber: Math.max(0, latestRoom.matchNumber - 1),
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function finishEvent(eventId) {
    const room = await readEvent(eventId);
    if (!room || room.ownerUid !== user().uid) throw eventError("event/not-owner", "진행자만 최종 결산할 수 있습니다.");
    await updateDoc(eventRef(eventId), {
      status: "finished",
      joinOpen: false,
      updatedAt: serverTimestamp(),
    });
  }

  async function setJoinOpen(eventId, joinOpen) {
    const room = await readEvent(eventId);
    if (!room || room.ownerUid !== user().uid) throw eventError("event/not-owner", "진행자만 참가 접수를 바꿀 수 있습니다.");
    await updateDoc(eventRef(eventId), { joinOpen: Boolean(joinOpen), updatedAt: serverTimestamp() });
  }

  return Object.freeze({
    get uid() { return user().uid; },
    createEvent,
    readEvent,
    joinEvent,
    subscribeEvent,
    subscribeParticipants,
    subscribeMatches,
    subscribeLedger,
    startEvent,
    selectGame,
    cancelPreparedGame,
    chooseNextGame,
    finishEvent,
    setJoinOpen,
  });
}
