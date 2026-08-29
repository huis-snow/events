(function (root) {
  "use strict";

  function parse(value, fallback) {
    try { return JSON.parse(value); }
    catch (_error) { return fallback; }
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch (_error) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (_error) { return false; }
  }

  function createQuestionPackTools(namespace) {
    const packKey = `guild-events-${namespace}-question-pack`;
    const recentKey = `guild-events-${namespace}-recent-questions`;

    function save(questions) {
      return storageSet(packKey, JSON.stringify({ version: 1, game: namespace, questions }));
    }

    function load() {
      const value = parse(storageGet(packKey), null);
      return Array.isArray(value?.questions) ? value.questions : null;
    }

    function recent() {
      const value = parse(storageGet(recentKey), []);
      return Array.isArray(value) ? value.map(String) : [];
    }

    function remember(values, limit = 60) {
      const merged = [...recent(), ...(values || []).map(String)];
      const uniqueNewest = [];
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        if (!uniqueNewest.includes(merged[index])) uniqueNewest.push(merged[index]);
      }
      storageSet(recentKey, JSON.stringify(uniqueNewest.reverse().slice(-limit)));
    }

    function download(questions, filename) {
      const payload = JSON.stringify({ version: 1, game: namespace, questions }, null, 2);
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function readFile(file) {
      if (!file) throw new Error("불러올 JSON 파일을 선택해 주세요.");
      const value = parse(await file.text(), null);
      const questions = Array.isArray(value) ? value : value?.questions;
      if (!Array.isArray(questions)) throw new Error("문제 세트 형식이 올바르지 않습니다.");
      return questions;
    }

    return Object.freeze({ save, load, recent, remember, download, readFile });
  }

  root.QuestionPackTools = Object.freeze({ create: createQuestionPackTools });
})(typeof globalThis !== "undefined" ? globalThis : this);
