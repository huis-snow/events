import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
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
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const core = globalThis.GuildBingoCore;

if (!core) throw new Error("빙고 규칙 모듈을 불러오지 못했습니다.");

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

export async function createBingoStore(config) {
  if (!core.firebaseConfigReady(config)) {
    throw new Error("Firebase 웹 설정이 아직 연결되지 않았습니다.");
  }

  const app = initializeApp(publicFirebaseConfig(config), "guild-events-bingo");
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
    return doc(database, "bingoRooms", core.normalizeRoomId(roomId));
  }

  function playersReference(roomId) {
    return collection(roomReference(roomId), "players");
  }

  function playerReference(roomId, uid = requireUser().uid) {
    return doc(playersReference(roomId), uid);
  }

  async function createRoom(value) {
    const user = requireUser();
    const room = {
      version: core.ROOM_VERSION,
      title: core.normalizeRoomTitle(value?.title),
      targetLines: core.normalizeTargetLines(value?.targetLines),
      status: "lobby",
      ownerUid: user.uid,
      calledNumbers: [],
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
    throw lastError || new Error("빙고 방을 만들지 못했습니다.");
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

  async function savePlayer(roomId, value) {
    const user = requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    const player = {
      nickname: core.normalizeNickname(value?.nickname),
      board: core.normalizeBoard(value?.board),
    };
    const reference = playerReference(normalizedId, user.uid);

    await runTransaction(database, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists()) {
        transaction.update(reference, {
          ...player,
          updatedAt: serverTimestamp(),
        });
        return;
      }
      transaction.set(reference, {
        ...player,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function removePlayer(roomId, uid = requireUser().uid) {
    requireUser();
    await deleteDoc(playerReference(roomId, String(uid)));
  }

  async function setRoomStatus(roomId, status) {
    requireUser();
    if (!["lobby", "playing", "finished"].includes(status)) {
      throw new Error("바꿀 게임 상태가 올바르지 않습니다.");
    }
    await updateDoc(roomReference(roomId), {
      status,
      updatedAt: serverTimestamp(),
    });
  }

  async function callNumber(roomId, value) {
    const user = requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    const number = core.normalizeNumber(value, "주사위 결과");
    let duplicate = false;

    await runTransaction(database, async (transaction) => {
      const reference = roomReference(normalizedId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "빙고 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), normalizedId);
      if (room.ownerUid !== user.uid) throw storeError("room/not-owner", "방장만 숫자를 입력할 수 있습니다.");
      if (room.status !== "playing") throw storeError("room/not-playing", "게임을 시작한 뒤 입력해 주세요.");
      if (room.calledNumbers.includes(number)) {
        duplicate = true;
        return;
      }
      transaction.update(reference, {
        calledNumbers: [...room.calledNumbers, number],
        updatedAt: serverTimestamp(),
      });
    });

    return { number, duplicate };
  }

  async function drawRandomNumber(roomId) {
    const user = requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    let drawnNumber = null;

    await runTransaction(database, async (transaction) => {
      const reference = roomReference(normalizedId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "빙고 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), normalizedId);
      if (room.ownerUid !== user.uid) throw storeError("room/not-owner", "방장만 숫자를 뽑을 수 있습니다.");
      if (room.status !== "playing") throw storeError("room/not-playing", "게임을 시작한 뒤 숫자를 뽑아 주세요.");
      drawnNumber = core.randomRemainingNumber(room.calledNumbers);
      if (drawnNumber === null) return;
      transaction.update(reference, {
        calledNumbers: [...room.calledNumbers, drawnNumber],
        updatedAt: serverTimestamp(),
      });
    });

    return {
      number: drawnNumber,
      exhausted: drawnNumber === null,
    };
  }

  async function undoLastNumber(roomId) {
    const user = requireUser();
    const normalizedId = core.normalizeRoomId(roomId);
    let removed = null;

    await runTransaction(database, async (transaction) => {
      const reference = roomReference(normalizedId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw storeError("room/not-found", "빙고 방을 찾지 못했습니다.");
      const room = core.normalizeRoomSnapshot(snapshot.data(), normalizedId);
      if (room.ownerUid !== user.uid) throw storeError("room/not-owner", "방장만 입력을 취소할 수 있습니다.");
      if (room.calledNumbers.length === 0) return;
      const calledNumbers = [...room.calledNumbers];
      removed = calledNumbers.pop();
      transaction.update(reference, {
        calledNumbers,
        status: "playing",
        updatedAt: serverTimestamp(),
      });
    });

    return removed;
  }

  async function resetRoom(roomId) {
    requireUser();
    await updateDoc(roomReference(roomId), {
      calledNumbers: [],
      status: "lobby",
      updatedAt: serverTimestamp(),
    });
  }

  async function deleteRoom(roomId) {
    requireUser();
    await deleteDoc(roomReference(roomId));
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
    setRoomStatus,
    callNumber,
    drawRandomNumber,
    undoLastNumber,
    resetRoom,
    deleteRoom,
  };
}
