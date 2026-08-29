(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const QUESTION_MIN = 5;
  const QUESTION_MAX = 7;
  const CLUE_STAGE_MAX = 3;
  const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
  const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CHOSUNG = Object.freeze([
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
    "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
  ]);
  const JUNGSUNG = Object.freeze([
    "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ",
    "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
  ]);
  const STAGE_POINTS = Object.freeze([5, 4, 3, 2]);

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

  function normalizeTitle(value, fallback = "오늘의 초성 탈출") {
    return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, 40) || fallback;
  }

  function normalizeNickname(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20);
  }

  function normalizeAnswer(value) {
    return String(value || "").normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 30);
  }

  function answerKey(value) {
    return normalizeAnswer(value).toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
  }

  function answersMatch(left, right) {
    const leftKey = answerKey(left);
    return leftKey.length > 0 && leftKey === answerKey(right);
  }

  function hangulParts(character) {
    const code = character.codePointAt(0);
    if (code < 0xac00 || code > 0xd7a3) return null;
    const offset = code - 0xac00;
    return {
      initial: CHOSUNG[Math.floor(offset / 588)],
      vowel: JUNGSUNG[Math.floor((offset % 588) / 28)],
    };
  }

  function answerCharacters(answer) {
    return Array.from(normalizeAnswer(answer));
  }

  function playableCharacters(answer) {
    return answerCharacters(answer).filter((character) => /[\p{L}\p{N}]/u.test(character));
  }

  function initialFor(character) {
    return hangulParts(character)?.initial || character.toLocaleUpperCase("ko-KR");
  }

  function initialHint(answer) {
    return answerCharacters(answer)
      .map((character) => character === " " ? "/" : initialFor(character))
      .join(" ");
  }

  function vowelHint(answer) {
    const characters = answerCharacters(answer);
    const playableIndexes = characters
      .map((character, index) => /[\p{L}\p{N}]/u.test(character) ? index : -1)
      .filter((index) => index >= 0);
    const revealIndex = playableIndexes[Math.floor(playableIndexes.length / 2)] ?? -1;
    return characters.map((character, index) => {
      if (character === " ") return "/";
      const parts = hangulParts(character);
      if (index === revealIndex && parts) return `${parts.initial}${parts.vowel}`;
      if (index === revealIndex) return character.toLocaleUpperCase("ko-KR");
      return initialFor(character);
    }).join(" ");
  }

  function syllableHint(answer) {
    const characters = answerCharacters(answer);
    const playableIndexes = characters
      .map((character, index) => /[\p{L}\p{N}]/u.test(character) ? index : -1)
      .filter((index) => index >= 0);
    const revealIndex = playableIndexes[Math.floor(playableIndexes.length / 2)] ?? -1;
    return characters.map((character, index) => {
      if (character === " ") return "/";
      return index === revealIndex ? character : "□";
    }).join(" ");
  }

  function normalizeQuestion(value) {
    const answer = normalizeAnswer(value?.answer);
    const category = String(value?.category || "자유 주제").trim().replace(/\s+/g, " ").slice(0, 30) || "자유 주제";
    const description = String(value?.description || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (answerKey(answer).length < 2) throw new Error("정답은 두 글자 이상 입력해 주세요.");
    if (!description) throw new Error("마지막에 공개할 설명 힌트를 입력해 주세요.");
    return { answer, category, description };
  }

  function publicQuestion(value) {
    const question = normalizeQuestion(value);
    return Object.freeze({
      category: question.category,
      length: playableCharacters(question.answer).length,
      initialHint: initialHint(question.answer),
      vowelHint: vowelHint(question.answer),
      syllableHint: syllableHint(question.answer),
      description: question.description,
    });
  }

  function normalizeQuestions(values) {
    const questions = (Array.isArray(values) ? values : []).map(normalizeQuestion);
    if (questions.length < QUESTION_MIN || questions.length > QUESTION_MAX) {
      throw new Error(`문제는 ${QUESTION_MIN}개에서 ${QUESTION_MAX}개까지 준비해 주세요.`);
    }
    return questions;
  }

  function normalizeClueStage(value) {
    return Math.min(CLUE_STAGE_MAX, Math.max(0, Math.trunc(Number(value) || 0)));
  }

  function pointsForStage(stage) {
    return STAGE_POINTS[normalizeClueStage(stage)];
  }

  function clueForStage(question, stageValue) {
    const stage = normalizeClueStage(stageValue);
    if (!question) return { stage, label: "문제 준비 중", hint: "—", description: "" };
    if (stage === 0) return { stage, label: "글자 수 힌트", hint: `${question.length}글자`, description: "카테고리만 보고 먼저 맞혀 보세요." };
    if (stage === 1) return { stage, label: "초성 공개", hint: question.initialHint, description: "초성을 소리 내어 읽어 보세요." };
    if (stage === 2) return { stage, label: "모음 하나 공개", hint: question.vowelHint, description: "가운데 글자의 모음이 추가로 열렸습니다." };
    return { stage, label: "마지막 힌트", hint: question.syllableHint, description: question.description };
  }

  function rankPlayers(players) {
    const sorted = (Array.isArray(players) ? players : [])
      .map((player, order) => ({ ...player, _order: order }))
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0) || left._order - right._order);
    let previousScore = null;
    let previousRank = 0;
    return sorted.map((player, index) => {
      const score = Number(player.score || 0);
      const rank = previousScore === score ? previousRank : index + 1;
      previousScore = score;
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
      status: ["lobby", "answering", "revealed", "finished"].includes(room.status) ? room.status : "lobby",
      ownerUid: String(room.ownerUid || ""),
      questions: Array.isArray(room.questions) ? room.questions : [],
      totalQuestions: Number(room.totalQuestions) || 0,
      currentQuestion: Number(room.currentQuestion) || 0,
      clueStage: normalizeClueStage(room.clueStage),
      activeUids: Array.isArray(room.activeUids) ? room.activeUids.map(String) : [],
      solvedUids: Array.isArray(room.solvedUids) ? room.solvedUids.map(String) : [],
      revealedAnswer: String(room.revealedAnswer || ""),
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

  root.ChosungEscapeCore = Object.freeze({
    ROOM_VERSION,
    QUESTION_MIN,
    QUESTION_MAX,
    CLUE_STAGE_MAX,
    STAGE_POINTS,
    normalizeRoomId,
    isValidRoomId,
    createRoomId,
    normalizeTitle,
    normalizeNickname,
    normalizeAnswer,
    answerKey,
    answersMatch,
    hangulParts,
    initialHint,
    vowelHint,
    syllableHint,
    normalizeQuestion,
    publicQuestion,
    normalizeQuestions,
    normalizeClueStage,
    pointsForStage,
    clueForStage,
    rankPlayers,
    normalizeRoomSnapshot,
    makeRoomUrl,
    firebaseConfigReady,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
