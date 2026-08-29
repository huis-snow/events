const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const players = [
  { uid: "a", nickname: "감자", score: 0 },
  { uid: "b", nickname: "눈꽃", score: 1 },
  { uid: "c", nickname: "모그리", score: 1 },
  { uid: "d", nickname: "초코보", score: 0 },
];

test("숫자 범위는 최소 5이며 그 이상은 참가 인원과 같다", () => {
  assert.equal(core.numberMaxForPlayers(2), 5);
  assert.equal(core.numberMaxForPlayers(5), 5);
  assert.equal(core.numberMaxForPlayers(12), 12);
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

test("숫자 보상과 클래식 보상도 선택할 수 있다", () => {
  assert.equal(core.scoreForWinningNumber(8, 8, "exact"), 8);
  assert.equal(core.scoreForWinningNumber(8, 8, "classic"), 1);
  assert.equal(core.scoreForWinningNumber(0, 8, "tiered"), 0);
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
});
