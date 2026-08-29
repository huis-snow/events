const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const gameDirectory = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(gameDirectory, "..");
const page = fs.readFileSync(path.join(gameDirectory, "index.html"), "utf8");
const hub = fs.readFileSync(path.join(repositoryRoot, "index.html"), "utf8");
const store = fs.readFileSync(path.join(gameDirectory, "firebase-store.js"), "utf8");

test("게임 허브에서 눈치 숫자 하위 앱으로 이동한다", () => {
  assert.match(hub, /href="\.\/nunchi-number\/"/);
  assert.match(hub, /눈치 숫자/);
});

test("눈치 숫자 페이지는 규칙·설정·실시간 앱을 순서대로 불러온다", () => {
  const coreIndex = page.indexOf('src="./core.js"');
  const configIndex = page.indexOf('src="./firebase-config.js"');
  const appIndex = page.indexOf('src="./app.js"');
  assert.ok(coreIndex >= 0);
  assert.ok(configIndex > coreIndex);
  assert.ok(appIndex > configIndex);
});

test("눈치 숫자 페이지에 비밀 선택과 방장 조작이 있다", () => {
  assert.match(page, /id="numberChoiceGrid"/);
  assert.match(page, /id="submitChoiceButton"/);
  assert.match(page, /id="revealRoundButton"/);
  assert.match(page, /id="nextRoundButton"/);
});

test("Firebase 저장소는 별도 nunchiRooms 컬렉션과 익명 인증을 사용한다", () => {
  assert.match(store, /signInAnonymously/);
  assert.match(store, /"nunchiRooms"/);
  assert.match(store, /runTransaction/);
});
