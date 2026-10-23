"use strict";
// 난이도별 새 게임 시작 시 체력·정신력 범위 검증
const createGame = require("./game-core");

function memStore() {
  return {
    readSaves: () => [null, null, null],
    writeSaves: () => {},
    readRecords: () => [],
    writeRecords: () => {},
    getName: () => "",
    setName: () => {},
  };
}

const ranges = {
  easy: { hp: [72, 82], sanity: [65, 75] },
  normal: { hp: [60, 70], sanity: [50, 60] },
  hard: { hp: [45, 55], sanity: [40, 50] },
};

async function sample(diff) {
  return new Promise((resolve, reject) => {
    let started = false;
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      if (err) reject(err); else resolve(value);
    };
    let game;
    game = createGame((ev) => {
      if (ev.t === "error") finish(new Error(ev.message || "game error"));
      if (ev.t === "setup") {
        setImmediate(() => {
          started = true;
          game.handle({ type: "start", name: "초기수치테스트", diff, role: "medic" });
        });
      } else if (ev.t === "state" && started && !done) {
        // 시작 직후 화면 상태. 역할 보너스를 적용하기 전의 난이도별 기본 범위를 검사한다.
        const stats = { hp: ev.s.hp, sanity: ev.s.sanity };
        game.handle({ type: "title" });
        finish(null, stats);
      }
      return ev;
    }, memStore());
    game.handle({ type: "new" });
  });
}

(async () => {
  for (const [diff, r] of Object.entries(ranges)) {
    const seen = { hpMin: 101, hpMax: -1, sanityMin: 101, sanityMax: -1 };
    for (let i = 0; i < 40; i++) {
      const s = await sample(diff);
      if (s.hp < r.hp[0] || s.hp > r.hp[1] || s.sanity < r.sanity[0] || s.sanity > r.sanity[1]) {
        throw new Error(`${diff} 초기 수치 범위 위반: ${JSON.stringify(s)}`);
      }
      seen.hpMin = Math.min(seen.hpMin, s.hp); seen.hpMax = Math.max(seen.hpMax, s.hp);
      seen.sanityMin = Math.min(seen.sanityMin, s.sanity); seen.sanityMax = Math.max(seen.sanityMax, s.sanity);
    }
    console.log(`${diff}: 체력 ${seen.hpMin}~${seen.hpMax}, 정신 ${seen.sanityMin}~${seen.sanityMax} OK`);
  }
  console.log("난이도별 시작 능력치 테스트 통과 (120회)");
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
