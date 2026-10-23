"use strict";
// 무인도 표류 — 서버. 게임 로직(game-core.js)은 이 서버 안에서만 실행되고,
// 브라우저에는 화면용 파일(public/)과 '화면에 보여줄 이벤트'만 전달된다.
const http = require("http");
const fs = require("fs");
const path = require("path");
const createGame = require("./game-core");
const PORT = Number(process.env.PORT) || 3000;


const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
// 정적 파일 경로 검증: public/ 안의 허용된 확장자 파일만 제공한다 (경로 탈출 차단)
function resolveStatic(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel === "/") rel = "/index.html";
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return null;
  const type = MIME[path.extname(full).toLowerCase()];
  return type ? { full, type } : null;
}
const PID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
};

const sessions = new Map();

// 플레이어별 저장소: 세이브·기록·이름은 서버 파일에 보관한다 (브라우저는 임의의 ID만 가진다)
function makeStore(pid) {
  const file = path.join(DATA_DIR, `${pid}.json`);
  let data = { saves: [null, null, null], records: [], name: "" };
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {}
  const flush = () => {
    try {
      fs.writeFileSync(file, JSON.stringify(data));
    } catch (e) {
      console.error("저장 실패", e.message);
    }
  };
  return {
    readSaves: () => Array.from({ length: 3 }, (_, i) => data.saves[i] || null),
    writeSaves: (s) => { data.saves = s; flush(); },
    readRecords: () => data.records.map((r) => ({ ...r })),
    writeRecords: (a) => { data.records = a.slice(-200); flush(); },
    getName: () => data.name,
    setName: (n) => { data.name = n; flush(); },
  };
}

function sendEvent(res, ev, replay) {
  const out = replay ? { ...ev, r: 1 } : ev;
  res.write(`id: ${ev.id}\ndata: ${JSON.stringify(out, (k, v) => (k === "answered" ? undefined : v))}\n\n`);
}

function getSession(pid) {
  let s = sessions.get(pid);
  if (s) {
    s.touched = Date.now();
    return s;
  }
  s = { events: [], listeners: new Set(), seq: 0, touched: Date.now(), hits: [] };
  const emit = (ev) => {
    ev.id = ++s.seq;
    if (ev.t === "clear") s.events.length = 0;
    s.events.push(ev);
    if (s.events.length > 4000) s.events.splice(0, s.events.length - 4000);
    for (const res of s.listeners) sendEvent(res, ev, false);
    return ev;
  };
  s.game = createGame(emit, makeStore(pid));
  sessions.set(pid, s);
  return s;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pid = url.searchParams.get("pid") || "";

  // 서버 → 브라우저: 화면에 보여줄 이벤트 스트림 (SSE)
  if (req.method === "GET" && url.pathname === "/api/stream") {
    if (!PID_RE.test(pid)) { res.writeHead(400).end(); return; }
    const s = getSession(pid);
    const hdr = req.headers["last-event-id"];
    const since = Number(hdr ?? url.searchParams.get("since") ?? 0) || 0;
    const fresh = hdr === undefined && since === 0; // 새로고침 직후엔 빠르게 되감기 재생
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    for (const ev of s.events) {
      if (ev.id <= since) continue;
      if ((ev.t === "choices" || ev.t === "askName") && ev.answered) continue;
      sendEvent(res, ev, fresh);
    }
    s.listeners.add(res);
    req.on("close", () => s.listeners.delete(res));
    return;
  }

  // 브라우저 → 서버: 선택·입력만 전달한다 (모두 서버가 검증)
  if (req.method === "POST" && url.pathname === "/api/msg") {
    if (!PID_RE.test(pid)) { res.writeHead(400).end(); return; }
    const s = getSession(pid);
    const now = Date.now();
    s.hits = s.hits.filter((t) => now - t < 1000);
    if (s.hits.push(now) > 30) { res.writeHead(429).end(); return; }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on("end", () => {
      try {
        s.game.handle(JSON.parse(body));
      } catch (e) {
        console.error("잘못된 요청", e.message);
      }
      res.writeHead(204, SECURITY_HEADERS).end();
    });
    return;
  }

  // 정적 파일: public/ 폴더(화면 파일, three.js)만 제공한다. 게임 로직(game-core.js)은 public 밖에 있어 요청해도 404.
  const entry = req.method === "GET" && resolveStatic(url.pathname);
  if (entry) {
    fs.readFile(entry.full, (err, buf) => {
      if (err) { res.writeHead(404, SECURITY_HEADERS).end("Not found"); return; }
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": entry.type, "Cache-Control": "no-cache" });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404, SECURITY_HEADERS).end("Not found");
});

setInterval(() => {
  for (const s of sessions.values()) for (const res of s.listeners) res.write(": ping\n\n");
}, 20000).unref();
setInterval(() => {
  const limit = Date.now() - 6 * 3600 * 1000;
  for (const [pid, s] of sessions) if (!s.listeners.size && s.touched < limit) { s.game.dispose(); sessions.delete(pid); }
}, 600000).unref();

process.on("unhandledRejection", (e) => console.error("처리되지 않은 오류:", e));
// server.listen(PORT, () => console.log(`무인도 표류 서버: http://localhost:${PORT}`)); // local 실행시
server.listen(PORT, () => console.log(`Server running on port ${PORT}`)); // render같은 서버에서 실행시
