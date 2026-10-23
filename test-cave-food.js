"use strict";
// 동굴 먹거리 발견·소지품 섭취와 휴식 문구의 회귀 검사를 수행한다.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const core = fs.readFileSync(require.resolve("./game-core.js"), "utf8");
const ui = fs.readFileSync(require.resolve("./public/js/main.js"), "utf8");
const checks = [
  ["동굴 먹거리 탐색 메뉴", /동굴에서 먹거리를 찾는다/],
  ["하루 탐색 제한", /const canSearchFood = !hasFlag\("동굴먹거리탐색오늘"\)/],
  ["탐색 제한 다음 날 초기화", /"동굴휴식오늘", "동굴먹거리탐색오늘"/],
  ["버섯 발견 및 보관", /addItem\("버섯", true\)/],
  ["고사리 발견 및 보관", /addItem\("고사리", true\)/],
  ["가재 발견 및 보관", /addItem\("가재", true\)/],
  ["새우 발견 및 보관", /addItem\("새우", true\)/],
  ["버섯 섭취 처리", /"버섯": \{ hunger: 12/],
  ["고사리 섭취 처리", /"고사리": \{ hunger: 14/],
  ["가재 섭취 처리", /"가재": \{ hunger: 22/],
  ["새우 섭취 처리", /"새우": \{ hunger: 18/],
  ["버섯 아이콘", /버섯: "🍄"/],
  ["고사리 아이콘", /고사리: "🌿"/],
  ["가재 아이콘", /가재: "🦞"/],
  ["새우 아이콘", /새우: "🦐"/],
  ["반복 휴식 문구", /잠시 더 휴식/],
];
for (const [label, re] of checks) {
  assert.match(label.includes("아이콘") ? ui : core, re, `동굴 먹거리 검사 실패: ${label}`);
  console.log(`OK ${label}`);
}
assert.doesNotMatch(core, /오늘 휴식함/);
console.log(`동굴 먹거리·휴식 문구 회귀 점검 통과 (${checks.length + 1}개)`);
