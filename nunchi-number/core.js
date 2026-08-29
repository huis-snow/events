(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const MIN_NUMBER_MAX = 5;
  const MAX_PLAYERS = 50;
  const DEFAULT_TOTAL_ROUNDS = 5;
  const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
  const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ROOM_STATUSES = new Set(["lobby", "choosing", "revealed", "finished"]);

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

  function normalizeTotalRounds(value) {
    const rounds = Number(value);
    if (!Number.isInteger(rounds) || rounds < 3 || rounds > 10) {
      throw new Error("전체 라운드 수가 올바르지 않습니다.");
    }
    return rounds;
  }

  function normalizeRound(value, allowLobby = false) {
    const round = Number(value);
    const minimum = allowLobby ? 0 : 1;
    if (!Number.isInteger(round) || round < minimum || round > 30) {
      throw new Error("라운드 정보가 올바르지 않습니다.");
    }
    return round;
  }

  function normalizeNumberMax(value, allowLobby = false) {
    const maximum = Number(value);
    const minimum = allowLobby ? 0 : MIN_NUMBER_MAX;
    if (!Number.isInteger(maximum) || maximum < minimum || maximum > MAX_PLAYERS) {
      throw new Error("선택 숫자 범위가 올바르지 않습니다.");
    }
    return maximum;
  }

  function numberMaxForPlayers(playerCount) {
    const count = Number(playerCount);
    if (!Number.isInteger(count) || count < 1 || count > MAX_PLAYERS) {
      throw new Error("참가 인원이 올바르지 않습니다.");
    }
    return Math.max(MIN_NUMBER_MAX, count);
  }

  function normalizeChoice(value, numberMax) {
    const maximum = normalizeNumberMax(numberMax);
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > maximum) {
      throw new Error(`1부터 ${maximum}까지의 숫자를 골라 주세요.`);
    }
    return number;
  }

  function normalizeUidList(value, label = "참가자 목록") {
    if (!Array.isArray(value) || value.length > MAX_PLAYERS) {
      throw new Error(`${label}이(가) 올바르지 않습니다.`);
    }
    const list = value.map((uid) => cleanText(uid, "참가자 정보", 128));
    if (new Set(list).size !== list.length) throw new Error(`${label}에 중복이 있습니다.`);
    return list;
  }

  function normalizeRoomSnapshot(value, roomId = "") {
    if (!value || typeof value !== "object") throw new Error("눈치 숫자 방 데이터가 올바르지 않습니다.");
    if (value.version !== ROOM_VERSION) throw new Error("지원하지 않는 눈치 숫자 방입니다.");
    if (!ROOM_STATUSES.has(value.status)) throw new Error("게임 상태가 올바르지 않습니다.");
    const round = normalizeRound(value.round, true);
    const numberMax = normalizeNumberMax(value.numberMax, true);
    if (value.status === "lobby" && (round !== 0 || numberMax !== 0)) {
      throw new Error("대기실의 라운드 정보가 올바르지 않습니다.");
    }
    if (value.status !== "lobby" && (round === 0 || numberMax < MIN_NUMBER_MAX)) {
      throw new Error("진행 중인 라운드 정보가 올바르지 않습니다.");
    }
    const resultRound = normalizeRound(value.resultRound, true);
    if (resultRound > round) throw new Error("라운드 결과 정보가 올바르지 않습니다.");
    const lastWinningNumber = Number(value.lastWinningNumber);
    if (!Number.isInteger(lastWinningNumber) || lastWinningNumber < 0 || lastWinningNumber > MAX_PLAYERS) {
      throw new Error("우승 숫자 정보가 올바르지 않습니다.");
    }
    return {
      version: ROOM_VERSION,
      id: roomId ? normalizeRoomId(roomId) : "",
      title: normalizeRoomTitle(value.title),
      totalRounds: normalizeTotalRounds(value.totalRounds),
      status: value.status,
      round,
      numberMax,
      ownerUid: cleanText(value.ownerUid, "방장 정보", 128),
      activeUids: normalizeUidList(value.activeUids, "현재 참가자 목록"),
      submittedUids: normalizeUidList(value.submittedUids, "제출자 목록"),
      resultRound,
      lastWinningNumber,
      lastWinnerUids: normalizeUidList(value.lastWinnerUids, "라운드 승자 목록"),
      createdAt: value.createdAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function normalizePlayerSnapshot(value, uid = "") {
    if (!value || typeof value !== "object") throw new Error("참가자 데이터가 올바르지 않습니다.");
    const score = Number(value.score);
    if (!Number.isInteger(score) || score < 0 || score > 30) {
      throw new Error("참가자 점수가 올바르지 않습니다.");
    }
    return {
      uid: cleanText(uid, "참가자 정보", 128),
      nickname: normalizeNickname(value.nickname),
      score,
      joinedAt: value.joinedAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function normalizeChoiceSnapshot(value, uid = "", numberMax = MAX_PLAYERS) {
    if (!value || typeof value !== "object") throw new Error("선택 데이터가 올바르지 않습니다.");
    const maximum = Number(numberMax);
    if (!Number.isInteger(maximum) || maximum < MIN_NUMBER_MAX || maximum > MAX_PLAYERS) {
      throw new Error("선택 숫자 범위가 올바르지 않습니다.");
    }
    return {
      uid: cleanText(uid, "참가자 정보", 128),
      round: normalizeRound(value.round),
      number: normalizeChoice(value.number, maximum),
      createdAt: value.createdAt ?? null,
    };
  }

  function computeRoundResult(playersValue, choicesValue) {
    const players = Array.isArray(playersValue) ? playersValue : [];
    const choices = Array.isArray(choicesValue) ? choicesValue : [];
    const playerMap = new Map(players.map((player) => [player.uid, player]));
    const validChoices = choices.filter((choice) => playerMap.has(choice.uid));
    const counts = new Map();
    validChoices.forEach((choice) => counts.set(choice.number, (counts.get(choice.number) || 0) + 1));
    const uniqueNumbers = [...counts.entries()]
      .filter(([, count]) => count === 1)
      .map(([number]) => number)
      .sort((left, right) => left - right);
    const winningNumber = uniqueNumbers[0] || 0;
    const winnerUids = validChoices
      .filter((choice) => choice.number === winningNumber)
      .map((choice) => choice.uid);
    const entries = validChoices
      .map((choice) => ({
        ...choice,
        nickname: playerMap.get(choice.uid).nickname,
        duplicate: (counts.get(choice.number) || 0) > 1,
        winner: choice.number === winningNumber,
      }))
      .sort((left, right) => left.number - right.number || left.nickname.localeCompare(right.nickname, "ko"));
    const submitted = new Set(validChoices.map((choice) => choice.uid));
    const missingUids = players.filter((player) => !submitted.has(player.uid)).map((player) => player.uid);
    return { counts, uniqueNumbers, winningNumber, winnerUids, entries, missingUids };
  }

  function rankPlayers(playersValue) {
    if (!Array.isArray(playersValue)) return [];
    return playersValue
      .map((player, joinedIndex) => ({ ...player, joinedIndex }))
      .sort((left, right) =>
        right.score - left.score ||
        left.joinedIndex - right.joinedIndex,
      );
  }

  function scoreLeaders(playersValue) {
    const ranked = rankPlayers(playersValue);
    if (ranked.length === 0) return [];
    const topScore = ranked[0].score;
    return ranked.filter((player) => player.score === topScore);
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
    MIN_NUMBER_MAX,
    MAX_PLAYERS,
    DEFAULT_TOTAL_ROUNDS,
    ROOM_ID_PATTERN,
    normalizeRoomTitle,
    normalizeNickname,
    normalizeRoomId,
    createRoomId,
    normalizeTotalRounds,
    normalizeRound,
    normalizeNumberMax,
    numberMaxForPlayers,
    normalizeChoice,
    normalizeUidList,
    normalizeRoomSnapshot,
    normalizePlayerSnapshot,
    normalizeChoiceSnapshot,
    computeRoundResult,
    rankPlayers,
    scoreLeaders,
    makeRoomUrl,
    firebaseConfigReady,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NunchiNumberCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
