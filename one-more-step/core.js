(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const ROUND_OPTIONS = Object.freeze([3, 5]);
  const CHOICE_SECONDS_OPTIONS = Object.freeze([8, 10, 15]);
  const TARGET_MIN = 18;
  const TARGET_MAX = 25;
  const ROLL_MIN = 1;
  const ROLL_MAX = 6;
  const MAX_TURNS = 10;
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

  function normalizeTitle(value, fallback = "오늘의 한 칸만 더!") {
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

  function normalizeChoiceSeconds(value) {
    const seconds = Number(value);
    if (!CHOICE_SECONDS_OPTIONS.includes(seconds)) throw new Error("선택 시간이 올바르지 않습니다.");
    return seconds;
  }

  function randomInteger(minimum, maximum, random = Math.random) {
    return minimum + Math.floor(random() * (maximum - minimum + 1));
  }

  function randomTarget(random = Math.random) {
    return randomInteger(TARGET_MIN, TARGET_MAX, random);
  }

  function randomRoll(random = Math.random) {
    return randomInteger(ROLL_MIN, ROLL_MAX, random);
  }

  function timestampMillis(value) {
    if (value === null || value === undefined) return 0;
    const millis = typeof value?.toMillis === "function"
      ? Number(value.toMillis())
      : value instanceof Date ? value.getTime() : Number.NaN;
    return Number.isFinite(millis) && millis >= 0 ? millis : 0;
  }

  function choiceDeadlineMillis(room) {
    const started = timestampMillis(room?.turnStartedAt);
    return started ? started + Number(room.choiceSeconds || 10) * 1000 : 0;
  }

  function choiceSecondsRemaining(room, now = Date.now()) {
    const deadline = choiceDeadlineMillis(room);
    return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  }

  function normalizeDecision(value) {
    return value === "go" ? "go" : "stop";
  }

  function resolveTurn({ activeUids, totals, decisions, target, turn, rolls = {} }, random = Math.random) {
    const nextTotals = { ...(totals || {}) };
    const decisionMap = {};
    const rollMap = {};
    const stoppedUids = [];
    const bustedUids = [];
    const continuingUids = [];

    Array.from(new Set((activeUids || []).map(String))).forEach((uid) => {
      const decision = normalizeDecision(decisions?.[uid]);
      decisionMap[uid] = decision;
      if (decision === "stop") {
        stoppedUids.push(uid);
        return;
      }
      const suppliedRoll = Number(rolls?.[uid]);
      const roll = Number.isInteger(suppliedRoll) && suppliedRoll >= ROLL_MIN && suppliedRoll <= ROLL_MAX
        ? suppliedRoll
        : randomRoll(random);
      rollMap[uid] = roll;
      nextTotals[uid] = Number(nextTotals[uid] || 0) + roll;
      if (nextTotals[uid] > Number(target)) bustedUids.push(uid);
      else if (Number(turn) >= MAX_TURNS) stoppedUids.push(uid);
      else continuingUids.push(uid);
    });

    return {
      totals: nextTotals,
      decisions: decisionMap,
      rolls: rollMap,
      stoppedUids,
      bustedUids,
      continuingUids,
      roundComplete: continuingUids.length === 0,
    };
  }

  function pointsForRoundResult(rank, distance) {
    if (distance === 0) return 5;
    if (distance === 1) return 4;
    return rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0;
  }

  function rankRoundResults(roundUids, totals, bustedUids, target) {
    const busted = new Set((bustedUids || []).map(String));
    const sorted = Array.from(new Set((roundUids || []).map(String)))
      .filter((uid) => !busted.has(uid))
      .map((uid, order) => ({
        uid,
        total: Number(totals?.[uid] || 0),
        distance: Math.max(0, Number(target) - Number(totals?.[uid] || 0)),
        _order: order,
      }))
      .sort((left, right) => left.distance - right.distance || right.total - left.total || left._order - right._order);

    let previousDistance = null;
    let previousRank = 0;
    return sorted.map((entry, index) => {
      const rank = previousDistance === entry.distance ? previousRank : index + 1;
      previousDistance = entry.distance;
      previousRank = rank;
      const { _order, ...result } = entry;
      return { ...result, rank, points: pointsForRoundResult(rank, entry.distance) };
    });
  }

  function rankPlayers(players) {
    const sorted = (Array.isArray(players) ? players : [])
      .map((player, order) => ({ ...player, _order: order }))
      .sort((left, right) =>
        Number(right.score || 0) - Number(left.score || 0) ||
        Number(right.exactHits || 0) - Number(left.exactHits || 0) ||
        Number(right.roundWins || 0) - Number(left.roundWins || 0) ||
        Number(right.safeRounds || 0) - Number(left.safeRounds || 0) ||
        left._order - right._order
      );
    let previousMetrics = null;
    let previousRank = 0;
    return sorted.map((player, index) => {
      const metrics = [
        Number(player.score || 0), Number(player.exactHits || 0),
        Number(player.roundWins || 0), Number(player.safeRounds || 0),
      ];
      const same = previousMetrics && metrics.every((value, metricIndex) => value === previousMetrics[metricIndex]);
      const rank = same ? previousRank : index + 1;
      previousMetrics = metrics;
      previousRank = rank;
      const { _order, ...result } = player;
      return { ...result, rank };
    });
  }

  function mapValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function uidList(value) {
    return Array.isArray(value) ? value.map(String) : [];
  }

  function normalizeRoomSnapshot(value, id) {
    const room = value || {};
    return {
      id: normalizeRoomId(id),
      version: Number(room.version) || ROOM_VERSION,
      title: normalizeTitle(room.title),
      status: ["lobby", "choosing", "turnResult", "roundResult", "finished"].includes(room.status) ? room.status : "lobby",
      ownerUid: String(room.ownerUid || ""),
      totalRounds: normalizeRounds(room.totalRounds || 3),
      choiceSeconds: normalizeChoiceSeconds(room.choiceSeconds || 10),
      round: Number(room.round) || 0,
      turn: Number(room.turn) || 0,
      target: Number(room.target) || 0,
      turnStartedAt: room.turnStartedAt ?? null,
      roundUids: uidList(room.roundUids),
      activeUids: uidList(room.activeUids),
      submittedUids: uidList(room.submittedUids),
      stoppedUids: uidList(room.stoppedUids),
      bustedUids: uidList(room.bustedUids),
      totals: mapValue(room.totals),
      lastDecisions: mapValue(room.lastDecisions),
      lastRolls: mapValue(room.lastRolls),
      resultRound: Number(room.resultRound) || 0,
      lastWinnerUids: uidList(room.lastWinnerUids),
      lastRanks: mapValue(room.lastRanks),
      lastAwardPoints: mapValue(room.lastAwardPoints),
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

  root.OneMoreStepCore = Object.freeze({
    ROOM_VERSION, ROUND_OPTIONS, CHOICE_SECONDS_OPTIONS, TARGET_MIN, TARGET_MAX,
    ROLL_MIN, ROLL_MAX, MAX_TURNS, normalizeRoomId, isValidRoomId, createRoomId,
    normalizeTitle, normalizeNickname, normalizeRounds, normalizeChoiceSeconds,
    randomTarget, randomRoll, timestampMillis, choiceDeadlineMillis, choiceSecondsRemaining,
    normalizeDecision, resolveTurn, pointsForRoundResult, rankRoundResults, rankPlayers,
    normalizeRoomSnapshot, makeRoomUrl, firebaseConfigReady,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
