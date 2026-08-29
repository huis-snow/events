"use strict";

const core = require("../nunchi-number/core.js");

const PLAYER_COUNTS = Object.freeze([4, 6, 8, 10, 12, 16, 20]);
const SCORE_MODES = Object.freeze(["descending", "exact", "random"]);
const TOTAL_ROUNDS = 5;
const DEFAULT_GAMES_PER_CASE = 5000;
const BASE_SEED = 0x20260829;
const FORMULAS = Object.freeze([
  { label: "기존 100%", numberMax: (playerCount) => Math.max(5, playerCount) },
  { label: "신규 75%", numberMax: core.numberMaxForPlayers },
]);

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

function seedForCase(formulaIndex, modeIndex, playerCount) {
  return (BASE_SEED ^ ((formulaIndex + 1) * 0x9e3779b1) ^ ((modeIndex + 1) * 0x85ebca6b) ^ playerCount) >>> 0;
}

function randomCardPoints(numberMax, random) {
  if (numberMax === 0) return [];
  const cryptoObject = {
    getRandomValues(values) {
      for (let index = 0; index < values.length; index += 1) {
        values[index] = Math.floor(random() * 4294967296);
      }
      return values;
    },
  };
  return core.createRoundCardPoints(numberMax, "random", cryptoObject);
}

function simulateCase({ formula, formulaIndex, scoreMode, modeIndex, playerCount, gamesPerCase }) {
  const random = createRandom(seedForCase(formulaIndex, modeIndex, playerCount));
  const numberMax = formula.numberMax(playerCount);
  const players = Array.from({ length: playerCount }, (_, index) => ({
    uid: `p${index}`,
    nickname: `참가자 ${index + 1}`,
    score: 0,
  }));
  let totalPoints = 0;
  let zeroScorePlayers = 0;
  let tiedTopGames = 0;
  let awardedChoices = 0;

  for (let game = 0; game < gamesPerCase; game += 1) {
    const scores = new Uint16Array(playerCount);
    for (let round = 0; round < TOTAL_ROUNDS; round += 1) {
      const choices = players.map((player) => ({
        uid: player.uid,
        number: Math.floor(random() * numberMax) + 1,
      }));
      const cardPoints = scoreMode === "random" ? randomCardPoints(numberMax, random) : [];
      const result = core.computeRoundResult(players, choices, { numberMax, scoreMode, cardPoints });
      result.awards.forEach(({ uid, points }) => {
        scores[Number(uid.slice(1))] += points;
        totalPoints += points;
        awardedChoices += 1;
      });
    }
    const topScore = Math.max(...scores);
    if (scores.filter((score) => score === topScore).length > 1) tiedTopGames += 1;
    zeroScorePlayers += scores.filter((score) => score === 0).length;
  }

  const totalPlayers = gamesPerCase * playerCount;
  const totalChoices = totalPlayers * TOTAL_ROUNDS;
  return {
    numberMax,
    pointsPerPlayer: totalPoints / totalPlayers,
    zeroScoreRate: zeroScorePlayers / totalPlayers,
    tiedTopRate: tiedTopGames / gamesPerCase,
    awardedChoiceRate: awardedChoices / totalChoices,
  };
}

function simulateBalance(gamesPerCase = DEFAULT_GAMES_PER_CASE) {
  return FORMULAS.flatMap((formula, formulaIndex) =>
    SCORE_MODES.map((scoreMode, modeIndex) => {
      const cases = PLAYER_COUNTS.map((playerCount) => simulateCase({
        formula,
        formulaIndex,
        scoreMode,
        modeIndex,
        playerCount,
        gamesPerCase,
      }));
      return {
        formula: formula.label,
        scoreMode,
        cardRanges: cases.map((result) => result.numberMax).join("/"),
        pointsPerPlayer: cases.reduce((sum, result) => sum + result.pointsPerPlayer, 0) / cases.length,
        zeroScoreRate: cases.reduce((sum, result) => sum + result.zeroScoreRate, 0) / cases.length,
        tiedTopRate: cases.reduce((sum, result) => sum + result.tiedTopRate, 0) / cases.length,
        awardedChoiceRate: cases.reduce((sum, result) => sum + result.awardedChoiceRate, 0) / cases.length,
      };
    }),
  );
}

function printResults(results, gamesPerCase) {
  console.log(`고정 시드 ${BASE_SEED} · 인원별/규칙별 ${gamesPerCase.toLocaleString("ko-KR")}게임 · 게임당 ${TOTAL_ROUNDS}라운드`);
  console.log(`인원: ${PLAYER_COUNTS.join("/")}명`);
  console.table(results.map((result) => ({
    공식: result.formula,
    점수규칙: core.scoreModeLabel(result.scoreMode),
    카드수: result.cardRanges,
    "선택당 득점": `${(result.awardedChoiceRate * 100).toFixed(1)}%`,
    "1인 평균점수": result.pointsPerPlayer.toFixed(2),
    "0점 참가자": `${(result.zeroScoreRate * 100).toFixed(1)}%`,
    "1위 동점": `${(result.tiedTopRate * 100).toFixed(1)}%`,
  })));
}

if (require.main === module) {
  const gamesPerCase = parseGamesPerCase(process.argv[2]);
  printResults(simulateBalance(gamesPerCase), gamesPerCase);
}

module.exports = { parseGamesPerCase, simulateBalance };
