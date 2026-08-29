const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("한 칸만 더! 화면은 비밀 진행/멈춤 선택과 턴 결과를 제공한다", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const store = fs.readFileSync(path.join(root, "firebase-store.js"), "utf8");
  assert.match(html, /data-decision="go"/);
  assert.match(html, /data-decision="stop"/);
  assert.match(html, /id="stepResults"/);
  assert.match(app, /triggerAutoReveal/);
  assert.match(store, /pushLuckRooms/);
  assert.match(store, /serverTimestamp\(\)/);
});
