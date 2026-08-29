(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const ROUND_OPTIONS = Object.freeze([3, 5, 7]);
  const TARGET_MIN_SECONDS = 7;
  const TARGET_MAX_SECONDS = 15;
  const PREPARE_MILLIS = 3000;
  const PARTIAL_BEFORE_MILLIS = 5000;
  const HIDDEN_BEFORE_MILLIS = 3000;
  const CLOSE_AFTER_MILLIS = 5000;
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

  function normalizeTitle(value, fallback = "오늘의 지금이다!") {
    return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, 40) || fallback;
  }

  function normalizeNickname(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20);
  }

  function normalizeRounds(value) {
    const rounds = Number(value);
    if (!ROUND_OPTIONS.includes(rounds)) throw new Error("라운드 수가 올바르지 않습니다.");
    return rounds;
  }

  function randomTargetSeconds(random = Math.random) {
    return TARGET_MIN_SECONDS + Math.floor(random() * (TARGET_MAX_SECONDS - TARGET_MIN_SECONDS + 1));
  }

  function timestampMillis(value) {
    if (value === null || value === undefined) return 0;
    const millis = typeof value?.toMillis === "function"
      ? Number(value.toMillis())
      : value instanceof Date ? value.getTime() : Number.NaN;
    return Number.isFinite(millis) && millis >= 0 ? millis : 0;
  }

  function roundStartMillis(room) {
    const announced = timestampMillis(room?.announcedAt);
    return announced ? announced + PREPARE_MILLIS : 0;
  }

  function timerPartialAtMillis(room) {
    const start = roundStartMillis(room);
    return start ? start + Number(room.targetSeconds || 0) * 1000 - PARTIAL_BEFORE_MILLIS : 0;
  }

  function timerHiddenAtMillis(room) {
    const start = roundStartMillis(room);
    return start ? start + Number(room.targetSeconds || 0) * 1000 - HIDDEN_BEFORE_MILLIS : 0;
  }

  function roundDeadlineMillis(room) {
    const start = roundStartMillis(room);
    return start ? start + Number(room.targetSeconds || 0) * 1000 + CLOSE_AFTER_MILLIS : 0;
  }

  function timingState(room, now = Date.now()) {
    const start = roundStartMillis(room);
    if (!start) return Object.freeze({ phase: "waiting", elapsedMillis: 0, prepareMillis: 0 });
    if (now < start) return Object.freeze({ phase: "prepare", elapsedMillis: 0, prepareMillis: start - now });
    const elapsedMillis = Math.max(0, now - start);
    if (now >= roundDeadlineMillis(room)) return Object.freeze({ phase: "closed", elapsedMillis, prepareMillis: 0 });
    if (now >= timerHiddenAtMillis(room)) return Object.freeze({ phase: "hidden", elapsedMillis, prepareMillis: 0 });
    if (now >= timerPartialAtMillis(room)) return Object.freeze({ phase: "partial", elapsedMillis, prepareMillis: 0 });
    return Object.freeze({ phase: "visible", elapsedMillis, prepareMillis: 0 });
  }

  function formatElapsed(elapsedMillis) {
    return (Math.max(0, Number(elapsedMillis) || 0) / 1000).toFixed(2);
  }

  function formatPartialElapsed(elapsedMillis) {
    return `${Math.floor(Math.max(0, Number(elapsedMillis) || 0) / 1000)}.??`;
  }

  function precisionPoints(errorMillis) {
    const error = Math.abs(Number(errorMillis));
    if (!Number.isFinite(error)) return 0;
    if (error < 5) return 5;
    if (error < 50) return 4;
    return 0;
  }

  function pointsForRoundRank(rank, errorMillis = Number.POSITIVE_INFINITY) {
    return precisionPoints(errorMillis) || (rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0);
  }

  function rankAttempts(attemptsValue, targetSeconds, activeUidsValue = []) {
    const active = new Set((activeUidsValue || []).map(String));
    const targetMillis = Number(targetSeconds) * 1000;
    const seen = new Set();
    const sorted = (Array.isArray(attemptsValue) ? attemptsValue : [])
      .filter((attempt) => {
        const uid = String(attempt?.uid || "");
        const elapsedMillis = Number(attempt?.elapsedMillis);
        if (!uid || seen.has(uid) || (active.size && !active.has(uid))) return false;
        if (!Number.isInteger(elapsedMillis) || elapsedMillis < 0 || elapsedMillis > 20000) return false;
        seen.add(uid);
        return true;
      })
      .map((attempt, order) => ({
        uid: String(attempt.uid),
        elapsedMillis: Number(attempt.elapsedMillis),
        errorMillis: Math.abs(Number(attempt.elapsedMillis) - targetMillis),
        _order: order,
      }))
      .sort((left, right) => left.errorMillis - right.errorMillis || left._order - right._order);

    let previousError = null;
    let previousRank = 0;
    return sorted.map((attempt, index) => {
      const rank = previousError === attempt.errorMillis ? previousRank : index + 1;
      previousError = attempt.errorMillis;
      previousRank = rank;
      const { _order, ...result } = attempt;
      return { ...result, rank, points: pointsForRoundRank(rank, result.errorMillis) };
    });
  }

  function rankPlayers(players) {
    const sorted = (Array.isArray(players) ? players : [])
      .map((player, order) => ({
        ...player,
        averageErrorMillis: Number(player.submittedRounds || 0) > 0
          ? Number(player.totalErrorMillis || 0) / Number(player.submittedRounds)
          : Number.POSITIVE_INFINITY,
        _order: order,
      }))
      .sort((left, right) =>
        Number(right.score || 0) - Number(left.score || 0) ||
        Number(right.wins || 0) - Number(left.wins || 0) ||
        Number(right.podiums || 0) - Number(left.podiums || 0) ||
        Number(right.submittedRounds || 0) - Number(left.submittedRounds || 0) ||
        left.averageErrorMillis - right.averageErrorMillis ||
        left._order - right._order
      );
    let previousMetrics = null;
    let previousRank = 0;
    return sorted.map((player, index) => {
      const metrics = [
        Number(player.score || 0),
        Number(player.wins || 0),
        Number(player.podiums || 0),
        Number(player.submittedRounds || 0),
        Number.isFinite(player.averageErrorMillis) ? -player.averageErrorMillis : -999999,
      ];
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
      status: ["lobby", "running", "revealed", "finished"].includes(room.status) ? room.status : "lobby",
      ownerUid: String(room.ownerUid || ""),
      totalRounds: normalizeRounds(room.totalRounds || 5),
      round: Number(room.round) || 0,
      targetSeconds: Number(room.targetSeconds) || 0,
      announcedAt: room.announcedAt ?? null,
      activeUids: Array.isArray(room.activeUids) ? room.activeUids.map(String) : [],
      submittedUids: Array.isArray(room.submittedUids) ? room.submittedUids.map(String) : [],
      resultRound: Number(room.resultRound) || 0,
      lastElapsedMillis: room.lastElapsedMillis && typeof room.lastElapsedMillis === "object" ? room.lastElapsedMillis : {},
      lastErrorMillis: room.lastErrorMillis && typeof room.lastErrorMillis === "object" ? room.lastErrorMillis : {},
      lastWinnerUids: Array.isArray(room.lastWinnerUids) ? room.lastWinnerUids.map(String) : [],
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

  root.NowTimingCore = Object.freeze({
    ROOM_VERSION,
    ROUND_OPTIONS,
    TARGET_MIN_SECONDS,
    TARGET_MAX_SECONDS,
    PREPARE_MILLIS,
    PARTIAL_BEFORE_MILLIS,
    HIDDEN_BEFORE_MILLIS,
    CLOSE_AFTER_MILLIS,
    normalizeRoomId,
    isValidRoomId,
    createRoomId,
    normalizeTitle,
    normalizeNickname,
    normalizeRounds,
    randomTargetSeconds,
    timestampMillis,
    roundStartMillis,
    timerPartialAtMillis,
    timerHiddenAtMillis,
    roundDeadlineMillis,
    timingState,
    formatElapsed,
    formatPartialElapsed,
    precisionPoints,
    pointsForRoundRank,
    rankAttempts,
    rankPlayers,
    normalizeRoomSnapshot,
    makeRoomUrl,
    firebaseConfigReady,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
