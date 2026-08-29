const test = require("node:test");
const assert = require("node:assert/strict");

require("../core.js");
require("../presets.js");
const core = globalThis.MinoritySurvivalCore;
const presets = globalThis.MinorityQuestionPresets;

test("소수결 추천 문제은행은 서로 다른 50문제를 제공한다", () => {
  assert.equal(presets.BANK.length, 50);
  assert.equal(new Set(presets.BANK.map((question) => question.prompt)).size, 50);
  presets.BANK.forEach((question) => assert.doesNotThrow(() => core.normalizeQuestion(question)));
});

test("주제와 최근 문제 제외 조건으로 원하는 수만큼 고른다", () => {
  const food = presets.sample({ count: 10, category: "음식", random: () => 0.25 });
  assert.equal(food.length, 10);
  assert.ok(food.every((question) => question.category === "음식"));
  const excluded = food.slice(0, 2).map((question) => question.prompt);
  const next = presets.sample({ count: 5, category: "전체", excludePrompts: excluded, random: () => 0.5 });
  assert.ok(next.every((question) => !excluded.includes(question.prompt)));
});
