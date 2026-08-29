(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const BOARD_SIZE = 25;
  const MIN_NUMBER = 1;
  const MAX_NUMBER = 50;
  const DEFAULT_TARGET_LINES = 3;
  const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
  const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ROOM_STATUSES = new Set(["lobby", "playing", "finished"]);
  const WINNING_LINES = Object.freeze([
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8, 9],
    [10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19],
    [20, 21, 22, 23, 24],
    [0, 5, 10, 15, 20],
    [1, 6, 11, 16, 21],
    [2, 7, 12, 17, 22],
    [3, 8, 13, 18, 23],
    [4, 9, 14, 19, 24],
    [0, 6, 12, 18, 24],
    [4, 8, 12, 16, 20],
  ].map((line) => Object.freeze(line)));

  function cleanText(value, label, maximum) {
    const text = String(value ?? "").trim();
    if (!text) throw new Error(`${label}을(를) 입력해 주세요.`);
    if (text.length > maximum) throw new Error(`${label}은(는) ${maximum}자 이하여야 합니다.`);
    return text;
  }

  function normalizeRoomTitle(value) {
    return cleanText(value, "방 이름", 40);
  }

  function normalizeNickname(value) {
    return cleanText(value, "닉네임", 20);
  }

  function normalizeTargetLines(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > WINNING_LINES.length) {
      throw new Error("목표 빙고 수가 올바르지 않습니다.");
    }
    return number;
  }

  function normalizeNumber(value, label = "숫자") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < MIN_NUMBER || number > MAX_NUMBER) {
      throw new Error(`${label}는 ${MIN_NUMBER}부터 ${MAX_NUMBER}까지의 정수여야 합니다.`);
    }
    return number;
  }

  function normalizeBoard(value) {
    if (!Array.isArray(value) || value.length !== BOARD_SIZE) {
      throw new Error(`빙고판에는 숫자 ${BOARD_SIZE}개가 필요합니다.`);
    }
    const board = value.map((number, index) => normalizeNumber(number, `${index + 1}번째 칸`));
    if (new Set(board).size !== BOARD_SIZE) {
      throw new Error("빙고판에는 같은 숫자를 두 번 넣을 수 없습니다.");
    }
    return board;
  }

  function normalizeCalledNumbers(value) {
    if (!Array.isArray(value)) throw new Error("호출 숫자 기록이 올바르지 않습니다.");
    if (value.length > MAX_NUMBER) throw new Error("호출 숫자 기록이 너무 깁니다.");
    const numbers = value.map((number) => normalizeNumber(number, "호출 숫자"));
    if (new Set(numbers).size !== numbers.length) {
      throw new Error("호출 숫자 기록에 중복이 있습니다.");
    }
    return numbers;
  }

  function normalizeRoomId(value) {
    const roomId = String(value ?? "").trim().toUpperCase();
    if (!ROOM_ID_PATTERN.test(roomId)) throw new Error("방 코드는 영문·숫자 8자리입니다.");
    return roomId;
  }

  function createRoomId(cryptoObject = root.crypto) {
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error("안전한 방 코드를 만들 수 없는 브라우저입니다.");
    }
    const bytes = new Uint8Array(8);
    cryptoObject.getRandomValues(bytes);
    return Array.from(bytes, (byte) => ROOM_ID_ALPHABET[byte % ROOM_ID_ALPHABET.length]).join("");
  }

  function randomBoard(cryptoObject = root.crypto) {
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error("무작위 빙고판을 만들 수 없는 브라우저입니다.");
    }
    const values = Array.from({ length: MAX_NUMBER }, (_, index) => index + 1);
    for (let index = values.length - 1; index > 0; index -= 1) {
      const sample = new Uint32Array(1);
      cryptoObject.getRandomValues(sample);
      const swapIndex = sample[0] % (index + 1);
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
    return values.slice(0, BOARD_SIZE);
  }

  function remainingNumbers(calledValue) {
    const called = new Set(normalizeCalledNumbers(calledValue));
    return Array.from(
      { length: MAX_NUMBER },
      (_, index) => index + MIN_NUMBER,
    ).filter((number) => !called.has(number));
  }

  function randomRemainingNumber(calledValue, cryptoObject = root.crypto) {
    const remaining = remainingNumbers(calledValue);
    if (remaining.length === 0) return null;
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error("무작위 숫자를 뽑을 수 없는 브라우저입니다.");
    }
    const sample = new Uint32Array(1);
    cryptoObject.getRandomValues(sample);
    return remaining[sample[0] % remaining.length];
  }

  function parseBoardText(value) {
    const tokens = String(value ?? "")
      .trim()
      .split(/[\s,;/|]+/)
      .filter(Boolean);
    return normalizeBoard(tokens);
  }

  function boardProgress(boardValue, calledValue) {
    const board = normalizeBoard(boardValue);
    const calledNumbers = normalizeCalledNumbers(calledValue);
    const called = new Set(calledNumbers);
    const completedLines = [];
    const nearLines = [];
    const lineMarks = WINNING_LINES.map((line, index) => {
      const marked = line.reduce((count, cellIndex) => count + Number(called.has(board[cellIndex])), 0);
      if (marked === 5) completedLines.push(index);
      else if (marked === 4) nearLines.push(index);
      return marked;
    });
    const markedCells = board.map((number) => called.has(number));
    return {
      markedCells,
      markedCount: markedCells.filter(Boolean).length,
      completedLines,
      completedCount: completedLines.length,
      nearLines,
      nearCount: nearLines.length,
      lineMarks,
    };
  }

  function completedCellIndexes(progress) {
    const indexes = new Set();
    progress.completedLines.forEach((lineIndex) => {
      WINNING_LINES[lineIndex].forEach((cellIndex) => indexes.add(cellIndex));
    });
    return indexes;
  }

  function rankPlayers(players, calledNumbers) {
    if (!Array.isArray(players)) return [];
    return players
      .map((player, joinedIndex) => ({
        ...player,
        joinedIndex,
        progress: boardProgress(player.board, calledNumbers),
      }))
      .sort((left, right) =>
        right.progress.completedCount - left.progress.completedCount ||
        right.progress.nearCount - left.progress.nearCount ||
        right.progress.markedCount - left.progress.markedCount ||
        left.joinedIndex - right.joinedIndex,
      );
  }

  function winningPlayers(players, calledNumbers, targetLines) {
    const target = normalizeTargetLines(targetLines);
    return rankPlayers(players, calledNumbers).filter((player) => player.progress.completedCount >= target);
  }

  function normalizeRoomSnapshot(value, roomId = "") {
    if (!value || typeof value !== "object") throw new Error("빙고 방 데이터가 올바르지 않습니다.");
    if (value.version !== ROOM_VERSION) throw new Error("지원하지 않는 빙고 방입니다.");
    if (!ROOM_STATUSES.has(value.status)) throw new Error("게임 상태가 올바르지 않습니다.");
    const ownerUid = cleanText(value.ownerUid, "방장 정보", 128);
    return {
      version: ROOM_VERSION,
      id: roomId ? normalizeRoomId(roomId) : "",
      title: normalizeRoomTitle(value.title),
      targetLines: normalizeTargetLines(value.targetLines),
      status: value.status,
      ownerUid,
      calledNumbers: normalizeCalledNumbers(value.calledNumbers),
      createdAt: value.createdAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function normalizePlayerSnapshot(value, uid = "") {
    if (!value || typeof value !== "object") throw new Error("참가자 데이터가 올바르지 않습니다.");
    return {
      uid: cleanText(uid, "참가자 정보", 128),
      nickname: normalizeNickname(value.nickname),
      board: normalizeBoard(value.board),
      joinedAt: value.joinedAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function makeRoomUrl(baseUrl, roomId) {
    const url = new URL(baseUrl);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", normalizeRoomId(roomId));
    return url.toString();
  }

  function firebaseConfigReady(config) {
    if (!config || typeof config !== "object") return false;
    return ["apiKey", "authDomain", "projectId", "appId"].every((key) => {
      const value = String(config[key] ?? "").trim();
      return value && !/REPLACE|YOUR_|여기에/i.test(value);
    });
  }

  const api = {
    ROOM_VERSION,
    BOARD_SIZE,
    MIN_NUMBER,
    MAX_NUMBER,
    DEFAULT_TARGET_LINES,
    ROOM_ID_PATTERN,
    WINNING_LINES,
    normalizeRoomTitle,
    normalizeNickname,
    normalizeTargetLines,
    normalizeNumber,
    normalizeBoard,
    normalizeCalledNumbers,
    normalizeRoomId,
    createRoomId,
    randomBoard,
    remainingNumbers,
    randomRemainingNumber,
    parseBoardText,
    boardProgress,
    completedCellIndexes,
    rankPlayers,
    winningPlayers,
    normalizeRoomSnapshot,
    normalizePlayerSnapshot,
    makeRoomUrl,
    firebaseConfigReady,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GuildBingoCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
