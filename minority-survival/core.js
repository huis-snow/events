(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const QUESTION_MIN = 5;
  const QUESTION_MAX = 10;
  const DEFAULT_CHOICE_SECONDS = 15;
  const CHOICE_SECONDS_OPTIONS = Object.freeze([10, 15, 20]);
  const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
  const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function normalizeRoomId(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function isValidRoomId(value) {
    return ROOM_ID_PATTERN.test(normalizeRoomId(value));
  }

  function createRoomId(random = Math.random) {
    return Array.from({ length: 8 }, () =>
      ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)]
    ).join("");
  }

  function normalizeTitle(value, fallback = "오늘의 소수결 생존") {
    return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, 40) || fallback;
  }

  function normalizeNickname(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20);
  }

  function normalizePrompt(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 60);
  }

  function normalizeOption(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  }

  function normalizeQuestion(value) {
    const prompt = normalizePrompt(value?.prompt);
    const optionA = normalizeOption(value?.optionA);
    const optionB = normalizeOption(value?.optionB);
    if (!prompt) throw new Error("질문을 입력해 주세요.");
    if (!optionA || !optionB) throw new Error("A와 B 선택지를 모두 입력해 주세요.");
    if (optionA.toLocaleLowerCase("ko-KR") === optionB.toLocaleLowerCase("ko-KR")) {
      throw new Error("A와 B는 서로 다른 선택지여야 합니다.");
    }
    return { prompt, optionA, optionB };
  }

  function normalizeQuestions(values) {
    const questions = (Array.isArray(values) ? values : []).map(normalizeQuestion);
    if (questions.length < QUESTION_MIN || questions.length > QUESTION_MAX) {
      throw new Error(`질문은 ${QUESTION_MIN}개에서 ${QUESTION_MAX}개까지 준비해 주세요.`);
    }
    return questions;
  }

  function normalizeChoiceSeconds(value = DEFAULT_CHOICE_SECONDS) {
    const seconds = Number(value);
    if (!CHOICE_SECONDS_OPTIONS.includes(seconds)) throw new Error("선택 시간이 올바르지 않습니다.");
    return seconds;
  }

  function timestampMillis(value) {
    if (value === null || value === undefined) return 0;
    const millis = typeof value?.toMillis === "function"
      ? Number(value.toMillis())
      : value instanceof Date ? value.getTime() : Number.NaN;
    if (!Number.isFinite(millis) || millis < 0) return 0;
    return millis;
  }

  function choiceDeadlineMillis(room) {
    const startedAt = timestampMillis(room?.roundStartedAt);
    return startedAt ? startedAt + normalizeChoiceSeconds(room?.choiceSeconds) * 1000 : 0;
  }

  function scoreRound(choicesValue, activeUidsValue) {
    const active = new Set((activeUidsValue || []).map(String));
    const choices = (Array.isArray(choicesValue) ? choicesValue : [])
      .filter((choice) => active.has(String(choice.uid)) && (choice.side === "A" || choice.side === "B"));
    const countA = choices.filter((choice) => choice.side === "A").length;
    const countB = choices.filter((choice) => choice.side === "B").length;
    const submitted = countA + countB;
    let resultKind = "NONE";
    let points = 0;
    if (countA > 0 && countB > 0 && countA === countB) {
      resultKind = "TIE";
      points = 1;
    } else if (countA > 0 && countB > 0) {
      resultKind = countA < countB ? "A" : "B";
      const minorityCount = Math.min(countA, countB);
      points = minorityCount * 4 <= submitted ? 3 : 2;
    }
    const awardPoints = Object.fromEntries(choices.map((choice) => [
      String(choice.uid),
      resultKind === "TIE" ? points : choice.side === resultKind ? points : 0,
    ]));
    return Object.freeze({ countA, countB, submitted, resultKind, points, awardPoints });
  }

  function rankPlayers(players) {
    const sorted = (Array.isArray(players) ? players : [])
      .map((player, order) => ({ ...player, _order: order }))
      .sort((left, right) =>
        Number(right.score || 0) - Number(left.score || 0) ||
        Number(right.rareWins || 0) - Number(left.rareWins || 0) ||
        Number(right.survivalWins || 0) - Number(left.survivalWins || 0) ||
        left._order - right._order
      );
    let previousMetrics = null;
    let previousRank = 0;
    return sorted.map((player, index) => {
      const metrics = [Number(player.score || 0), Number(player.rareWins || 0), Number(player.survivalWins || 0)];
      const same = previousMetrics && metrics.every((value, metricIndex) => value === previousMetrics[metricIndex]);
      const rank = same ? previousRank : index + 1;
      previousMetrics = metrics;
      previousRank = rank;
      const { _order, ...result } = player;
      return { ...result, rank };
    });
  }

  function normalizeRoomSnapshot(value, id) {
    const room = value || {};
    return {
      id: normalizeRoomId(id),
      version: Number(room.version) || ROOM_VERSION,
      title: normalizeTitle(room.title),
      status: ["lobby", "voting", "revealed", "finished"].includes(room.status) ? room.status : "lobby",
      ownerUid: String(room.ownerUid || ""),
      totalRounds: Number(room.totalRounds) || 0,
      currentRound: Number(room.currentRound) || 0,
      currentPrompt: String(room.currentPrompt || ""),
      optionA: String(room.optionA || ""),
      optionB: String(room.optionB || ""),
      choiceSeconds: normalizeChoiceSeconds(room.choiceSeconds),
      roundStartedAt: room.roundStartedAt ?? null,
      activeUids: Array.isArray(room.activeUids) ? room.activeUids.map(String) : [],
      submittedUids: Array.isArray(room.submittedUids) ? room.submittedUids.map(String) : [],
      countA: Number(room.countA) || 0,
      countB: Number(room.countB) || 0,
      resultKind: String(room.resultKind || ""),
      lastAwardPoints: room.lastAwardPoints && typeof room.lastAwardPoints === "object" ? room.lastAwardPoints : {},
      eventId: String(room.eventId || ""),
      matchId: String(room.matchId || ""),
    };
  }

  function makeRoomUrl(urlValue, roomId) {
    const url = new URL(urlValue);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", normalizeRoomId(roomId));
    return url.href;
  }

  function firebaseConfigReady(config) {
    return Boolean(config?.apiKey && config?.authDomain && config?.projectId && config?.appId);
  }

  root.MinoritySurvivalCore = Object.freeze({
    ROOM_VERSION,
    QUESTION_MIN,
    QUESTION_MAX,
    DEFAULT_CHOICE_SECONDS,
    CHOICE_SECONDS_OPTIONS,
    normalizeRoomId,
    isValidRoomId,
    createRoomId,
    normalizeTitle,
    normalizeNickname,
    normalizePrompt,
    normalizeOption,
    normalizeQuestion,
    normalizeQuestions,
    normalizeChoiceSeconds,
    choiceDeadlineMillis,
    scoreRound,
    rankPlayers,
    normalizeRoomSnapshot,
    makeRoomUrl,
    firebaseConfigReady,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
