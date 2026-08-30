const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const stores = [
  ["눈치 숫자", "nunchi-number/firebase-store.js", "submitChoice", "getOwnChoice"],
  ["소수결 생존", "minority-survival/firebase-store.js", "submitChoice", "getOwnChoice"],
  ["지금이다!", "now-timing/firebase-store.js", "submitAttempt", "getOwnAttempt"],
  ["한 칸만 더!", "one-more-step/firebase-store.js", "submitChoice", "getOwnChoice"],
];

test("20명 제출 게임은 공유 배열 거래 대신 원자적 배열 추가를 사용한다", () => {
  stores.forEach(([label, relativePath, submitName, nextName]) => {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    const start = source.indexOf(`async function ${submitName}`);
    const end = source.indexOf(`async function ${nextName}`, start);
    const submission = source.slice(start, end);
    assert.ok(start >= 0 && end > start, `${label} 제출 함수를 찾을 수 없습니다.`);
    assert.match(source, /arrayUnion/);
    assert.match(source, /writeBatch/);
    assert.match(submission, /submittedUids: arrayUnion\(user\.uid\)/);
    assert.match(submission, /batch\.commit\(\)/);
    assert.doesNotMatch(submission, /runTransaction/);
    assert.doesNotMatch(submission, /submittedUids: \[\.\.\.room\.submittedUids/);
  });
});
