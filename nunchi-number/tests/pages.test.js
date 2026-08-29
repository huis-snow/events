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
const eventApp = fs.readFileSync(path.join(repositoryRoot, "app.js"), "utf8");
const eventStore = fs.readFileSync(path.join(repositoryRoot, "event-firebase-store.js"), "utf8");
const rules = fs.readFileSync(path.join(repositoryRoot, "firestore.rules"), "utf8");

test("게임 허브에서 눈치 숫자 하위 앱으로 이동한다", () => {
  assert.match(hub, /href="\.\/nunchi-number\/"/);
  assert.match(hub, /눈치 숫자/);
});

test("눈치 숫자 페이지는 규칙·설정·실시간 앱을 순서대로 불러온다", () => {
  const coreIndex = page.indexOf('src="./core.js?v=20260829-timer"');
  const configIndex = page.indexOf('src="./firebase-config.js"');
  const appIndex = page.indexOf('src="./app.js?v=20260829-read-opt"');
  assert.ok(coreIndex >= 0);
  assert.ok(configIndex > coreIndex);
  assert.ok(appIndex > configIndex);
});

test("참가자의 3/4·최소 4장 규칙을 화면과 서버가 함께 사용한다", () => {
  assert.match(page, /카드는 참가 인원의 3\/4만큼, 최소 4장/);
  assert.match(rules, /data\.numberMax >= 4/);
});

test("선택 제한 시간은 이벤트·단독 방 모두에서 설정하고 만료 시 자동 공개한다", () => {
  assert.match(page, /name="choiceSeconds" value="20" checked/);
  assert.match(page, /id="roundTimerValue"/);
  assert.match(hub, /id="nunchiTimeSelect"/);
  assert.match(app, /revealExpiredRound/);
  assert.match(app, /choiceDeadlineMillis/);
  assert.match(store, /roundStartedAt: serverTimestamp\(\)/);
  assert.match(eventApp, /choiceSeconds: elements\.nunchiTimeSelect\.value/);
  assert.match(eventStore, /roundStartedAt: null/);
  assert.match(rules, /nunchiDeadlineReveal/);
  assert.match(rules, /duration\.value\(roomData\.get\('choiceSeconds', 20\), 's'\)/);
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

test("게임 시작은 최신 방 상태를 트랜잭션에서 확인하고 배포 모듈 캐시를 갱신한다", () => {
  assert.match(store, /room\.status === "choosing" && room\.round === 1/);
  assert.match(store, /room\/not-owner/);
  assert.match(store, /room\/not-lobby/);
  assert.match(app, /firebase-store\.js\?v=20260829-timer/);
  assert.match(page, /app\.js\?v=20260829-read-opt/);
});

test("기존 이벤트 연결 방은 참가자 문서를 유지한 채 정상 방 형식으로 복구한다", () => {
  assert.match(store, /const linkedEventRoom = room/);
  assert.match(store, /await deleteDoc\(roomRef\)/);
  assert.match(store, /await setDoc\(roomRef/);
  assert.match(store, /await startOnce\(\)/);
  assert.match(app, /게임방 재연결이 지연되고 있습니다/);
});

test("두 번째 라운드부터 기존 선택 문서를 안전하게 갱신한다", () => {
  assert.match(rules, /resource\.data\.round < request\.resource\.data\.round/);
  assert.doesNotMatch(rules, /choiceAfter\.data\.createdAt == request\.time/);
});

test("이벤트 연결 필드는 변경 목록으로 보호하면서 방장 상태 변경을 막지 않는다", () => {
  const nunchiRules = rules.slice(
    rules.indexOf("match /nunchiRooms/{roomId}"),
    rules.indexOf("match /chosungRooms/{roomId}"),
  );
  assert.match(nunchiRules, /affectedKeys\(\)\.hasOnly\([\s\S]*?'updatedAt'/);
  assert.doesNotMatch(nunchiRules, /request\.resource\.data\.get\('eventId'/);
  assert.doesNotMatch(nunchiRules, /request\.resource\.data\.get\('matchId'/);
});
