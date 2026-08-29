(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const MIN_NUMBER_MAX = 4;
  const CARD_RATIO_NUMERATOR = 3;
  const CARD_RATIO_DENOMINATOR = 4;
  const DEFAULT_CHOICE_SECONDS = 20;
  const CHOICE_SECONDS_OPTIONS = Object.freeze([10, 15, 20, 30]);
  const MAX_PLAYERS = 50;
  const MAX_SCORE = 1500;
  const DEFAULT_TOTAL_ROUNDS = 5;
  const DEFAULT_SCORE_MODE = "descending";
  const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
  const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ROOM_STATUSES = new Set(["lobby", "choosing", "revealed", "finished"]);
  const SCORE_MODES = new Set(["descending", "exact", "random", "tiered", "classic"]);
  const SCORE_MODE_LABELS = Object.freeze({
    descending: "역순 포인트",
    exact: "높은 숫자 보상",
    random: "랜덤 현상금",
    tiered: "구간 보상",
    classic: "클래식",
  });

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

  function normalizeScoreMode(value) {
    const mode = String(value ?? "").trim();
    if (!SCORE_MODES.has(mode)) throw new Error("점수 규칙이 올바르지 않습니다.");
    return mode;
  }

  function normalizeChoiceSeconds(value = DEFAULT_CHOICE_SECONDS) {
    const seconds = Number(value);
    if (!CHOICE_SECONDS_OPTIONS.includes(seconds)) {
      throw new Error("선택 제한 시간이 올바르지 않습니다.");
    }
    return seconds;
  }

  function timestampMillis(value) {
    if (value === null || value === undefined) return 0;
    const millis = typeof value?.toMillis === "function"
      ? Number(value.toMillis())
      : value instanceof Date
        ? value.getTime()
        : Number.NaN;
    if (!Number.isFinite(millis) || millis < 0) {
      throw new Error("라운드 시작 시간이 올바르지 않습니다.");
    }
    return millis;
  }

  function choiceDeadlineMillis(roomValue) {
    if (!roomValue || typeof roomValue !== "object") return 0;
    const startedAt = timestampMillis(roomValue.roundStartedAt);
    if (startedAt === 0) return 0;
    return startedAt + normalizeChoiceSeconds(roomValue.choiceSeconds) * 1000;
  }

  function scoreModeLabel(value) {
    return SCORE_MODE_LABELS[normalizeScoreMode(value)];
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
    return Math.max(
      MIN_NUMBER_MAX,
      Math.ceil((count * CARD_RATIO_NUMERATOR) / CARD_RATIO_DENOMINATOR),
    );
  }

  function normalizeChoice(value, numberMax) {
    const maximum = normalizeNumberMax(numberMax);
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > maximum) {
      throw new Error(`1부터 ${maximum}까지의 숫자를 골라 주세요.`);
    }
    return number;
  }

  function createRoundCardPoints(numberMaxValue, scoreModeValue, cryptoObject = root.crypto) {
    const numberMax = normalizeNumberMax(numberMaxValue);
    const scoreMode = normalizeScoreMode(scoreModeValue);
    if (scoreMode !== "random") return [];
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error("랜덤 카드 점수를 만들 수 없는 브라우저입니다.");
    }
    const points = Array.from({ length: numberMax }, (_, index) => index + 1);
    const randomValues = new Uint32Array(numberMax);
    cryptoObject.getRandomValues(randomValues);
    for (let index = numberMax - 1; index > 0; index -= 1) {
      const target = randomValues[index] % (index + 1);
      [points[index], points[target]] = [points[target], points[index]];
    }
    return points;
  }

  function normalizeCardPoints(value, numberMaxValue, scoreModeValue) {
    const numberMax = normalizeNumberMax(numberMaxValue, true);
    const scoreMode = normalizeScoreMode(scoreModeValue);
    const points = value === undefined ? [] : value;
    if (!Array.isArray(points)) throw new Error("카드 점수 배치가 올바르지 않습니다.");
    if (numberMax === 0 || scoreMode !== "random") {
      if (points.length !== 0) throw new Error("이 규칙에는 랜덤 카드 점수가 없어야 합니다.");
      return [];
    }
    if (points.length !== numberMax) throw new Error("랜덤 카드 점수가 빠져 있습니다.");
    const normalized = points.map((point) => Number(point));
    if (normalized.some((point) => !Number.isInteger(point) || point < 1 || point > numberMax)) {
      throw new Error("랜덤 카드 점수가 범위를 벗어났습니다.");
    }
    if (new Set(normalized).size !== numberMax) throw new Error("랜덤 카드 점수에 중복이 있습니다.");
    return normalized;
  }

  function cardPointForNumber(numberValue, numberMaxValue, scoreModeValue, cardPointsValue = []) {
    const numberMax = normalizeNumberMax(numberMaxValue);
    const number = normalizeChoice(numberValue, numberMax);
    const scoreMode = normalizeScoreMode(scoreModeValue);
    if (scoreMode === "descending") return numberMax - number + 1;
    if (scoreMode === "random") {
      return normalizeCardPoints(cardPointsValue, numberMax, scoreMode)[number - 1];
    }
    if (scoreMode === "classic") return 1;
    if (scoreMode === "exact") return number;
    if (number <= Math.ceil(numberMax / 3)) return 1;
    if (number <= Math.ceil((numberMax * 2) / 3)) return 2;
    return 3;
  }

  function scoreForWinningNumber(winningNumberValue, numberMaxValue, scoreModeValue, cardPointsValue = []) {
    const winningNumber = Number(winningNumberValue);
    if (winningNumber === 0) return 0;
    return cardPointForNumber(winningNumber, numberMaxValue, scoreModeValue, cardPointsValue);
  }

  function scoreGuide(numberMaxValue, scoreModeValue) {
    const numberMax = normalizeNumberMax(numberMaxValue);
    const scoreMode = normalizeScoreMode(scoreModeValue);
    if (scoreMode === "descending") return `1번 = ${numberMax}점 · ${numberMax}번 = 1점`;
    if (scoreMode === "random") return `카드마다 1–${numberMax}점 랜덤 · 단독 선택은 모두 득점`;
    if (scoreMode === "classic") return "어떤 숫자로 이겨도 1점";
    if (scoreMode === "exact") return "이긴 숫자만큼 점수";
    const firstEnd = Math.ceil(numberMax / 3);
    const secondEnd = Math.ceil((numberMax * 2) / 3);
    const rangeText = (start, end) => start === end ? String(start) : `${start}–${end}`;
    return `${rangeText(1, firstEnd)} = 1점 · ${rangeText(firstEnd + 1, secondEnd)} = 2점 · ${rangeText(secondEnd + 1, numberMax)} = 3점`;
  }

  function normalizeUidList(value, label = "참가자 목록") {
    if (!Array.isArray(value) || value.length > MAX_PLAYERS) {
      throw new Error(`${label}이(가) 올바르지 않습니다.`);
    }
    const list = value.map((uid) => cleanText(uid, "참가자 정보", 128));
    if (new Set(list).size !== list.length) throw new Error(`${label}에 중복이 있습니다.`);
    return list;
  }

  function normalizeLastAwardPoints(value, winnerUids) {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("라운드 획득 점수가 올바르지 않습니다.");
    }
    const entries = Object.entries(value);
    if (entries.length !== winnerUids.length) throw new Error("라운드 승자별 점수가 빠져 있습니다.");
    const winnerSet = new Set(winnerUids);
    const normalized = {};
    entries.forEach(([uid, pointValue]) => {
      if (!winnerSet.has(uid)) throw new Error("라운드 승자와 획득 점수가 일치하지 않습니다.");
      const points = Number(pointValue);
      if (!Number.isInteger(points) || points < 1 || points > MAX_PLAYERS) {
        throw new Error("라운드 획득 점수가 범위를 벗어났습니다.");
      }
      normalized[uid] = points;
    });
    return normalized;
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
    const scoreMode = normalizeScoreMode(value.scoreMode ?? "classic");
    const choiceSeconds = normalizeChoiceSeconds(value.choiceSeconds);
    const roundStartedAt = value.roundStartedAt ?? null;
    timestampMillis(roundStartedAt);
    const cardPoints = normalizeCardPoints(value.cardPoints, numberMax, scoreMode);
    const lastWinnerUids = normalizeUidList(value.lastWinnerUids, "라운드 승자 목록");
    const lastAwardPoints = normalizeLastAwardPoints(value.lastAwardPoints, lastWinnerUids);
    return {
      version: ROOM_VERSION,
      id: roomId ? normalizeRoomId(roomId) : "",
      title: normalizeRoomTitle(value.title),
      totalRounds: normalizeTotalRounds(value.totalRounds),
      scoreMode,
      choiceSeconds,
      roundStartedAt,
      cardPoints,
      status: value.status,
      round,
      numberMax,
      ownerUid: cleanText(value.ownerUid, "방장 정보", 128),
      activeUids: normalizeUidList(value.activeUids, "현재 참가자 목록"),
      submittedUids: normalizeUidList(value.submittedUids, "제출자 목록"),
      resultRound,
      lastWinningNumber,
      lastWinnerUids,
      lastAwardPoints,
      createdAt: value.createdAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function normalizePlayerSnapshot(value, uid = "") {
    if (!value || typeof value !== "object") throw new Error("참가자 데이터가 올바르지 않습니다.");
    const score = Number(value.score);
    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
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

  function computeRoundResult(playersValue, choicesValue, settingsValue = {}) {
    const players = Array.isArray(playersValue) ? playersValue : [];
    const choices = Array.isArray(choicesValue) ? choicesValue : [];
    const settings = settingsValue && typeof settingsValue === "object" ? settingsValue : {};
    const inferredNumberMax = Math.max(MIN_NUMBER_MAX, ...choices.map((choice) => Number(choice.number) || 0));
    const numberMax = normalizeNumberMax(settings.numberMax ?? inferredNumberMax);
    const scoreMode = normalizeScoreMode(settings.scoreMode ?? "classic");
    const cardPoints = normalizeCardPoints(settings.cardPoints, numberMax, scoreMode);
    const playerMap = new Map(players.map((player) => [player.uid, player]));
    const validChoices = choices.filter((choice) => playerMap.has(choice.uid));
    const counts = new Map();
    validChoices.forEach((choice) => counts.set(choice.number, (counts.get(choice.number) || 0) + 1));
    const uniqueNumbers = [...counts.entries()]
      .filter(([, count]) => count === 1)
      .map(([number]) => number)
      .sort((left, right) => left - right);
    const winningNumber = uniqueNumbers[0] || 0;
    const everyUniqueScores = scoreMode === "random";
    const entries = validChoices
      .map((choice) => ({
        ...choice,
        nickname: playerMap.get(choice.uid).nickname,
        duplicate: (counts.get(choice.number) || 0) > 1,
        winner: (counts.get(choice.number) || 0) === 1 &&
          (everyUniqueScores || choice.number === winningNumber),
        points: cardPointForNumber(choice.number, numberMax, scoreMode, cardPoints),
      }))
      .sort((left, right) => left.number - right.number || left.nickname.localeCompare(right.nickname, "ko"));
    const awards = entries
      .filter((entry) => entry.winner)
      .map((entry) => ({ uid: entry.uid, number: entry.number, points: entry.points }));
    const winnerUids = awards.map((award) => award.uid);
    const submitted = new Set(validChoices.map((choice) => choice.uid));
    const missingUids = players.filter((player) => !submitted.has(player.uid)).map((player) => player.uid);
    return { counts, uniqueNumbers, winningNumber, winnerUids, awards, entries, missingUids };
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
    CARD_RATIO_NUMERATOR,
    CARD_RATIO_DENOMINATOR,
    DEFAULT_CHOICE_SECONDS,
    CHOICE_SECONDS_OPTIONS,
    MAX_PLAYERS,
    MAX_SCORE,
    DEFAULT_TOTAL_ROUNDS,
    DEFAULT_SCORE_MODE,
    ROOM_ID_PATTERN,
    normalizeRoomTitle,
    normalizeNickname,
    normalizeRoomId,
    createRoomId,
    normalizeTotalRounds,
    normalizeScoreMode,
    normalizeChoiceSeconds,
    timestampMillis,
    choiceDeadlineMillis,
    scoreModeLabel,
    normalizeRound,
    normalizeNumberMax,
    numberMaxForPlayers,
    normalizeChoice,
    createRoundCardPoints,
    normalizeCardPoints,
    cardPointForNumber,
    scoreForWinningNumber,
    scoreGuide,
    normalizeUidList,
    normalizeLastAwardPoints,
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
