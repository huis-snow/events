const test = require("node:test");
const assert = require("node:assert/strict");

require("../core.js");
const core = globalThis.OneMoreStepCore;

test("목표는 18–25, 주사위는 1–6의 양 끝을 포함한다", () => {
  assert.equal(core.randomTarget(() => 0), 18);
  assert.equal(core.randomTarget(() => 0.999999), 25);
  assert.equal(core.randomRoll(() => 0), 1);
  assert.equal(core.randomRoll(() => 0.999999), 6);
});

test("더 가기는 개인 주사위를 더하고 멈춤은 현재 합계를 잠근다", () => {
  const result = core.resolveTurn({
    activeUids: ["a", "b"], totals: { a: 17, b: 14 },
    decisions: { a: "go", b: "stop" }, target: 21, turn: 4, rolls: { a: 3 },
  });
  assert.deepEqual(result.totals, { a: 20, b: 14 });
  assert.deepEqual(result.continuingUids, ["a"]);
  assert.deepEqual(result.stoppedUids, ["b"]);
  assert.equal(result.roundComplete, false);
});

test("목표를 넘으면 폭발하고 미제출자는 안전하게 자동 멈춤한다", () => {
  const result = core.resolveTurn({
    activeUids: ["a", "b"], totals: { a: 20, b: 18 },
    decisions: { a: "go" }, target: 21, turn: 5, rolls: { a: 2 },
  });
  assert.deepEqual(result.bustedUids, ["a"]);
  assert.deepEqual(result.stoppedUids, ["b"]);
  assert.equal(result.roundComplete, true);
});

test("정확히는 5점, 1 차이는 4점, 나머지는 공동 순위 3·2·1점이다", () => {
  const ranked = core.rankRoundResults(
    ["a", "b", "c", "d", "e"],
    { a: 21, b: 20, c: 18, d: 18, e: 22 },
    ["e"],
    21,
  );
  assert.deepEqual(ranked.map(({ uid, rank, points }) => ({ uid, rank, points })), [
    { uid: "a", rank: 1, points: 5 },
    { uid: "b", rank: 2, points: 4 },
    { uid: "c", rank: 3, points: 1 },
    { uid: "d", rank: 3, points: 1 },
  ]);
});

test("최종 순위는 점수 다음 정확히·라운드 승리·생존 횟수로 정한다", () => {
  const ranked = core.rankPlayers([
    { uid: "a", score: 8, exactHits: 0, roundWins: 2, safeRounds: 3 },
    { uid: "b", score: 8, exactHits: 1, roundWins: 1, safeRounds: 2 },
    { uid: "c", score: 5, exactHits: 1, roundWins: 1, safeRounds: 1 },
  ]);
  assert.deepEqual(ranked.map(({ uid, rank }) => ({ uid, rank })), [
    { uid: "b", rank: 1 }, { uid: "a", rank: 2 }, { uid: "c", rank: 3 },
  ]);
});
