const test = require("node:test");
const assert = require("node:assert/strict");

require("../core.js");
const core = globalThis.ChosungEscapeCore;

test("한글 정답에서 초성과 가운데 모음·음절 힌트를 만든다", () => {
  assert.equal(core.initialHint("아이스크림"), "ㅇ ㅇ ㅅ ㅋ ㄹ");
  assert.equal(core.vowelHint("아이스크림"), "ㅇ ㅇ ㅅㅡ ㅋ ㄹ");
  assert.equal(core.syllableHint("아이스크림"), "ㅇ ㅇ 스 ㅋ ㄹ");
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
    syllableHint: "ㅅ ㅈ 대 ㅇ",
    description: "한글을 만든 왕",
  });
  assert.equal("answer" in question, false);
});

test("힌트가 늘어날수록 5·4·3·2점을 준다", () => {
  assert.deepEqual([0, 1, 2, 3].map(core.pointsForStage), [5, 4, 3, 2]);
  assert.equal(core.pointsForStage(99), 2);
});

test("기존 방에 저장된 네모 힌트도 초성을 유지해서 표시한다", () => {
  const clue = core.clueForStage({
    initialHint: "ㅇ ㅇ ㅅ ㅋ ㄹ",
    syllableHint: "□ □ 스 □ □",
    description: "차가운 간식",
  }, 3);
  assert.equal(clue.hint, "ㅇ ㅇ 스 ㅋ ㄹ");
});

test("힌트 단계 시간은 15·20·30초이며 시작 시각에서 마감 시각을 계산한다", () => {
  assert.deepEqual(core.CLUE_SECONDS_OPTIONS, [15, 20, 30]);
  assert.equal(core.normalizeClueSeconds(), 20);
  assert.equal(core.clueDeadlineMillis({
    clueSeconds: 15,
    stageStartedAt: new Date("2026-08-29T00:00:00.000Z"),
  }), Date.parse("2026-08-29T00:00:15.000Z"));
  assert.throws(() => core.normalizeClueSeconds(10), /제한 시간/);
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
