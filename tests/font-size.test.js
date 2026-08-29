const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repositoryRoot = path.resolve(__dirname, "..");
const styleFiles = [
  "styles.css",
  "event-bridge.css",
  "background-music.css",
  "bingo/styles.css",
  "nunchi-number/styles.css",
  "chosung-escape/styles.css",
  "minority-survival/styles.css",
];

const pageFiles = [
  "index.html",
  "bingo/index.html",
  "nunchi-number/index.html",
  "chosung-escape/index.html",
  "minority-survival/index.html",
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

test("모든 페이지가 메이플스토리 기본 웹폰트를 불러온다", () => {
  pageFiles.forEach((relativePath) => {
    const html = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(html, /(?:\.\.\/|\.\/)fonts\.css\?v=20260829-maplestory/);
    assert.doesNotMatch(html, /Noto\+Sans\+KR/);
  });

  const fonts = fs.readFileSync(path.join(repositoryRoot, "fonts.css"), "utf8");
  assert.match(fonts, /MaplestoryOTFLight\.woff/);
  assert.match(fonts, /MaplestoryOTFBold\.woff/);
  assert.match(fonts, /\(주\)넥슨코리아/);
});
