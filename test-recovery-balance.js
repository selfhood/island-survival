"use strict";
// 회복 이벤트의 종류, 일일 제한, 수치가 의도치 않게 과해지는 회귀를 확인한다.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const src = fs.readFileSync(require.resolve("./game-core.js"), "utf8");
const checks = [
  ["해변 휴식", /그늘을 찾아 쉰다/],
  ["밀림 회복", /그늘에서 몸과 마음을 추스른다/],
  ["암초 회복", /파도가 덜 닿는 바위 뒤에서 숨을 고른다/],
  ["동굴 휴식", /쉬어 간다/],
  ["기도 일일 제한", /if \(hasFlag\("오늘기도"\)\)/],
  ["해변 일일 제한", /if \(hasFlag\("해변휴식오늘"\)\)/],
  ["밀림 일일 제한", /if \(hasFlag\("밀림휴식오늘"\)\)/],
  ["암초 일일 제한", /if \(hasFlag\("암초휴식오늘"\)\)/],
  ["동굴 일일 제한", /if \(hasFlag\("동굴휴식오늘"\)\)/],
  ["절벽 명상 일일 제한", /if \(!hasFlag\("절벽사색오늘"\)\)/],
  ["일일 제한 초기화", /"오늘기도", "해변휴식오늘", "밀림휴식오늘", "암초휴식오늘", "동굴휴식오늘", "동굴먹거리탐색오늘", "절벽사색오늘"/],
  ["절벽 반복 회복 상한", /state\.sanity \+= 3;/],
  ["기도 회복 범위", /const gain = randInt\(6, 10\);/],
  ["구급상자 회복 조정", /state\.hp \+= 20;\s*state\.sanity \+= 4;/],
];
for (const [label, re] of checks) {
  assert.match(src, re, `회복 밸런스 점검 실패: ${label}`);
  console.log(`OK ${label}`);
}
console.log(`회복 이벤트 밸런스 회귀 점검 통과 (${checks.length}개)`);
