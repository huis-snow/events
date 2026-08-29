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
