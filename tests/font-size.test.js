const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repositoryRoot = path.resolve(__dirname, "..");
const styleFiles = [
  "styles.css",
  "event-bridge.css",
  "bingo/styles.css",
  "nunchi-number/styles.css",
  "chosung-escape/styles.css",
];

test("화면에 표시되는 글자는 모든 페이지에서 최소 12px이다", () => {
  const violations = [];
  styleFiles.forEach((relativePath) => {
    const css = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    for (const match of css.matchAll(/(?:font-size|font)\s*:[^;]+/g)) {
      const declaration = match[0];
      const line = css.slice(0, match.index).split("\n").length;
      for (const size of declaration.matchAll(/(?<![\w.-])(\d*\.?\d+)(px|rem)\b/g)) {
        const pixels = size[2] === "rem" ? Number(size[1]) * 16 : Number(size[1]);
        if (pixels > 0 && pixels < 12) {
          violations.push(`${relativePath}:${line} (${size[0]})`);
        }
      }
    }
  });
  assert.deepEqual(violations, []);
});
