const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const players = [
  { uid: "a", nickname: "감자", score: 0 },
  { uid: "b", nickname: "눈꽃", score: 1 },
  { uid: "c", nickname: "모그리", score: 1 },
  { uid: "d", nickname: "초코보", score: 0 },
];

test("카드 수는 참가 인원의 3/4이며 최소 4장이다", () => {
  assert.equal(core.MIN_NUMBER_MAX, 4);
  assert.equal(core.CARD_RATIO_NUMERATOR, 3);
  assert.equal(core.CARD_RATIO_DENOMINATOR, 4);
  assert.deepEqual(
    [2, 4, 5, 6, 8, 10, 12, 16, 20].map(core.numberMaxForPlayers),
    [4, 4, 4, 5, 6, 8, 9, 12, 15],
  );
});

test("새 카드 비율은 6명 이상에서 무작위 단독 선택률을 약 25~34%로 유지한다", () => {
  [6, 8, 10, 12, 16, 20].forEach((playerCount) => {
    const numberMax = core.numberMaxForPlayers(playerCount);
    const expectedUniqueRate = ((numberMax - 1) / numberMax) ** (playerCount - 1);
    assert.ok(expectedUniqueRate >= 0.25 && expectedUniqueRate <= 0.34);
  });
});

test("중복을 제거한 가장 작은 단독 숫자가 승리한다", () => {
  const result = core.computeRoundResult(players, [
    { uid: "a", number: 1 },
    { uid: "b", number: 1 },
    { uid: "c", number: 3 },
    { uid: "d", number: 5 },
  ]);
  assert.equal(result.winningNumber, 3);
  assert.deepEqual(result.winnerUids, ["c"]);
  assert.equal(result.entries.find((entry) => entry.uid === "a").duplicate, true);
  assert.equal(result.entries.find((entry) => entry.uid === "c").winner, true);
});

test("모든 숫자가 중복이면 라운드 승자가 없다", () => {
  const result = core.computeRoundResult(players, [
    { uid: "a", number: 1 },
    { uid: "b", number: 1 },
    { uid: "c", number: 2 },
    { uid: "d", number: 2 },
  ]);
  assert.equal(result.winningNumber, 0);
  assert.deepEqual(result.winnerUids, []);
});

test("선택하지 않은 참가자를 결과에서 구분한다", () => {
  const result = core.computeRoundResult(players, [{ uid: "a", number: 2 }]);
  assert.deepEqual(result.missingUids, ["b", "c", "d"]);
});

test("최고 점수 동점자를 모두 찾는다", () => {
  assert.deepEqual(core.scoreLeaders(players).map((player) => player.uid), ["b", "c"]);
});

test("선택 숫자는 현재 자동 범위를 벗어날 수 없다", () => {
  assert.equal(core.normalizeChoice("5", 5), 5);
  assert.throws(() => core.normalizeChoice(6, 5), /1부터 5/);
});

test("구간 보상은 높은 승리 숫자에 최대 3점을 준다", () => {
  assert.equal(core.scoreForWinningNumber(1, 5, "tiered"), 1);
  assert.equal(core.scoreForWinningNumber(2, 5, "tiered"), 1);
  assert.equal(core.scoreForWinningNumber(3, 5, "tiered"), 2);
  assert.equal(core.scoreForWinningNumber(4, 5, "tiered"), 2);
  assert.equal(core.scoreForWinningNumber(5, 5, "tiered"), 3);
  assert.equal(core.scoreGuide(5, "tiered"), "1–2 = 1점 · 3–4 = 2점 · 5 = 3점");
});

test("역순 포인트는 1부터 5 카드에 5부터 1점을 배치한다", () => {
  assert.equal(core.DEFAULT_SCORE_MODE, "descending");
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((number) => core.cardPointForNumber(number, 5, "descending")),
    [5, 4, 3, 2, 1],
  );
  assert.equal(core.scoreGuide(5, "descending"), "1번 = 5점 · 5번 = 1점");
});

test("높은 숫자 보상과 기존 클래식 보상도 계산한다", () => {
  assert.equal(core.scoreForWinningNumber(8, 8, "exact"), 8);
  assert.equal(core.scoreForWinningNumber(8, 8, "classic"), 1);
  assert.equal(core.scoreForWinningNumber(0, 8, "tiered"), 0);
});

test("랜덤 현상금은 1부터 최대 숫자까지 중복 없이 섞는다", () => {
  const fakeCrypto = {
    getRandomValues(values) {
      values.set([0, 1, 2, 3, 4]);
      return values;
    },
  };
  const points = core.createRoundCardPoints(5, "random", fakeCrypto);
  assert.equal(points.length, 5);
  assert.deepEqual([...points].sort((left, right) => left - right), [1, 2, 3, 4, 5]);
  assert.equal(core.cardPointForNumber(3, 5, "random", points), points[2]);
});

test("랜덤 현상금에서는 중복되지 않은 모든 카드가 각자 득점한다", () => {
  const result = core.computeRoundResult(players, [
    { uid: "a", number: 1 },
    { uid: "b", number: 1 },
    { uid: "c", number: 3 },
    { uid: "d", number: 5 },
  ], {
    numberMax: 5,
    scoreMode: "random",
    cardPoints: [4, 1, 5, 2, 3],
  });
  assert.deepEqual(result.winnerUids, ["c", "d"]);
  assert.deepEqual(result.awards, [
    { uid: "c", number: 3, points: 5 },
    { uid: "d", number: 5, points: 3 },
  ]);
});

test("점수 규칙이 없는 기존 방은 클래식으로 읽는다", () => {
  const room = core.normalizeRoomSnapshot({
    version: 1,
    title: "기존 방",
    totalRounds: 5,
    status: "lobby",
    round: 0,
    numberMax: 0,
    ownerUid: "owner",
    activeUids: [],
    submittedUids: [],
    resultRound: 0,
    lastWinningNumber: 0,
    lastWinnerUids: [],
  }, "ABCD2345");
  assert.equal(room.scoreMode, "classic");
  assert.deepEqual(room.cardPoints, []);
  assert.deepEqual(room.lastAwardPoints, {});
});
