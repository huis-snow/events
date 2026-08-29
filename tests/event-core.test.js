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
  assert.match(styles, /position: sticky/);
  assert.match(styles, /top: var\(--game-header-height/);
  assert.match(rules, /match \/readiness\/\{participantUid\}/);
  assert.match(rules, /validEventReadiness/);
});
