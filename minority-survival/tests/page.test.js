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
  assert.match(app, /createEventBridge\(firebaseConfig, eventRequest, "minority"\)/);
  assert.match(app, /metrics: \[player\.score, player\.rareWins, player\.survivalWins\]/);
  assert.match(store, /async function submitChoice/);
  assert.match(store, /async function revealRound/);
  assert.match(rules, /match \/minorityRooms\/\{roomId\}/);
  assert.match(rules, /minorityParticipantSubmission/);
});
