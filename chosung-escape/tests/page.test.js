const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const gameDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(gameDir, "..");
const html = fs.readFileSync(path.join(gameDir, "index.html"), "utf8");
const app = fs.readFileSync(path.join(gameDir, "app.js"), "utf8");
const store = fs.readFileSync(path.join(gameDir, "firebase-store.js"), "utf8");
const hub = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");

test("이벤트 게임 선택과 단독 실행에서 초성 탈출로 이동한다", () => {
  assert.match(hub, /href="\.\/chosung-escape\/"/);
  assert.match(hub, /data-game="chosung"/);
});

test("초성 탈출 페이지는 한글 규칙·Firebase 설정·실시간 앱을 불러온다", () => {
  assert.match(html, /src="\.\/core\.js"/);
  assert.match(html, /src="\.\/firebase-config\.js"/);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.match(html, /id="questionSetupForm"/);
  assert.match(html, /id="guessForm"/);
});

test("정답은 비공개 secrets에, 참가자 추측은 guesses에 저장한다", () => {
  assert.match(store, /"chosungRooms"/);
  assert.match(store, /"secrets"/);
  assert.match(store, /"guesses"/);
  assert.match(app, /processPendingGuesses/);
  assert.match(app, /setFinishedResult/);
});
