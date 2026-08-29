const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");

test("소수결 페이지는 비밀 투표, 타이머, 이벤트 점수 연결을 갖춘다", () => {
  const html = fs.readFileSync(path.join(root, "minority-survival/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "minority-survival/app.js"), "utf8");
  const store = fs.readFileSync(path.join(root, "minority-survival/firebase-store.js"), "utf8");
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  assert.match(html, /id="choiceGrid"/);
  assert.match(html, /id="roundTimer"/);
  assert.match(html, /src="\.\/presets\.js\?v=20260829-question-bank"/);
  assert.match(html, /id="presetCategorySelect"/);
  assert.match(html, /id="autoFillButton"/);
  assert.match(html, /id="savePackButton"/);
  assert.match(app, /createEventBridge\(firebaseConfig, eventRequest, "minority"\)/);
  assert.match(app, /metrics: \[player\.score, player\.rareWins, player\.survivalWins\]/);
  assert.match(store, /async function submitChoice/);
  assert.match(store, /async function revealRound/);
  assert.match(rules, /match \/minorityRooms\/\{roomId\}/);
  assert.match(rules, /minorityParticipantSubmission/);
});

test("추천 질문은 전체·주제별 자동 채우기와 개별 교체·JSON 공유를 지원한다", () => {
  const app = fs.readFileSync(path.join(root, "minority-survival/app.js"), "utf8");
  assert.match(app, /recommendedQuestions/);
  assert.match(app, /replaceQuestionRow/);
  assert.match(app, /packTools\.remember/);
  assert.match(app, /packTools\.readFile/);
});
