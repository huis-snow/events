const test = require("node:test");
const assert = require("node:assert/strict");

require("../core.js");
const core = globalThis.ChosungEscapeCore;

test("한글 정답에서 초성과 가운데 모음·음절 힌트를 만든다", () => {
  assert.equal(core.initialHint("아이스크림"), "ㅇ ㅇ ㅅ ㅋ ㄹ");
  assert.equal(core.vowelHint("아이스크림"), "ㅇ ㅇ ㅅㅡ ㅋ ㄹ");
  assert.equal(core.syllableHint("아이스크림"), "□ □ 스 □ □");
});

test("띄어쓰기와 기호를 무시하고 정답을 판정한다", () => {
  assert.equal(core.answersMatch("세종 대왕", "세종대왕"), true);
  assert.equal(core.answersMatch("K-POP", "kpop"), true);
  assert.equal(core.answersMatch("빙고", "빙수"), false);
});

test("공개 문제에는 정답 없이 네 단계 힌트만 담긴다", () => {
  const question = core.publicQuestion({ answer: "세종대왕", category: "인물", description: "한글을 만든 왕" });
  assert.deepEqual(question, {
    category: "인물",
    length: 4,
    initialHint: "ㅅ ㅈ ㄷ ㅇ",
    vowelHint: "ㅅ ㅈ ㄷㅐ ㅇ",
    syllableHint: "□ □ 대 □",
    description: "한글을 만든 왕",
  });
  assert.equal("answer" in question, false);
});

test("힌트가 늘어날수록 5·4·3·2점을 준다", () => {
  assert.deepEqual([0, 1, 2, 3].map(core.pointsForStage), [5, 4, 3, 2]);
  assert.equal(core.pointsForStage(99), 2);
});

test("문제는 5개에서 7개까지 등록한다", () => {
  const value = { answer: "테스트", category: "분류", description: "설명입니다" };
  assert.throws(() => core.normalizeQuestions(Array(4).fill(value)), /5개/);
  assert.equal(core.normalizeQuestions(Array(5).fill(value)).length, 5);
  assert.equal(core.normalizeQuestions(Array(7).fill(value)).length, 7);
  assert.throws(() => core.normalizeQuestions(Array(8).fill(value)), /7개/);
});

test("게임 점수가 같으면 공동 순위를 준다", () => {
  const ranked = core.rankPlayers([
    { uid: "a", score: 5 }, { uid: "b", score: 8 }, { uid: "c", score: 5 },
  ]);
  assert.deepEqual(ranked.map(({ uid, rank }) => ({ uid, rank })), [
    { uid: "b", rank: 1 }, { uid: "a", rank: 2 }, { uid: "c", rank: 2 },
  ]);
});
