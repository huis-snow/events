const test = require("node:test");
const assert = require("node:assert/strict");

require("../core.js");
require("../presets.js");
const core = globalThis.ChosungEscapeCore;
const presets = globalThis.ChosungQuestionPresets;

test("초성 추천 문제은행은 쉬움 30·보통 30·어려움 20문제다", () => {
  assert.equal(presets.BANK.length, 80);
  assert.deepEqual(Object.fromEntries(["easy", "normal", "hard"].map((difficulty) => [
    difficulty,
    presets.BANK.filter((question) => question.difficulty === difficulty).length,
  ])), { easy: 30, normal: 30, hard: 20 });
  assert.equal(new Set(presets.BANK.map((question) => question.answer)).size, 80);
  presets.BANK.forEach((question) => assert.doesNotThrow(() => core.normalizeQuestion(question)));
});

test("난이도와 최근 정답 제외 조건으로 추천 문제를 고른다", () => {
  const hard = presets.sample({ count: 7, difficulty: "hard", random: () => 0.4 });
  assert.equal(hard.length, 7);
  assert.ok(hard.every((question) => question.difficulty === "hard"));
  const excluded = hard.slice(0, 3).map((question) => question.answer);
  const next = presets.sample({ count: 7, difficulty: "mixed", excludeAnswers: excluded, random: () => 0.7 });
  assert.ok(next.every((question) => !excluded.includes(question.answer)));
});
