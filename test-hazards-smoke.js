"use strict";
const createGame = require("./game-core");
function memStore() {
  let saves = [null, null, null], records = [], name = "";
  return { readSaves: () => saves.slice(), writeSaves: (s) => { saves = s; }, readRecords: () => records.map((r) => ({ ...r })), writeRecords: (a) => { records = a; }, getName: () => name, setName: (n) => { name = n; } };
}
function playOnce(store, aggregate) {
  return new Promise((resolve, reject) => {
    let steps = 0, seq = 0;
    const game = createGame((ev) => {
      ev.id = ++seq;
      if (ev.t === "error") reject(new Error(ev.message || "server error"));
      if (ev.t === "line" && typeof ev.text === "string") {
        if (/이안류|해파리에 쏘였다/.test(ev.text)) aggregate.beach++;
        if (/벌떼가|가시덩굴/.test(ev.text)) aggregate.jungle++;
        if (/암초에 넘어져|젖은 이끼를 밟고 미끄러진다/.test(ev.text)) aggregate.reef++;
        if (/박쥐 떼가 갑자기/.test(ev.text)) aggregate.cave++;
        if (/돌풍이 몸을|갑작스러운 돌풍/.test(ev.text)) aggregate.cliff++;
      }
      if (ev.t === "setup") setImmediate(() => game.handle({ type: "start", name: "위험테스트", diff: "normal", role: "sailor" }));
      else if (ev.t === "choices") {
        if (++steps > 6000) return reject(new Error("too many choices"));
        if (!ev.options.length) return reject(new Error("empty choices"));
        setImmediate(() => game.handle({ type: "choose", index: Math.floor(Math.random() * ev.options.length) }));
      } else if (ev.t === "ending") resolve(ev.title);
      return ev;
    }, store);
    game.handle({ type: "new" });
  });
}
(async () => {
  const n = Number(process.argv[2]) || 150;
  const aggregate = { beach: 0, jungle: 0, reef: 0, cave: 0, cliff: 0 };
  const endings = {};
  const store = memStore();
  process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
  for (let i = 0; i < n; i++) {
    const ending = await playOnce(store, aggregate);
    endings[ending] = (endings[ending] || 0) + 1;
  }
  const missing = Object.entries(aggregate).filter(([, v]) => !v).map(([k]) => k);
  console.log(`${n}판 완주`, endings);
  console.log("장소별 위험 이벤트 발생 집계", aggregate);
  if (missing.length) throw new Error("위험 이벤트 관측 누락: " + missing.join(", "));
  console.log("장소별 위험 이벤트 smoke test OK");
  process.exit(0);
})().catch((e) => { console.error("실패:", e); process.exit(1); });
