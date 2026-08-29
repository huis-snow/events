const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const hub = fs.readFileSync(path.join(root, "index.html"), "utf8");
const bingo = fs.readFileSync(path.join(root, "bingo/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "bingo/app.js"), "utf8");
const store = fs.readFileSync(path.join(root, "bingo/firebase-store.js"), "utf8");

test("게임 허브에서 빙고 하위 앱으로 이동한다", () => {
  assert.match(hub, /href="\.\/bingo\/"/);
  assert.match(hub, /다 같이 빙고/);
});

test("빙고 페이지는 규칙·설정·실시간 앱 모듈을 순서대로 불러온다", () => {
  const coreIndex = bingo.indexOf('src="./core.js"');
  const configIndex = bingo.indexOf('src="./firebase-config.js"');
  const appIndex = bingo.indexOf('src="./app.js?v=20260829-number-picker"');
  assert.ok(coreIndex >= 0 && configIndex > coreIndex && appIndex > configIndex);
});

test("빙고 페이지에 방장과 참가자의 핵심 조작이 있다", () => {
  for (const id of [
    "createRoomForm",
    "joinRoomForm",
    "playerForm",
    "numberPickerGrid",
    "numberPickerHint",
    "startGameButton",
    "hostLobbyMessage",
    "hostReadinessList",
    "randomDrawButton",
    "drawMachine",
    "soundToggleButton",
    "callNumberForm",
    "undoNumberButton",
    "playerGrid",
  ]) {
    assert.match(bingo, new RegExp(`id="${id}"`));
  }
});

test("1–50 숫자 카드를 누르는 순서대로 빙고판을 직접 채운다", () => {
  assert.match(app, /function createNumberPicker/);
  assert.match(app, /function toggleNumberCard/);
  assert.match(app, /setAttribute\("aria-pressed"/);
  assert.match(app, /nextEmptyBoardIndex/);
});

test("Firebase 저장소는 별도 bingoRooms 컬렉션과 익명 인증을 사용한다", () => {
  assert.match(store, /signInAnonymously/);
  assert.match(store, /"bingoRooms"/);
  assert.match(store, /runTransaction/);
  assert.match(store, /drawRandomNumber/);
});
