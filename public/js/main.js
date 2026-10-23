// 진입점: 서버 이벤트(SSE)를 받아 UI(HUD·로그·선택지)와 3D 월드에 반영한다.
// 게임 규칙·확률·시나리오는 서버(game-core.js)에만 있고, 이 파일은 화면 표시와 입력 전달만 한다.
import { createGame3D } from "./game3d.js";
import { sfx, setMuted, isMuted } from "./audio.js";

(() => {
  "use strict";
  const PLACE_LABEL = {
    beach: "해변",
    jungle: "밀림",
    reef: "암초",
    cave: "동굴",
    cliff: "절벽",
  };

  // 섬 지도 — 장소 좌표(SVG 기준)와 연결 길
  const MAP_NODES = {
    beach: { x: 150, y: 192 },
    jungle: { x: 150, y: 120 },
    reef: { x: 242, y: 170 },
    cave: { x: 66, y: 112 },
    cliff: { x: 150, y: 52 },
  };
  const SPEEDS = [{ n: "느림", d: 28 }, { n: "보통", d: 14 }, { n: "빠름", d: 5 }];

  // 장소·시간·날씨에 따라 장면 일러스트(SVG)를 그린다
  // ================= 클라이언트: 화면 그리기와 입력 전달만 담당한다 =================
  const $ = (id) => document.getElementById(id);
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = $("log");
  const choicesBox = $("choices");
  const VIEW_LABEL = { third: "3인칭", top: "탑뷰", first: "1인칭" };
  const game = createGame3D($("game3d"), {
    travel: (place) => sendMove(place), // E 키 / 빛기둥 클릭
    arrive: (place) => sendMove(place), // 장소 안에서 멈춰 섰을 때
    onZone: (z) => { zoneNow = z; renderChoices(); refreshMap(); },
    onFrame: (pos) => updateMapPlayer(pos),
    onHint: (place) => {
      const h = $("interact-hint");
      h.textContent = place ? `E 키 또는 클릭 — ${PLACE_LABEL[place]}(으)로 이동` : "";
      h.classList.toggle("on", !!place);
    },
    onView: (mode) => { $("btn-view").textContent = `시점: ${VIEW_LABEL[mode]} (V)`; },
  });

  let speedIdx = 1;
  let typing = false;
  let skip = false;
  let awaiting = false;
  let selectionInProgress = false;
  let menu = null; // 서버가 답을 기다리는 선택지 (placeMenu가 있으면 그 장소 안에서만 보인다)
  let zoneNow = null; // 3D 화면에서 사용자가 실제로 들어와 있는 장소
  let curPlace = null, prevPlace = null, arrived = true; // 서버 기준 현재 장소 · 바로 전 장소 · 현재 장소에 실제로 도착했는지(3D)
  let travel = [];
  let last = null;
  let prev = null;
  let artKey = "";
  let slotMode = "load";
  let exitAfterSave = false;
  let pinned = true;

  function makePid() {
    try {
      let p = localStorage.getItem("island-pid");
      if (!p) {
        p = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
        localStorage.setItem("island-pid", p);
      }
      return p;
    } catch {
      return "anon" + Math.random().toString(16).slice(2).padEnd(20, "0");
    }
  }
  const pid = makePid();

  function send(msg) {
    fetch(`/api/msg?pid=${pid}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) }).catch(() => {});
  }

  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // 판자는 이모지 대신 갈색 목재 SVG로 그려 아이콘 색을 명확하게 표현한다.
  function makePlankIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 32 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("plank-icon-svg");
    const add = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      svg.appendChild(el);
    };
    add("path", { d: "M4 6.5 25 3.5 29 7.5 8 11.5Z", fill: "#c58a4b", stroke: "#6d3f20", "stroke-width": "1.2", "stroke-linejoin": "round" });
    add("path", { d: "M8 11.5 29 7.5 29 16.5 8 20.5Z", fill: "#8f542b", stroke: "#5b351c", "stroke-width": "1.2", "stroke-linejoin": "round" });
    add("path", { d: "M4 6.5 8 11.5 8 20.5 4 15.5Z", fill: "#a76a37", stroke: "#5b351c", "stroke-width": "1.2", "stroke-linejoin": "round" });
    add("path", { d: "M10 13.5 25 10.5 M10 17 19 15.3 M8.5 8.5 22.5 6.5", fill: "none", stroke: "#d7a064", "stroke-width": "1", "stroke-linecap": "round", opacity: ".9" });
    return svg;
  }

  function appendItemIcon(parent, itemName, fallbackIcon) {
    if (itemName === "판자") parent.appendChild(makePlankIcon());
    else parent.appendChild(document.createTextNode(fallbackIcon || "▫️"));
  }

  // ---------- 서버 이벤트 수신 (순서대로 하나씩 재생) ----------
  const queue = [];
  let pumping = false;
  let lastId = 0;

  function connect() {
    const es = new EventSource(`/api/stream?pid=${pid}&since=${lastId}`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.id <= lastId) return;
      lastId = ev.id;
      queue.push(ev);
      pump();
    };
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      try {
        await handle(queue.shift());
      } catch (err) {
        console.error(err);
      }
    }
    pumping = false;
  }

  async function handle(ev) {
    switch (ev.t) {
      case "screen": showScreen(ev.name); break;
      case "clear": game.resetPlace(); log.textContent = ""; pinned = true; prev = null; artKey = ""; clearChoices(); break;
      case "line": await addLine(ev); break;
      case "banner": log.appendChild(mk("p", "banner", ev.text)); scrollEnd(); break;
      case "state": applyState(ev.s, !!ev.r); break;
      case "choices": showChoices(ev); break;
      case "askName": askName(ev); break;
      case "setup": showSetup(ev); break;
      case "ending": renderEnding(ev); break;
      case "saves": renderSlots(ev.slots); break;
      case "gallery": renderGallery(ev); break;
      case "sfx": if (!ev.r) sfx(ev.kind); break;
      case "error": await addLine({ text: ev.message, kind: "danger" }); break;
      case "notice": showToast(ev.message); break;
    }
  }

  function showScreen(name) {
    for (const n of ["title", "play", "ending"]) $("screen-" + n).classList.toggle("active", n === name);
    if (name === "title") {
      for (const id of ["exit-modal", "save-modal"]) {
        const dlg = $(id);
        if (dlg.open) dlg.close();
      }
      exitAfterSave = false;
    }
    game.setScreen(name);
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message || "";
    toast.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("on"), 3000);
  }

  // ---------- 로그 ----------
  function scrollEnd() {
    log.scrollTop = log.scrollHeight;
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }
  log.addEventListener("scroll", () => { pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 48; });
  if (window.ResizeObserver) new ResizeObserver(() => { if (pinned) log.scrollTop = log.scrollHeight; }).observe(log);

  async function addLine(ev) {
    const p = mk("p", ev.kind || "");
    log.appendChild(p);
    if (!ev.typed || ev.r) { p.textContent = ev.text; scrollEnd(); return; }
    typing = true;
    skip = false;
    const delay = (ev.kind || "").includes("final") ? 70 : SPEEDS[speedIdx].d;
    for (const ch of ev.text) {
      p.textContent += ch;
      log.scrollTop = log.scrollHeight;
      if (!skip) await sleep(delay);
    }
    typing = false;
  }
  log.addEventListener("click", () => { if (typing) skip = true; });

  // ---------- 상태 표시 ----------
  function applyState(s, replay) {
    last = s;
    if (s.place !== curPlace) { // 장소가 바뀌면 바로 전 장소를 기억해 둔다 (이동 안내 문구에 쓴다)
      prevPlace = replay ? null : curPlace;
      curPlace = s.place;
      arrived = prevPlace === null;
    }
    $("stat-day").textContent = s.day;
    for (const k of ["hp", "hunger", "thirst", "sanity"]) {
      $("stat-" + k).textContent = s[k];
      const bar = $("bar-" + k);
      bar.style.width = s[k] + "%";
      bar.classList.toggle("low", s[k] < 30);
    }
    $("place-name").textContent = s.placeText;

    const goals = $("goal-list");
    goals.textContent = "";
    s.goals.forEach(([t, d]) => {
      // 과제 문구의 연속 공백·앞뒤 공백을 정규화해 화면에 불필요한 공백이 나타나지 않게 한다.
      const goalText = String(t).replace(/\s+/g, " ").trim();
      const raftMatch = /^뗏목 재료 모으기 (\d+)\/4$/.exec(goalText);
      const li = mk("li", [d ? "done" : "", raftMatch ? "raft-goal" : ""].filter(Boolean).join(" "));
      if (!raftMatch) {
        li.textContent = goalText;
      } else {
        li.appendChild(mk("span", "raft-goal-label", goalText));
        const parts = mk("span", "raft-part-icons");
        parts.setAttribute("role", "img");
        parts.setAttribute("aria-label", "뗏목 재료 보유 현황");
        RAFt_PARTS_UI.forEach(({ name, icon }) => {
          const owned = s.inventory.includes(name);
          const itemIcon = mk("span", `raft-part-icon ${owned ? "acquired" : "missing"}`);
          appendItemIcon(itemIcon, name, icon);
          itemIcon.title = owned ? `${name} 보유` : `${name} 미확보`;
          itemIcon.setAttribute("aria-label", itemIcon.title);
          parts.appendChild(itemIcon);
        });
        li.appendChild(parts);
      }
      goals.appendChild(li);
    });

    const inv = $("inventory-list");
    inv.textContent = "";
    if (!s.inventory.length) inv.appendChild(mk("li", "empty", "(없음)"));
    const counts = new Map();
    s.inventory.forEach((it) => counts.set(it, (counts.get(it) || 0) + 1));
    counts.forEach((n, it) => {
      const li = mk("li", "inventory-entry");
      const btn = mk("button", "inventory-item-button");
      const iconEl = mk("span", "inventory-item-icon");
      appendItemIcon(iconEl, it, ITEM_ICON[it] || "▫️");
      btn.appendChild(iconEl);
      btn.appendChild(document.createTextNode(` ${it}${n > 1 ? " ×" + n : ""}`));
      btn.type = "button";
      btn.title = "행동 메뉴가 열려 있을 때 누르면 아이템을 사용하거나 살펴봅니다.";
      btn.disabled = !inventoryClickAllowed();
      btn.addEventListener("click", () => clickInventoryItem(it));
      li.appendChild(btn);
      inv.appendChild(li);
    });

    const st = $("status-list");
    st.textContent = "";
    if (!s.status.length) st.appendChild(mk("span", "chip ok", "이상 없음"));
    s.status.forEach((x) => st.appendChild(mk("span", "chip " + x.k, `${x.icon} ${x.name}`)));

    const sc = s.score.toLocaleString("ko-KR");
    const scEl = $("stat-score");
    if (scEl.textContent !== sc) {
      scEl.textContent = sc;
      scEl.classList.remove("bump");
      void scEl.offsetWidth;
      scEl.classList.add("bump");
    }

    $("map-panel").classList.toggle("night", s.phase === "night");
    $("map-panel").classList.toggle("tide-high", s.phase === "day" && !s.low);
    refreshMap();

    game.applyState(s, replay); // 3D 월드 갱신 (낮/밤·날씨·물때·모닥불·멧돼지·플레이어 위치)
    $("danger-vignette").classList.toggle("on", !!s.fx.boar);

    if (prev && !replay) {
      const hpD = s.hp - prev.hp;
      const gain = Math.max(s.hunger - prev.hunger, s.thirst - prev.thirst, s.sanity - prev.sanity);
      for (const k of ["hp", "hunger", "thirst", "sanity"]) {
        const d = s[k] - prev[k];
        if (!d) continue;
        const f = mk("span", "float " + (d > 0 ? "up" : "down"), (d > 0 ? "+" : "") + d);
        $("bar-" + k).closest(".bar").appendChild(f);
        setTimeout(() => f.remove(), 1000);
        if (k === "hp" && d <= -8) {
          const sp = document.querySelector(".story-panel");
          sp.classList.remove("shake");
          void sp.offsetWidth;
          sp.classList.add("shake");
        }
      }
      if (hpD <= -4) {
        sfx("hurt");
        hurtFlash();
      }
      else if (hpD >= 6 || gain >= 12) sfx("good");
    }
    prev = { hp: s.hp, hunger: s.hunger, thirst: s.thirst, sanity: s.sanity };
  }

  // ---------- 지도 ----------
  // 지도의 장소를 누르면 3D 화면의 사용자가 그곳까지 걸어간다. 지도 위 내 위치는 3D 위치를 그대로 따라간다.
  document.querySelectorAll("#island-map .node").forEach((g) => {
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("r", "30");
    hit.setAttribute("fill", "transparent");
    g.prepend(hit);
    g.addEventListener("click", () => mapGo(g.dataset.key));
  });

  const isFound = (k) => !last || k === last.place || (k === "cave" ? last.found.cave : k === "cliff" ? last.found.cliff : true);
  // 3D 월드 좌표(x, z) → 지도(SVG) 좌표. 장소 다섯 곳의 배치에 맞춰 잡은 비례값이다.
  const MAP_SCALE = 2.88;
  function updateMapPlayer(pos) {
    const x = Math.min(288, Math.max(12, 150 + pos.x * MAP_SCALE));
    const y = Math.min(216, Math.max(18, 120 + pos.z * MAP_SCALE));
    $("map-player").style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  function refreshMap() {
    if (!last) return;
    document.querySelectorAll("#island-map .node").forEach((g) => {
      const k = g.dataset.key;
      const found = isFound(k);
      g.classList.toggle("hidden", !found);
      g.classList.toggle("here", k === zoneNow);
      g.classList.toggle("go", found && k !== zoneNow);
      g.querySelector(".lbl").textContent = found ? PLACE_LABEL[k] : "???";
    });
    $("map-hint").textContent = zoneNow
      ? `지금 ${PLACE_LABEL[zoneNow]} 안에 있습니다. 지도의 다른 장소를 누르면 그곳까지 걸어갑니다.`
      : "지도의 장소를 누르면 그곳까지 걸어갑니다. 직접 걸어도 지도의 내 위치가 따라 움직여요.";
  }

  // 지도 클릭 → 3D 사용자가 길을 따라 걸어간다. 도착해서 멈추면 서버에 '도착'이 전달된다.
  function mapGo(k) {
    if (!last || !isFound(k) || k === zoneNow) return;
    sfx("click");
    game.goTo(k);
  }

  // 서버가 장소 메뉴를 기다리는 중이고, 아직 가보지 않은 장소 안에 도착했을 때만 이동 요청을 보낸다
  function sendMove(k) {
    if (!awaiting || selectionInProgress || !menu || !menu.placeMenu || !last || k === last.place || !travel.includes(k)) return false;
    awaiting = false;
    selectionInProgress = true;
    sfx("click");
    lockCurrentMenu();
    game.setTargets(null, [], false);
    send({ type: "map", place: k });
    return true;
  }

  document.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && typing) { skip = true; e.preventDefault(); }
  });

  // ---------- 선택지 ----------
  // 장소 메뉴(무엇을 할까?)는 3D 화면에서 사용자가 그 장소 안에 서 있을 때만 보인다.
  // 이동 메뉴는 따로 없고, 서버가 장소 메뉴 맨 아래에 붙여 보내는 '→ 장소 이동' 항목으로 대신한다.
  function clearChoices() {
    choicesBox.textContent = "";
    menu = null;
    travel = [];
    selectionInProgress = false;
    refreshMap();
    game.setTargets(null, [], false);
    syncInventoryButtons();
  }
  function lockCurrentMenu() {
    choicesBox.querySelectorAll("button").forEach((btn) => { btn.disabled = true; });
    syncInventoryButtons();
  }
  function choose(i) {
    if (!awaiting || typing || selectionInProgress) return;
    awaiting = false;
    selectionInProgress = true;
    sfx("click");
    lockCurrentMenu();
    game.setTargets(null, [], false);
    send({ type: "choose", index: i });
  }
  function menuVisible() {
    return !!menu && (!menu.placeMenu || zoneNow === menu.placeMenu);
  }
  function inventoryClickAllowed() {
    return !!(awaiting && !selectionInProgress && !typing && menu && menu.placeMenu && menuVisible());
  }
  function syncInventoryButtons() {
    const enabled = inventoryClickAllowed();
    document.querySelectorAll("#inventory-list .inventory-item-button").forEach((btn) => {
      btn.disabled = !enabled;
      btn.classList.toggle("ready", enabled);
    });
  }
  function clickInventoryItem(name) {
    if (!inventoryClickAllowed()) {
      showToast("행동 메뉴가 표시될 때 소지품을 눌러 사용하거나 살펴볼 수 있습니다.");
      return;
    }
    awaiting = false;
    selectionInProgress = true;
    sfx("click");
    lockCurrentMenu();
    send({ type: "item", name });
  }
  function renderChoices() {
    if (selectionInProgress) return;
    choicesBox.textContent = "";
    if (!menu) return;
    if (menu.placeMenu && zoneNow === menu.placeMenu) arrived = true; // 현재 장소 안에 들어왔다
    if (!menuVisible()) {
      const here = PLACE_LABEL[menu.placeMenu];
      const ro = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c % 28 !== 0 && c % 28 !== 8 ? "으로" : "로"; }; // 받침 없음·ㄹ 받침은 '로'
      let msg;
      if (zoneNow && !(zoneNow === prevPlace && !arrived)) msg = `📍 ${PLACE_LABEL[zoneNow]}에 들어왔습니다. 잠깐 멈춰 서면 도착해서 이곳의 메뉴가 열려요.`;
      else if (!arrived && prevPlace && prevPlace !== menu.placeMenu) {
        // 이동 메뉴로 장소를 골라 걸어가는 중: 목적지는 here, 바로 전에 있던 곳은 prevPlace
        const from = PLACE_LABEL[prevPlace];
        msg = `🧭 ${here}${ro(here)} 이동 중입니다. 도착해 멈춰 서면 이곳의 메뉴가 열려요. ${from}${ro(from)} 돌아가려면 그곳의 빛기둥으로 걸어가 멈춰 서세요. (지도의 장소를 눌러도 됩니다)`;
      } else msg = `🧭 지금은 어느 장소 안에도 있지 않습니다. ${here}${ro(here)} 돌아가거나, 가고 싶은 장소의 빛기둥으로 걸어가 멈춰 서세요. (지도의 장소를 눌러도 됩니다)`;
      choicesBox.appendChild(mk("p", "prompt away", msg));
      syncInventoryButtons();
      return;
    }
    choicesBox.appendChild(mk("p", "prompt", menu.prompt));
    const list = mk("div", "choice-list");
    const moves = mk("div", "move-box");
    menu.options.forEach((opt, i) => {
      const move = !!menu.placeMenu && opt.startsWith("→ ");
      const btn = mk("button", "btn choice" + (move ? " move" : ""), opt);
      btn.type = "button";
      btn.disabled = !awaiting || selectionInProgress;
      btn.addEventListener("click", () => choose(i));
      (move ? moves : list).appendChild(btn);
    });
    choicesBox.appendChild(list);
    if (moves.children.length) {
      moves.prepend(mk("p", "move-sep", "어디로 갈까?"));
      choicesBox.appendChild(moves); // 이동 항목은 장소 메뉴 바로 아래에 늘 보이도록 따로 둔다
    }
    scrollEnd();
    syncInventoryButtons();
  }
  function showChoices(ev) {
    menu = ev;
    travel = ev.travel || [];
    selectionInProgress = false;
    awaiting = true;
    renderChoices();
    syncInventoryButtons();
    refreshMap();
    game.setTargets(null, travel, !!ev.placeMenu);
  }

  // ---------- 이름 / 엔딩 / 도감 / 저장 ----------
  function askName(ev) {
    // 구형 세이브/서버 이벤트와의 호환용. 신규 판은 통합 설정 화면을 사용한다.
    const input = $("setup-name");
    if (input) input.value = ev.name || "";
    showSetup({ name: ev.name || "", roles: [] });
  }

  function showSetup(ev) {
    const dlg = $("setup-modal");
    const name = $("setup-name");
    const role = $("setup-role");
    const desc = $("setup-role-desc");
    const difficulty = $("setup-diff");
    const difficultyDesc = $("setup-diff-desc");
    name.value = ev.name || "표류자";
    role.textContent = "";
    (ev.roles || []).forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.id;
      // 드롭다운에는 이름만 표시하고, 상세 설명은 아래 설명 영역에 표시한다.
      opt.textContent = r.unlocked ? r.name : `🔒 ${r.name}`;
      opt.disabled = !r.unlocked;
      opt.dataset.description = r.unlocked ? r.label : (r.hint || "아직 해금되지 않은 역할입니다.");
      role.appendChild(opt);
    });
    const updateRoleDesc = () => {
      const selected = role.options[role.selectedIndex];
      desc.textContent = selected ? selected.dataset.description || "" : "역할을 선택하세요.";
    };
    role.onchange = updateRoleDesc;
    const firstAvailable = Array.from(role.options).find((o) => !o.disabled);
    if (firstAvailable) role.value = firstAvailable.value;
    updateRoleDesc();

    // 난이도 드롭다운도 이름만 간결하게 보이고, 선택한 난이도의 설명은 아래에 유지한다.
    const updateDifficultyDesc = () => {
      const selected = difficulty.options[difficulty.selectedIndex];
      difficultyDesc.textContent = selected ? selected.dataset.description || "" : "";
    };
    difficulty.onchange = updateDifficultyDesc;
    updateDifficultyDesc();
    if (dlg.open) dlg.close();
    dlg.showModal();
    name.focus();
  }

  $("setup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("setup-name").value.trim().slice(0, 12) || "표류자";
    const diff = $("setup-diff").value;
    const role = $("setup-role").value;
    if (!role) { $("setup-role").focus(); return; }
    $("setup-modal").close();
    send({ type: "start", name, diff, role });
  });

  // 소지품 아이콘 (화면 표시용)
  const ITEM_ICON = { 성냥: "🔥", 칼: "🔪", 밧줄: "🧵", 대나무: "🎋", 판자: "🪵", 돛천: "⛵", 나침반: "🧭", 구급상자: "🧰", "빈 물병": "🥛", "물병(가득)": "💧", 유리병: "🍾", "유리병(물)": "🍶", 바나나: "🍌", 버섯: "🍄", 고사리: "🌿", 가재: "🦞", 새우: "🦐", 창: "🔱", "낡은 일기장": "📖", "생존 수첩": "📓", 조개목걸이: "🐚", 신호거울: "🔆", 노: "🛶" };
  // 뗏목 제작 4대 재료를 진행도와 함께 고정 순서로 표시한다.
  const RAFt_PARTS_UI = [
    { name: "대나무", icon: ITEM_ICON["대나무"] },
    { name: "판자", icon: ITEM_ICON["판자"] },
    { name: "밧줄", icon: ITEM_ICON["밧줄"] },
    { name: "돛천", icon: ITEM_ICON["돛천"] },
  ];

  function hurtFlash() {
    const f = $("hurt-flash");
    f.classList.remove("go");
    void f.offsetWidth;
    f.classList.add("go");
    game.shake(0.6);
  }

  // 결말 일러스트: 구조되면 일출 속 배·헬기·비행기·뗏목·구명보트, 쓰러지면 어두운 난파선
  function endingArt(key, win) {
    const L = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join("");
    const k = /heli/.test(key) ? "heli" : /plane/.test(key) ? "plane" : /raft/.test(key) ? "raft" : /lifeboat/.test(key) ? "boat" : /survivor/.test(key) ? "hut" : win ? "ship" : "lose";
    const night = k === "hut" || !win;
    const s1 = !win ? "#0d131b" : k === "hut" ? "#0b1d3a" : "#ff8a5a";
    const s2 = !win ? "#3a4656" : k === "hut" ? "#46618f" : "#ffe9a8";
    const w1 = !win ? "#16222d" : k === "hut" ? "#10426a" : "#1d8aa0";
    const w2 = !win ? "#090e14" : k === "hut" ? "#06203a" : "#0d4a63";
    const defs = `<defs><linearGradient id="eSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s1}"/><stop offset="1" stop-color="${s2}"/></linearGradient><linearGradient id="eSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${w1}"/><stop offset="1" stop-color="${w2}"/></linearGradient></defs>`;
    const orb = !night
      ? `<circle class="sv-glow" cx="200" cy="96" r="64" fill="#fff2b0" opacity=".45"/><circle cx="200" cy="96" r="28" fill="#ffd45c"/><circle cx="200" cy="96" r="20" fill="#ffe99a"/>`
      : `<circle cx="320" cy="30" r="${win ? 12 : 16}" fill="${win ? "#f6f3e4" : "#9aa5b3"}" opacity="${win ? 1 : 0.7}"/>${win ? "" : `<ellipse cx="90" cy="24" rx="62" ry="12" fill="#2a323d"/><ellipse cx="300" cy="20" rx="72" ry="13" fill="#2a323d" opacity=".9"/>`}${!win ? "" : L(16, (i) => `<circle class="sv-star${i % 2 ? " s2" : ""}" cx="${(i * 47 + 11) % 400}" cy="${(i * 31 + 5) % 60}" r="${(0.8 + (i % 3) * 0.4).toFixed(1)}" fill="#fff"/>`)}`;
    const waves = L(3, (i) => `<path class="sv-wave w${i}" d="M-60 ${100 + i * 12}q25-6 50 0t50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0" stroke="#f3efe6" stroke-opacity="${(0.45 - i * 0.12).toFixed(2)}" fill="none" stroke-width="${(2 - i * 0.4).toFixed(1)}"/>`);
    const obj = {
      ship: `<g class="sv-bob"><path d="M250 92h60l-8 12h-44z" fill="#2a3a4a"/><rect x="262" y="78" width="26" height="14" fill="#f3efe6"/><rect x="268" y="70" width="8" height="8" fill="#d4783a"/><path d="M272 68q-4-8 2-14t0-12" stroke="#fff" stroke-opacity=".6" stroke-width="3" fill="none"/></g>`,
      heli: `<g class="sv-bob"><ellipse cx="250" cy="52" rx="22" ry="10" fill="#e8eef2"/><path d="M270 50h34l2-6" stroke="#e8eef2" stroke-width="4" fill="none"/><rect x="238" y="46" width="12" height="7" rx="2" fill="#7fc8e8"/><path d="M236 66h28M242 62v4M258 62v4" stroke="#c9d2d9" stroke-width="2.4"/><path d="M250 42v4" stroke="#cfd8de" stroke-width="3"/><g><animateTransform attributeName="transform" type="rotate" from="0 250 40" to="360 250 40" dur=".5s" repeatCount="indefinite"/><path d="M214 40h72" stroke="#cfd8de" stroke-width="3" stroke-linecap="round" opacity=".8"/></g></g>`,
      plane: `<path d="M20 70q120-30 230-30" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round" fill="none"/><g class="sv-bob"><path d="M236 40l34-3 12 3-12 3z" fill="#f3f6f8"/><path d="M252 40l-10-12h6l12 12zM252 40l-10 12h6l12-12z" fill="#dfe6ea"/><path d="M238 40l-6-8h4l8 6z" fill="#d4783a"/></g>`,
      raft: `<g class="sv-bob"><path d="M160 104h80" stroke="#8a5a34" stroke-width="7" stroke-linecap="round"/><path d="M164 111h72" stroke="#7a4a2a" stroke-width="7" stroke-linecap="round"/><path d="M200 104V58" stroke="#5a3a22" stroke-width="3"/><path d="M200 60l30 22h-30z" fill="#f3efe6"/><path d="M200 58l12-4-12-4z" fill="#d4783a"/></g>`,
      boat: `<g class="sv-bob"><path d="M165 100h70l-10 14h-50z" fill="#e8742a"/><path d="M165 100h70" stroke="#fff" stroke-width="3"/><circle class="sv-glow" cx="200" cy="90" r="16" fill="#ffd45c" opacity=".5"/><rect x="197" y="86" width="6" height="10" rx="2" fill="#ffd45c"/><path d="M200 86v-8" stroke="#6b4a2b" stroke-width="2"/></g>`,
      hut: `<path d="M120 118q40-36 100-30t70 30z" fill="#10301f"/><path d="M180 100l22-20 22 20z" fill="#5a3a22"/><rect x="186" y="100" width="32" height="18" fill="#7a5230"/><rect x="198" y="106" width="9" height="12" fill="#ffd45c" opacity=".9"/><path d="M150 100q3-20 10-34" stroke="#2a1d15" stroke-width="3" fill="none"/><path d="M160 66q-12-2-18 6M160 66q-6-10-18-8M160 66q4-10 12-12M160 66q12-5 20 2" stroke="#10301f" stroke-width="3" fill="none" stroke-linecap="round"/><g class="sv-fire" transform="translate(260 108)"><path d="M0-12c5 7 7 10 0 16-7-6-5-10 0-16z" fill="#ff7a1a"/><path d="M0-6c3 4 4 6 0 9-4-3-3-5 0-9z" fill="#ffe99a"/></g>`,
      lose: `<g class="sv-bob"><path d="M150 106l18-20 46 4 16 18z" fill="#2a2f36"/><path d="M190 90l-4-40" stroke="#3a3f47" stroke-width="3"/><path d="M186 52l22 6-22 8z" fill="#4a4f57" opacity=".8"/><path d="M168 86l10 8" stroke="#1b1f25" stroke-width="2"/></g><g stroke="#9bb0c2" stroke-opacity=".35">${L(22, (i) => `<path class="sv-rain" d="M${i * 19} ${(i * 17) % 60}l-3 10"/>`)}</g>`,
    }[k];
    const fx = win
      ? L(18, (i) => `<rect class="sv-confetti c${i % 5}" x="${(i * 23 + 9) % 400}" y="-6" width="4" height="7" rx="1" fill="${["#ffd45c", "#ff7a5a", "#7fe0dc", "#fff", "#b58af0"][i % 5]}"/>`)
      : L(10, (i) => `<circle class="sv-ash c${i % 5}" cx="${(i * 41 + 17) % 400}" cy="-4" r="1.4" fill="#aab4c0"/>`);
    return `<svg viewBox="0 0 400 140" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${defs}<rect width="400" height="140" fill="url(#eSky)"/>${orb}<rect y="94" width="400" height="46" fill="url(#eSea)"/>${waves}${obj}${fx}</svg>`;
  }

  function renderEnding(ev) {
    $("ending-art").innerHTML = endingArt(ev.key, ev.win);
    const card = document.querySelector(".ending-card");
    card.classList.toggle("win", !!ev.win);
    card.classList.toggle("lose", !ev.win);
    $("ending-title").textContent = ev.title;
    $("ending-body").textContent = ev.body;
    document.querySelector(".ending-kicker").textContent = ev.kicker;
    $("ending-meta").textContent = ev.meta;
    const st = ev.stats;
    const box = $("ending-stats");
    box.textContent = "";
    const cards = mk("div", "stat-cards");
    [["점수", st.score], ["등급", st.grade, "grade-" + st.grade], ["순위", st.rank + "위"], ["최고 기록", st.best]].forEach(([l, v, c]) => {
      const card = mk("div", "stat-card");
      card.appendChild(mk("span", "", l));
      card.appendChild(mk("strong", c || "", String(v)));
      cards.appendChild(card);
    });
    box.appendChild(cards);
    box.appendChild(mk("p", "verdict", st.verdict));
    const meter = mk("div", "meter");
    const fill = mk("i");
    fill.style.width = st.myW + "%";
    const mark = mk("b");
    mark.style.left = st.avgX + "%";
    meter.append(fill, mark);
    box.appendChild(meter);
    box.appendChild(mk("p", "meter-note", `검은 선 = 평균 ${st.avg}점 · 이번 판은 평균보다 ${st.diff >= 0 ? "+" : ""}${st.diff}점`));
    const table = mk("table", "rank-table");
    const head = mk("tr");
    ["순위", "이름", "점수", "등급", "엔딩", "생존"].forEach((h) => head.appendChild(mk("th", "", h)));
    table.appendChild(mk("thead")).appendChild(head);
    const tb = mk("tbody");
    st.rows.forEach((r, i) => {
      if (st.gap && i === st.rows.length - 1) {
        const g = mk("tr");
        const td = mk("td", "", "⋯");
        td.colSpan = 6;
        g.appendChild(td);
        tb.appendChild(g);
      }
      const tr = mk("tr", r.me ? "me" : "");
      [r.rank, r.name, r.score].forEach((v) => tr.appendChild(mk("td", "", String(v))));
      tr.appendChild(mk("td", "grade-" + r.grade, r.grade));
      tr.appendChild(mk("td", "", r.ending));
      tr.appendChild(mk("td", "", r.day + "일"));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);
    box.appendChild(mk("p", "score-note", "점수 = (기본 점수) × 난이도·도구 완성도·위기 탈출 배율 ± 위기 대처 점수(배율 없이 그대로)"));
    showScreen("ending");
  }

  function renderGallery(ev) {
    $("gallery-desc").textContent = ev.desc;
    const list = $("gallery-list");
    list.textContent = "";
    ev.items.forEach((x) => {
      const d = mk("div", "gal" + (x.found ? "" : " locked"));
      d.appendChild(mk("strong", "", x.found ? x.title : x.role ? "🔒 잠긴 역할" : "???"));
      d.appendChild(mk("span", "", x.found ? x.text : x.role ? x.text : "아직 발견하지 못한 엔딩"));
      list.appendChild(d);
    });
    $("gallery-modal").showModal();
  }

  function openSlots(mode, shouldExitAfterSave = false) {
    slotMode = mode;
    exitAfterSave = mode === "save" && shouldExitAfterSave;
    $("modal-title").textContent = mode === "save" ? (exitAfterSave ? "저장 후 종료" : "저장") : "불러오기";
    $("modal-desc").textContent = mode === "save"
      ? (exitAfterSave ? "저장할 슬롯을 선택하세요. 저장을 마치면 타이틀 화면으로 이동합니다." : "슬롯을 선택해 현재 진행을 저장합니다.")
      : "이어할 슬롯을 선택하세요.";
    $("slot-list").textContent = "불러오는 중…";
    $("save-modal").showModal();
    send({ type: "saves" });
  }

  function renderSlots(slots) {
    const list = $("slot-list");
    list.textContent = "";
    slots.forEach((slot, i) => {
      const row = mk("div", "slot" + (slot ? "" : " empty"));
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const info = mk("div", "slot-info");
      info.appendChild(mk("strong", "", slot ? slot.title : `슬롯 ${i + 1} — 비어 있음`));
      const when = slot ? new Date(slot.at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
      info.appendChild(mk("span", "", slot ? `${slot.detail} · ${when}` : ""));
      row.appendChild(info);
      if (slot) {
        const del = mk("button", "slot-del", "삭제");
        del.type = "button";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm(`슬롯 ${i + 1}을(를) 삭제할까요?`)) send({ type: "delete", slot: i });
        });
        row.appendChild(del);
      }
      const pick = () => {
        if (slotMode === "save") {
          if (slot && !confirm(`슬롯 ${i + 1}을(를) 덮어쓸까요?`)) return;
          const shouldExit = exitAfterSave;
          exitAfterSave = false;
          send({ type: "save", slot: i, exitAfter: shouldExit });
        } else {
          if (!slot) { alert("빈 슬롯입니다."); return; }
          send({ type: "load", slot: i });
        }
        $("save-modal").close();
      };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
      list.appendChild(row);
    });
  }

  // ---------- 버튼 ----------
  $("btn-new").onclick = () => send({ type: "new" });
  $("btn-again").onclick = () => send({ type: "new" });
  $("btn-to-title").onclick = () => send({ type: "title" });
  $("btn-gallery").onclick = () => send({ type: "gallery" });
  $("btn-title-load").onclick = () => openSlots("load");
  $("btn-load").onclick = () => openSlots("load");
  $("btn-save").onclick = () => openSlots("save");
  $("btn-exit").onclick = () => $("exit-modal").showModal();
  $("btn-exit-cancel").onclick = () => $("exit-modal").close();
  $("btn-exit-save").onclick = () => {
    $("exit-modal").close();
    openSlots("save", true);
  };
  $("btn-exit-no-save").onclick = () => {
    $("exit-modal").close();
    send({ type: "title" });
  };
  $("save-modal").addEventListener("close", () => { exitAfterSave = false; });
  $("btn-speed").onclick = (e) => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    e.currentTarget.textContent = `글자 속도: ${SPEEDS[speedIdx].n}`;
  };
  $("btn-sound").onclick = (e) => {
    setMuted(!isMuted());
    e.currentTarget.textContent = `효과음: ${isMuted() ? "끔" : "켬"}`;
    if (!isMuted()) sfx("good");
  };

  // 이야기 패널이 HUD 바로 아래에 붙도록 HUD의 아래쪽 위치를 CSS 변수로 알려 준다
  const hudEl = document.querySelector("#screen-play .hud");
  const syncHud = () => document.documentElement.style.setProperty("--hud-bottom", Math.ceil(hudEl.getBoundingClientRect().bottom) + 10 + "px");
  if (window.ResizeObserver) new ResizeObserver(syncHud).observe(hudEl);
  window.addEventListener("resize", syncHud);
  syncHud();

  $("btn-view").onclick = () => game.cycleView();
  $("btn-panel").onclick = () => document.querySelector(".inventory-panel").classList.toggle("collapsed");
  if (window.innerWidth < 761) document.querySelector(".inventory-panel").classList.add("collapsed");
  setTimeout(() => $("controls-help").classList.add("hide"), 20000);
  $("controls-help").onclick = () => $("controls-help").classList.add("hide");

  connect();

})();
