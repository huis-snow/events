"use strict";

require("../now-timing/core.js");
const core = globalThis.NowTimingCore;

const PLAYER_COUNTS = Object.freeze([4, 8, 12, 20]);
const SKILL_PROFILES = Object.freeze([
  { label: "숙련 · 오차 σ 0.15초", sigmaMillis: 150 },
  { label: "보통 · 오차 σ 0.35초", sigmaMillis: 350 },
  { label: "캐주얼 · 오차 σ 0.70초", sigmaMillis: 700 },
]);
const TOTAL_ROUNDS = 5;
const DEFAULT_GAMES_PER_CASE = 20000;
const BASE_SEED = 0x20260830;

function parseGamesPerCase(value) {
  if (value === undefined) return DEFAULT_GAMES_PER_CASE;
  const games = Number(value);
  if (!Number.isInteger(games) || games < 100 || games > 100000) {
    throw new Error("게임 수는 100부터 100000 사이의 정수여야 합니다.");
  }
  return games;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(random) {
  const left = Math.max(Number.EPSILON, random());
  const right = random();
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

function baselinePoints(rank) {
  return rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0;
}

function simulateCase({ playerCount, profile, gamesPerCase, seed }) {
  const random = createRandom(seed);
  const totals = {
    baselinePoints: 0,
    bonusPoints: 0,
    baselineZeroPlayers: 0,
    bonusZeroPlayers: 0,
    baselineTopTies: 0,
    bonusTopTies: 0,
    tenthHits: 0,
    hundredthHits: 0,
  };

  for (let game = 0; game < gamesPerCase; game += 1) {
    const baselineScores = new Uint16Array(playerCount);
    const bonusScores = new Uint16Array(playerCount);
    for (let round = 0; round < TOTAL_ROUNDS; round += 1) {
      const attempts = Array.from({ length: playerCount }, (_, index) => ({
        uid: `p${index}`,
        elapsedMillis: 10000 + Math.round(normalRandom(random) * profile.sigmaMillis),
      }));
      const ranked = core.rankAttempts(attempts, 10, attempts.map((attempt) => attempt.uid));
      ranked.forEach((entry) => {
        const index = Number(entry.uid.slice(1));
        const oldPoints = baselinePoints(entry.rank);
        baselineScores[index] += oldPoints;
        bonusScores[index] += entry.points;
        totals.baselinePoints += oldPoints;
        totals.bonusPoints += entry.points;
        if (entry.points === 5) totals.hundredthHits += 1;
        else if (entry.points === 4) totals.tenthHits += 1;
      });
    }
    const baselineTop = Math.max(...baselineScores);
    const bonusTop = Math.max(...bonusScores);
    totals.baselineZeroPlayers += baselineScores.filter((score) => score === 0).length;
    totals.bonusZeroPlayers += bonusScores.filter((score) => score === 0).length;
    if (baselineScores.filter((score) => score === baselineTop).length > 1) totals.baselineTopTies += 1;
    if (bonusScores.filter((score) => score === bonusTop).length > 1) totals.bonusTopTies += 1;
  }

  const playerGames = gamesPerCase * playerCount;
  const attempts = playerGames * TOTAL_ROUNDS;
  return {
    profile: profile.label,
    playerCount,
    baselineAverage: totals.baselinePoints / playerGames,
    bonusAverage: totals.bonusPoints / playerGames,
    increaseRate: totals.bonusPoints / totals.baselinePoints - 1,
    baselineZeroRate: totals.baselineZeroPlayers / playerGames,
    bonusZeroRate: totals.bonusZeroPlayers / playerGames,
    baselineTopTieRate: totals.baselineTopTies / gamesPerCase,
    bonusTopTieRate: totals.bonusTopTies / gamesPerCase,
    tenthHitRate: totals.tenthHits / attempts,
    hundredthHitRate: totals.hundredthHits / attempts,
  };
}

function simulateBalance(gamesPerCase = DEFAULT_GAMES_PER_CASE) {
  return SKILL_PROFILES.flatMap((profile, profileIndex) =>
    PLAYER_COUNTS.map((playerCount) => simulateCase({
      playerCount,
      profile,
      gamesPerCase,
      seed: (BASE_SEED ^ ((profileIndex + 1) * 0x9e3779b1) ^ playerCount) >>> 0,
    })),
  );
}

function printResults(results, gamesPerCase) {
  console.log(`고정 시드 ${BASE_SEED} · 조건별 ${gamesPerCase.toLocaleString("ko-KR")}게임 · 게임당 ${TOTAL_ROUNDS}라운드`);
  console.log("정밀 보너스: 표시값 0.0까지 일치 4P · 0.00까지 일치 5P");
  console.table(results.map((result) => ({
    오차모형: result.profile,
    인원: `${result.playerCount}명`,
    "기존 평균": result.baselineAverage.toFixed(2),
    "보너스 평균": result.bonusAverage.toFixed(2),
    "점수 증가": `${(result.increaseRate * 100).toFixed(1)}%`,
    "0점 기존→신규": `${(result.baselineZeroRate * 100).toFixed(1)}→${(result.bonusZeroRate * 100).toFixed(1)}%`,
    "1위 동점 기존→신규": `${(result.baselineTopTieRate * 100).toFixed(1)}→${(result.bonusTopTieRate * 100).toFixed(1)}%`,
    "4P 적중": `${(result.tenthHitRate * 100).toFixed(2)}%`,
    "5P 적중": `${(result.hundredthHitRate * 100).toFixed(2)}%`,
  })));
}

if (require.main === module) {
  const gamesPerCase = parseGamesPerCase(process.argv[2]);
  printResults(simulateBalance(gamesPerCase), gamesPerCase);
}

module.exports = { parseGamesPerCase, simulateBalance };
