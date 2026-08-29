(function (root) {
  "use strict";

  const ROOM_ID_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const EVENT_STATUSES = Object.freeze([
    "lobby",
    "selecting",
    "preparing",
    "playing",
    "review",
    "finished",
  ]);
  const GAME_TYPES = Object.freeze(["bingo", "nunchi"]);
  const GAME_LABELS = Object.freeze({ bingo: "다 같이 빙고", nunchi: "눈치 숫자" });
  // 게임 내부 원점수와 무관하게 종합 랭킹에는 같은 순위표를 적용한다.
  const PLACEMENT_POINTS = Object.freeze({ 1: 10, 2: 8, 3: 6, 4: 5, 5: 4 });

  function createRoomId(random = Math.random) {
    return Array.from({ length: 8 }, () =>
      ALPHABET[Math.floor(random() * ALPHABET.length)]
    ).join("");
  }

  function normalizeRoomId(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function isValidRoomId(value) {
    return ROOM_ID_PATTERN.test(normalizeRoomId(value));
  }

  function normalizeNickname(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20);
  }

  function normalizeTitle(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  }

  function eventPointsForRank(rank) {
    return PLACEMENT_POINTS[rank] || 2;
  }

  function compareMetrics(left, right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const difference = Number(right[index] || 0) - Number(left[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  function sameMetrics(left, right) {
    return compareMetrics(left, right) === 0;
  }

  function rankGameResults(entries) {
    const sorted = (Array.isArray(entries) ? entries : [])
      .map((entry, index) => ({
        ...entry,
        metrics: Array.isArray(entry.metrics) ? entry.metrics.map(Number) : [Number(entry.score || 0)],
        _order: index,
      }))
      .sort((left, right) => compareMetrics(left.metrics, right.metrics) || left._order - right._order);

    let previousMetrics = null;
    let previousRank = 0;
    return sorted.map((entry, index) => {
      const rank = previousMetrics && sameMetrics(previousMetrics, entry.metrics)
        ? previousRank
        : index + 1;
      previousMetrics = entry.metrics;
      previousRank = rank;
      const { _order, ...result } = entry;
      return { ...result, rank, eventPoints: eventPointsForRank(rank) };
    });
  }

  function rankParticipants(participants) {
    const sorted = (Array.isArray(participants) ? participants : [])
      .map((participant, index) => ({ ...participant, _order: index }))
      .sort((left, right) =>
        Number(right.totalScore || 0) - Number(left.totalScore || 0) ||
        Number(left.joinedAtMs || 0) - Number(right.joinedAtMs || 0) ||
        left._order - right._order
      );

    let previousScore = null;
    let previousRank = 0;
    return sorted.map((participant, index) => {
      const score = Number(participant.totalScore || 0);
      const rank = previousScore === score ? previousRank : index + 1;
      previousScore = score;
      previousRank = rank;
      const { _order, ...result } = participant;
      return { ...result, rank };
    });
  }

  function eligibleFromMatch(status, matchNumber) {
    const current = Math.max(0, Number(matchNumber) || 0);
    return status === "playing" || status === "review" ? current + 1 : Math.max(1, current);
  }

  function gamePath(gameType) {
    return gameType === "bingo" ? "./bingo/" : "./nunchi-number/";
  }

  function gameUrl(gameType, eventId, matchId, roomId) {
    const params = new URLSearchParams({ event: eventId, match: matchId, room: roomId });
    return `${gamePath(gameType)}?${params.toString()}`;
  }

  function eventUrl(eventId, extra = {}) {
    const params = new URLSearchParams({ event: normalizeRoomId(eventId), ...extra });
    return `./?${params.toString()}`;
  }

  root.EventCore = Object.freeze({
    EVENT_STATUSES,
    GAME_TYPES,
    GAME_LABELS,
    createRoomId,
    normalizeRoomId,
    isValidRoomId,
    normalizeNickname,
    normalizeTitle,
    eventPointsForRank,
    rankGameResults,
    rankParticipants,
    eligibleFromMatch,
    gamePath,
    gameUrl,
    eventUrl,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
