const test = require("node:test");
const assert = require("node:assert/strict");

require("../core.js");
const core = globalThis.MinoritySurvivalCore;

test("소수 쪽은 2점을 받고 전체의 25% 이하면 3점을 받는다", () => {
  const normal = core.scoreRound([
    { uid: "a", side: "A" }, { uid: "b", side: "A" },
    { uid: "c", side: "B" }, { uid: "d", side: "B" }, { uid: "e", side: "B" },
  ], ["a", "b", "c", "d", "e"]);
  assert.equal(normal.resultKind, "A");
  assert.deepEqual(normal.awardPoints, { a: 2, b: 2, c: 0, d: 0, e: 0 });

  const rare = core.scoreRound([
    { uid: "a", side: "A" }, { uid: "b", side: "B" },
    { uid: "c", side: "B" }, { uid: "d", side: "B" },
  ], ["a", "b", "c", "d"]);
  assert.equal(rare.resultKind, "A");
  assert.equal(rare.awardPoints.a, 3);
});

test("동률은 제출자 모두 1점, 만장일치는 모두 0점이다", () => {
  const tie = core.scoreRound([
    { uid: "a", side: "A" }, { uid: "b", side: "B" },
  ], ["a", "b", "c"]);
  assert.equal(tie.resultKind, "TIE");
  assert.deepEqual(tie.awardPoints, { a: 1, b: 1 });

  const unanimous = core.scoreRound([
    { uid: "a", side: "A" }, { uid: "b", side: "A" },
  ], ["a", "b"]);
  assert.equal(unanimous.resultKind, "NONE");
  assert.deepEqual(unanimous.awardPoints, { a: 0, b: 0 });
});

test("점수 다음 희귀 생존과 일반 생존 횟수로 공동 순위를 가른다", () => {
  const ranked = core.rankPlayers([
    { uid: "a", score: 6, rareWins: 0, survivalWins: 3 },
    { uid: "b", score: 6, rareWins: 1, survivalWins: 2 },
    { uid: "c", score: 4, rareWins: 1, survivalWins: 1 },
  ]);
  assert.deepEqual(ranked.map(({ uid, rank }) => ({ uid, rank })), [
    { uid: "b", rank: 1 }, { uid: "a", rank: 2 }, { uid: "c", rank: 3 },
  ]);
});

test("질문은 5~10개이고 선택지는 서로 달라야 한다", () => {
  const values = Array.from({ length: 5 }, (_, index) => ({
    prompt: `질문 ${index + 1}`,
    optionA: `A${index + 1}`,
    optionB: `B${index + 1}`,
  }));
  assert.equal(core.normalizeQuestions(values).length, 5);
  assert.throws(() => core.normalizeQuestions(values.slice(0, 4)), /5개/);
  assert.throws(() => core.normalizeQuestion({ prompt: "같은가", optionA: "네", optionB: "네" }), /서로 다른/);
});
