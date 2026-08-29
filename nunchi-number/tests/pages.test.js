const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const gameDirectory = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(gameDirectory, "..");
const page = fs.readFileSync(path.join(gameDirectory, "index.html"), "utf8");
const hub = fs.readFileSync(path.join(repositoryRoot, "index.html"), "utf8");
const store = fs.readFileSync(path.join(gameDirectory, "firebase-store.js"), "utf8");
const app = fs.readFileSync(path.join(gameDirectory, "app.js"), "utf8");
const rules = fs.readFileSync(path.join(repositoryRoot, "firestore.rules"), "utf8");

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
  assert.match(page, /id="hostLobbyMessage"/);
  assert.match(app, /테스트 모드로 시작/);
  assert.match(app, /setReadiness/);
  assert.match(store, /activeUids\.length < 1/);
});

test("방 생성과 결과 화면에서 세 가지 점수 규칙을 지원한다", () => {
  assert.match(page, /name="scoreMode" value="descending" checked/);
  assert.match(page, /name="scoreMode" value="exact"/);
  assert.match(page, /name="scoreMode" value="random"/);
  assert.match(page, /id="winningPoints"/);
  assert.match(page, /id="lockedPoints"/);
  assert.match(app, /cardPointForNumber/);
  assert.match(store, /scoreMode: core\.normalizeScoreMode/);
  assert.match(store, /cardPoints: core\.createRoundCardPoints/);
});

test("Firebase 저장소는 별도 nunchiRooms 컬렉션과 익명 인증을 사용한다", () => {
  assert.match(store, /signInAnonymously/);
  assert.match(store, /"nunchiRooms"/);
  assert.match(store, /runTransaction/);
});

test("두 번째 라운드부터 기존 선택 문서를 안전하게 갱신한다", () => {
  assert.match(rules, /resource\.data\.round < request\.resource\.data\.round/);
  assert.doesNotMatch(rules, /choiceAfter\.data\.createdAt == request\.time/);
});
