"use strict";
// 추위 대처 선택지, 멧돼지 피해량, 점수 문구 비노출 규칙의 회귀 테스트.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const src = fs.readFileSync(require.resolve("./game-core.js"), "utf8");

const bonusBlock = src.match(/function bonusNote\(n, why\) \{([\s\S]*?)\n  \}/);
assert.ok(bonusBlock, "bonusNote 함수가 있어야 함");
assert.match(bonusBlock[1], /state\.bonus\s*=\s*\(state\.bonus\s*\|\|\s*0\)\s*\+\s*n/, "점수는 내부 누적되어야 함");
assert.doesNotMatch(bonusBlock[1], /say\(|typeLine\(/, "점수 가산/감산 문구는 이야기 패널에 보내면 안 됨");
assert.doesNotMatch(src, /멧돼지 조우 결과: 체력/, "멧돼지의 숫자 결과를 이야기 패널에 직접 표시하지 않아야 함");

const boar = src.slice(src.indexOf("function boarOutcome(points, why)"), src.indexOf("// 멧돼지가 돌진하는 순간"));
assert.match(boar, /Math\.ceil\(Math\.abs\(points\)\s*\/\s*6\)/, "멧돼지 피해는 점수와 별도로 큰 체력·정신력 손실을 반영해야 함");
assert.match(src, /state\.hp -= 14;\s*state\.sanity -= 7;\s*boarOutcome\(-25/, "돌진에 들이받힐 때 직접 피해 강화 확인");
assert.match(src, /state\.hp -= 16;\s*state\.sanity -= 7;\s*boarOutcome\(-20/, "싸움 실패 피해 강화 확인");
assert.match(src, /state\.hp -= 10;\s*state\.sanity -= 6;\s*boarOutcome\(-15/, "나무 오르기 실패 피해 강화 확인");

const cold = src.slice(src.indexOf("async function nightChill()"), src.indexOf("// —— 물때 ——"));
for (const option of [
  "성냥으로 작은 모닥불을 피운다",
  "마른 잎과 풀을 여러 겹 덮어 보온한다",
  "바람을 덜 타는 바위 뒤로 옮겨 몸을 웅크린다",
  "제자리걸음으로 몸을 움직여 체온을 유지한다",
]) assert.ok(cold.includes(option), `추위 대응 선택지 누락: ${option}`);
assert.match(cold, /state\.weather === "storm" \? 0\.78 : 0\.60/, "날씨별 한기 발생 가능성을 반영해야 함");
assert.match(cold, /const placeChance = \{ cave: 0\.86, jungle: 0\.68, beach: 0\.56, reef: 0\.52, cliff: 0\.34 \}/, "장소별 바람 피하기 성공률이 있어야 함");
assert.match(cold, /addFlag\("야간임시모닥불"\)/, "야간 응급 불씨를 별도 상태로 관리해야 함");
assert.match(cold, /state\.hunger -= 2;\s*state\.thirst -= 2;/, "야간 응급 불씨는 자원 비용이 있어야 함");
assert.match(src, /if \(hasFlag\("야간임시모닥불"\)\) \{[\s\S]*?state\.hp \+= 2;\s*state\.sanity \+= 2;/, "야간 임시 불씨는 일반 모닥불보다 회복량이 작아야 함");
console.log("추위 대응·멧돼지 피해·점수 비노출 회귀 테스트 통과");
