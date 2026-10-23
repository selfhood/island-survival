"use strict";
// 무작위로 선택지를 고르는 봇이 게임을 끝까지 플레이해서 서버 로직의 런타임 오류를 찾아낸다.
const createGame = require("./game-core");

function memStore() {
  let saves = [null, null, null], records = [], name = "";
  return {
    readSaves: () => saves.slice(),
    writeSaves: (s) => { saves = s; },
    readRecords: () => records.map((r) => ({ ...r })),
    writeRecords: (a) => { records = a; },
    getName: () => name,
    setName: (n) => { name = n; },
  };
}

function playOnce(store) {
  return new Promise((resolve, reject) => {
    let steps = 0, seq = 0, lastState = null;
    const game = createGame((ev) => {
      ev.id = ++seq;
      if (ev.t === "error") reject(new Error("서버 오류 이벤트"));
      else if (ev.t === "state") lastState = ev.s;
      else if (ev.t === "setup") setImmediate(() => game.handle({ type: "start", name: "봇<b>", diff: "normal", role: "sailor" }));
      else if (ev.t === "askName") setImmediate(() => game.handle({ type: "name", value: "봇<b>" }));
      else if (ev.t === "choices") {
        if (++steps > 6000) return reject(new Error("선택이 너무 많음(무한 루프 의심)"));
        if (!ev.options.length) return reject(new Error("빈 선택지"));
        setImmediate(() => game.handle({ type: "choose", index: Math.floor(Math.random() * ev.options.length) }));
      } else if (ev.t === "ending") resolve({ ev, lastState });
      return ev;
    }, store);
    game.handle({ type: "new" });
  });
}

(async () => {
  process.on("unhandledRejection", (e) => { console.error("처리되지 않은 오류:", e); process.exit(1); });
  const n = Number(process.argv[2]) || 20;
  const store = memStore();
  const endings = {};
  for (let i = 0; i < n; i++) {
    const { ev } = await playOnce(store);
    endings[ev.title] = (endings[ev.title] || 0) + 1;
    if (!/^봇/.test(ev.kicker)) throw new Error("이름 처리 이상: " + ev.kicker);
  }
  console.log(`${n}판 완주 OK`);
  console.log(endings);
  process.exit(0);
})().catch((e) => { console.error("실패:", e); process.exit(1); });
