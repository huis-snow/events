const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("../event-core.js");
const core = globalThis.EventCore;
const repositoryRoot = path.resolve(__dirname, "..");

test("이벤트 코드는 혼동 문자를 제외한 8자리로 만든다", () => {
  const id = core.createRoomId(() => 0);
  assert.equal(id, "AAAAAAAA");
  assert.equal(core.isValidRoomId(id), true);
  assert.equal(core.isValidRoomId("ABCD-2345"), true);
  assert.equal(core.isValidRoomId("ABCDO345"), false);
});

test("게임 순위는 동점 공동 순위와 표준 이벤트 점수를 적용한다", () => {
  const ranked = core.rankGameResults([
    { uid: "a", metrics: [5] },
    { uid: "b", metrics: [7] },
    { uid: "c", metrics: [5] },
    { uid: "d", metrics: [1] },
  ]);
  assert.deepEqual(ranked.map(({ uid, rank, eventPoints }) => ({ uid, rank, eventPoints })), [
    { uid: "b", rank: 1, eventPoints: 10 },
    { uid: "a", rank: 2, eventPoints: 8 },
    { uid: "c", rank: 2, eventPoints: 8 },
    { uid: "d", rank: 4, eventPoints: 5 },
  ]);
});

test("모든 게임이 1~5위와 참가자에게 같은 환산표를 쓴다", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 20].map(core.eventPointsForRank),
    [10, 8, 6, 5, 4, 2, 2],
  );
});

test("종합 순위는 같은 점수에 같은 순위를 주고 입장 시각은 표시 순서에만 쓴다", () => {
  const ranked = core.rankParticipants([
    { id: "late", totalScore: 10, joinedAtMs: 20 },
    { id: "early", totalScore: 10, joinedAtMs: 10 },
    { id: "third", totalScore: 7, joinedAtMs: 5 },
  ]);
  assert.deepEqual(ranked.map(({ id, rank }) => ({ id, rank })), [
    { id: "early", rank: 1 },
    { id: "late", rank: 1 },
    { id: "third", rank: 3 },
  ]);
});

test("진행 중 합류자는 다음 경기부터 참가한다", () => {
  assert.equal(core.eligibleFromMatch("lobby", 0), 1);
  assert.equal(core.eligibleFromMatch("preparing", 2), 2);
  assert.equal(core.eligibleFromMatch("playing", 2), 3);
  assert.equal(core.eligibleFromMatch("review", 2), 3);
});

test("이벤트 게임 주소에는 세션·경기·게임 방 정보가 모두 포함된다", () => {
  const url = core.gameUrl("bingo", "ABCDEFGH", "M003", "23456789");
  assert.equal(url, "./bingo/?event=ABCDEFGH&match=M003&room=23456789");
  assert.equal(
    core.gameUrl("chosung", "ABCDEFGH", "M004", "23456789"),
    "./chosung-escape/?event=ABCDEFGH&match=M004&room=23456789",
  );
});

test("이벤트 게임은 참가자의 준비 상태를 실시간 공유한다", () => {
  const bridge = fs.readFileSync(path.join(repositoryRoot, "event-bridge.js"), "utf8");
  const styles = fs.readFileSync(path.join(repositoryRoot, "event-bridge.css"), "utf8");
  const rules = fs.readFileSync(path.join(repositoryRoot, "firestore.rules"), "utf8");
  assert.match(bridge, /setReadiness/);
  assert.match(bridge, /event-bridge-readiness/);
  assert.match(bridge, /markPlayingPromise/);
  assert.match(styles, /event-readiness-person/);
  assert.doesNotMatch(styles, /\.event-bridge-bar \{[^}]*position: sticky/);
  assert.match(rules, /match \/readiness\/\{participantUid\}/);
  assert.match(rules, /validEventReadiness/);
});

test("GAME READY에서 진행자는 준비 방을 취소하고 같은 경기 선택으로 돌아간다", () => {
  const html = fs.readFileSync(path.join(repositoryRoot, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(repositoryRoot, "app.js"), "utf8");
  const store = fs.readFileSync(path.join(repositoryRoot, "event-firebase-store.js"), "utf8");
  const rules = fs.readFileSync(path.join(repositoryRoot, "firestore.rules"), "utf8");
  assert.match(html, /id="backToGameSelectButton"/);
  assert.match(app, /state\.store\.cancelPreparedGame/);
  assert.match(app, /match\.id\}-\$\{match\.gameRoomId\}/);
  assert.match(app, /maybeAutoMove\(match, eligible && !isHost\(\)\)/);
  assert.match(store, /async function cancelPreparedGame/);
  assert.match(store, /matchNumber: Math\.max\(0, latestRoom\.matchNumber - 1\)/);
  assert.match(store, /transaction\.delete\(readinessRef/);
  assert.match(rules, /eventPreparedCancellation/);
  assert.match(rules, /preparedMatchCancellation/);
  assert.match(rules, /readinessBelongsToCurrentMatch/);
});

test("이벤트 포탈과 세 게임은 서로 다른 저음량 배경 음악을 공유 설정으로 재생한다", () => {
  const music = fs.readFileSync(path.join(repositoryRoot, "background-music.js"), "utf8");
  const pages = ["index.html", "bingo/index.html", "nunchi-number/index.html", "chosung-escape/index.html"]
    .map((relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
  const scripts = ["app.js", "bingo/app.js", "nunchi-number/app.js", "chosung-escape/app.js"]
    .map((relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"))
    .join("\n");
  assert.match(music, /guild-events-sound/);
  assert.match(music, /audio\.loop = true/);
  assert.match(music, /audio\.preload = "none"/);
  pages.forEach((html) => assert.match(html, /soundToggleButton/));
  ["next-game-lounge", "bubbling-bingo", "dont-pick-mine", "hidden-syllables"]
    .forEach((track) => {
      assert.match(scripts, new RegExp(`${track}\\.mp3`));
      assert.ok(fs.statSync(path.join(repositoryRoot, "assets/audio", `${track}.mp3`)).size < 600_000);
    });
});
