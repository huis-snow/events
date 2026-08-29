const test = require("node:test");
const assert = require("node:assert/strict");

test("문제 세트를 브라우저에 저장하고 최근 문제는 중복 없이 기억한다", () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  require("../question-pack-tools.js");
  const tools = globalThis.QuestionPackTools.create("test-game");
  const questions = [{ answer: "사과" }, { answer: "바나나" }];
  assert.equal(tools.save(questions), true);
  assert.deepEqual(tools.load(), questions);
  tools.remember(["사과", "바나나", "사과"], 3);
  tools.remember(["딸기", "바나나"], 3);
  assert.deepEqual(tools.recent(), ["사과", "딸기", "바나나"]);
  delete globalThis.localStorage;
});
