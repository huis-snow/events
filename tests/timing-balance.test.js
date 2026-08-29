const test = require("node:test");
const assert = require("node:assert/strict");

const simulation = require("../scripts/simulate-timing-balance.js");

test("지금이다! 밸런스 시뮬레이터는 입력 범위를 검증한다", () => {
  assert.equal(simulation.parseGamesPerCase(), 20000);
  assert.equal(simulation.parseGamesPerCase("100"), 100);
  assert.throws(() => simulation.parseGamesPerCase("99"), /100부터/);
});

test("정밀 보너스는 0점 참가자를 줄이면서 보통 참가자의 평균 점수를 과도하게 늘리지 않는다", () => {
  const results = simulation.simulateBalance(200);
  const ordinary = results.filter((result) => result.profile.startsWith("보통"));
  ordinary.forEach((result) => {
    assert.ok(result.bonusZeroRate <= result.baselineZeroRate);
    assert.ok(result.increaseRate < 0.85);
    assert.ok(result.hundredthHitRate < result.tenthHitRate);
  });
});
