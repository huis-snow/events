const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("지금이다! 화면은 목표·숨김 타이머·단일 기록 버튼을 제공한다", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const store = fs.readFileSync(path.join(root, "firebase-store.js"), "utf8");
  assert.match(html, /id="targetSeconds"/);
  assert.match(html, /id="timerValue"/);
  assert.match(html, /id="stopButton"[^>]*>지금이다!/);
  assert.match(app, /formatPartialElapsed/);
  assert.match(app, /timerValue\.textContent = "\?\.\?\?"/);
  assert.match(app, /Date\.now\(\) - core\.roundStartMillis/);
  assert.match(store, /serverTimestamp\(\)/);
  assert.match(store, /submittedUids/);
});
