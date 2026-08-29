const test = require("node:test");
const assert = require("node:assert/strict");

require("../core.js");
const core = globalThis.NowTimingCore;

function roomAt(announcedMillis, targetSeconds = 12) {
  return { announcedAt: { toMillis: () => announcedMillis }, targetSeconds };
}

test("목표 시간은 7초부터 15초까지 양 끝을 포함해 뽑는다", () => {
  assert.equal(core.randomTargetSeconds(() => 0), 7);
  assert.equal(core.randomTargetSeconds(() => 0.999999), 15);
});

test("3초 준비 뒤 시작하고 목표 5초 전에는 소수점, 3초 전에는 숫자 전체를 숨긴다", () => {
  const room = roomAt(1000, 12);
  assert.equal(core.roundStartMillis(room), 4000);
  assert.equal(core.timerPartialAtMillis(room), 11000);
  assert.equal(core.timerHiddenAtMillis(room), 13000);
  assert.equal(core.roundDeadlineMillis(room), 21000);
  assert.equal(core.timingState(room, 2500).phase, "prepare");
  assert.equal(core.timingState(room, 6000).phase, "visible");
  assert.equal(core.timingState(room, 11000).phase, "partial");
  assert.equal(core.timingState(room, 13000).phase, "hidden");
  assert.equal(core.timingState(room, 21000).phase, "closed");
});

test("타이머는 소수점 둘째 자리까지 표시한다", () => {
  assert.equal(core.formatElapsed(0), "0.00");
  assert.equal(core.formatElapsed(12346), "12.35");
  assert.equal(core.formatPartialElapsed(4999), "4.??");
});

test("목표와 가까운 순서대로 3·2·1점을 주고 같은 오차는 공동 순위다", () => {
  const ranked = core.rankAttempts([
    { uid: "a", elapsedMillis: 9900 },
    { uid: "b", elapsedMillis: 10100 },
    { uid: "c", elapsedMillis: 10400 },
    { uid: "d", elapsedMillis: 11000 },
  ], 10, ["a", "b", "c", "d"]);
  assert.deepEqual(ranked.map(({ uid, rank, points, errorMillis }) => ({ uid, rank, points, errorMillis })), [
    { uid: "a", rank: 1, points: 3, errorMillis: 100 },
    { uid: "b", rank: 1, points: 3, errorMillis: 100 },
    { uid: "c", rank: 3, points: 1, errorMillis: 400 },
    { uid: "d", rank: 4, points: 0, errorMillis: 1000 },
  ]);
});

test("표시값이 소수 첫째 자리까지 맞으면 4점, 둘째 자리까지 맞으면 5점이다", () => {
  assert.equal(core.precisionPoints(4), 5);
  assert.equal(core.precisionPoints(5), 4);
  assert.equal(core.precisionPoints(49), 4);
  assert.equal(core.precisionPoints(50), 0);
  assert.equal(core.pointsForRoundRank(4, 3), 5);
  assert.equal(core.pointsForRoundRank(4, 30), 4);
  assert.equal(core.pointsForRoundRank(1, 100), 3);
});

test("최종 순위는 점수와 승수 뒤 평균 오차가 작은 참가자를 앞세운다", () => {
  const ranked = core.rankPlayers([
    { uid: "a", score: 6, wins: 1, podiums: 2, submittedRounds: 2, totalErrorMillis: 800 },
    { uid: "b", score: 6, wins: 1, podiums: 2, submittedRounds: 2, totalErrorMillis: 400 },
    { uid: "c", score: 5, wins: 1, podiums: 2, submittedRounds: 2, totalErrorMillis: 100 },
  ]);
  assert.deepEqual(ranked.map(({ uid, rank }) => ({ uid, rank })), [
    { uid: "b", rank: 1 }, { uid: "a", rank: 2 }, { uid: "c", rank: 3 },
  ]);
});
