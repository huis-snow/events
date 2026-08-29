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
const eventApp = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");
const eventStore = fs.readFileSync(path.join(rootDir, "event-firebase-store.js"), "utf8");
const rules = fs.readFileSync(path.join(rootDir, "firestore.rules"), "utf8");

test("이벤트 게임 선택과 단독 실행에서 초성 탈출로 이동한다", () => {
  assert.match(hub, /href="\.\/chosung-escape\/"/);
  assert.match(hub, /data-game="chosung"/);
});

test("초성 탈출 페이지는 한글 규칙·Firebase 설정·실시간 앱을 불러온다", () => {
  assert.match(html, /src="\.\/core\.js\?v=20260829-keep-initials"/);
  assert.match(html, /src="\.\/presets\.js\?v=20260829-question-bank"/);
  assert.match(html, /src="\.\.\/question-pack-tools\.js\?v=20260829-question-tools"/);
  assert.match(html, /src="\.\/firebase-config\.js"/);
  assert.match(html, /type="module" src="\.\/app\.js\?v=20260829-question-tools"/);
  assert.match(html, /id="questionSetupForm"/);
  assert.match(html, /id="guessForm"/);
});

test("추천 문제를 자동 채우고 개별 교체·저장·JSON 공유를 지원한다", () => {
  assert.match(html, /id="presetDifficultySelect"/);
  assert.match(html, /id="autoFillButton"/);
  assert.match(html, /id="savePackButton"/);
  assert.match(html, /id="importPackInput"/);
  assert.match(app, /recommendedQuestions/);
  assert.match(app, /replaceQuestionRow/);
  assert.match(app, /packTools\.remember/);
  assert.match(app, /packTools\.download/);
});

test("힌트 단계 타이머를 단독·이벤트 방에서 설정하고 만료 시 자동 진행한다", () => {
  assert.match(html, /id="clueSecondsSelect"/);
  assert.match(html, /id="stageTimerValue"/);
  assert.match(hub, /id="chosungTimeSelect"/);
  assert.match(app, /advanceExpiredStage/);
  assert.match(app, /clueDeadlineMillis/);
  assert.match(store, /stageStartedAt: serverTimestamp\(\)/);
  assert.match(store, /advanceExpiredClue/);
  assert.match(eventApp, /clueSeconds: elements\.chosungTimeSelect\.value/);
  assert.match(eventStore, /stageStartedAt: null/);
  assert.match(rules, /chosungDeadlineAdvance/);
  assert.match(rules, /duration\.value\(resource\.data\.get\('clueSeconds', 20\), 's'\)/);
});

test("단계의 첫 정답자만 해당 점수를 받고 다음 힌트가 즉시 열린다", () => {
  assert.match(store, /storedGuess\.clueStage === room\.clueStage/);
  assert.match(store, /roomUpdate\.clueStage = room\.clueStage \+ 1/);
  assert.match(store, /roomUpdate\.stageStartedAt = serverTimestamp\(\)/);
});

test("정답은 비공개 secrets에, 참가자 추측은 guesses에 저장한다", () => {
  assert.match(store, /"chosungRooms"/);
  assert.match(store, /"secrets"/);
  assert.match(store, /"guesses"/);
  assert.match(app, /processPendingGuesses/);
  assert.match(app, /setFinishedResult/);
  assert.match(app, /setReadiness/);
});
