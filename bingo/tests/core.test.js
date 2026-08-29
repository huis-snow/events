const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const orderedBoard = Array.from({ length: 25 }, (_, index) => index + 1);

test("빙고판은 1~50의 서로 다른 숫자 25개만 허용한다", () => {
  assert.deepEqual(core.normalizeBoard(orderedBoard), orderedBoard);
  assert.throws(() => core.normalizeBoard(orderedBoard.slice(0, 24)), /25개/);
  assert.throws(() => core.normalizeBoard([...orderedBoard.slice(0, 24), 24]), /같은 숫자/);
  assert.throws(() => core.normalizeBoard([...orderedBoard.slice(0, 24), 51]), /1부터 50/);
});

test("가로·세로·대각선 12줄을 계산한다", () => {
  const called = [1, 2, 3, 4, 5, 6, 11, 16, 21, 7, 13, 19, 25];
  const progress = core.boardProgress(orderedBoard, called);
  assert.equal(progress.completedCount, 3);
  assert.deepEqual(progress.completedLines, [0, 5, 10]);
});

test("한 칸 남은 줄을 리치로 센다", () => {
  const progress = core.boardProgress(orderedBoard, [1, 2, 3, 4, 6, 11, 16]);
  assert.equal(progress.completedCount, 0);
  assert.equal(progress.nearCount, 2);
});

test("목표 빙고에 같은 호출로 도달한 참가자를 모두 우승 처리한다", () => {
  const players = [
    { uid: "a", nickname: "감자", board: orderedBoard },
    { uid: "b", nickname: "눈꽃", board: [...orderedBoard].reverse() },
  ];
  const winners = core.winningPlayers(players, [1, 2, 3, 4, 5, 21, 22, 23, 24, 25], 2);
  assert.deepEqual(winners.map((player) => player.uid), ["a", "b"]);
});

test("방 코드는 혼동하기 쉬운 문자를 제외한 8자리다", () => {
  const cryptoMock = {
    getRandomValues(bytes) {
      bytes.fill(0);
      return bytes;
    },
  };
  assert.equal(core.createRoomId(cryptoMock), "AAAAAAAA");
  assert.equal(core.normalizeRoomId("abcd2345"), "ABCD2345");
  assert.throws(() => core.normalizeRoomId("ABCDI234"), /8자리/);
});

test("공유 주소에는 정규화된 방 코드만 남긴다", () => {
  assert.equal(
    core.makeRoomUrl("https://huis-snow.github.io/events/bingo/?old=1#x", "abcd2345"),
    "https://huis-snow.github.io/events/bingo/?room=ABCD2345",
  );
});

test("랜덤 추첨은 이미 나온 숫자를 제외하고 남은 숫자만 뽑는다", () => {
  const called = Array.from({ length: 47 }, (_, index) => index + 1);
  const cryptoMock = {
    getRandomValues(values) {
      values[0] = 1;
      return values;
    },
  };
  assert.deepEqual(core.remainingNumbers(called), [48, 49, 50]);
  assert.equal(core.randomRemainingNumber(called, cryptoMock), 49);
  assert.equal(core.randomRemainingNumber([...called, 48, 49, 50], cryptoMock), null);
});
