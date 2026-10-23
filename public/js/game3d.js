// 3D 게임 조립: 렌더러·장면·카메라·월드·플레이어를 묶고, 서버 상태(state)를 장면으로 반영한다.
import * as THREE from "../vendor/three.module.min.js";
import { createWorld, PLACES, LINKS } from "./world.js";
import { createPlayer } from "./player.js";

export function createGame3D(canvas, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xcfe8ef, 0.0065);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1000);
  camera.position.set(0, 40, 90);

  const world = createWorld(scene);
  let targets = { reachable: new Set(), here: "beach", awaiting: false };
  const player = createPlayer({
    scene, world, camera, canvas,
    hooks: {
      getTargets: () => targets,
      interact: (place) => hooks.travel(place),
      onHint: hooks.onHint,
      onView: hooks.onView,
    },
  });
  player.teleportToPlace("beach");

  // 이동 가능한 장소를 화면 가장자리 안내 표(웨이포인트)로 알려준다 — 누르면 걸어가서 이동한다
  const wpBox = document.createElement("div");
  wpBox.id = "waypoints";
  document.body.appendChild(wpBox);
  const chips = {}, pv = new THREE.Vector3();
  function updateWaypoints() {
    const w = window.innerWidth, h = window.innerHeight;
    for (const p of Object.keys(PLACES)) {
      let chip = chips[p];
      if (!chip) {
        chip = chips[p] = document.createElement("button");
        chip.className = "wp";
        chip.type = "button";
        chip.addEventListener("click", () => goTo(p));
        wpBox.appendChild(chip);
      }
      const away = p === targets.here && zone !== targets.here; // 메뉴가 열리는 장소에서 멀어졌다면 돌아갈 표
      const on = targets.awaiting && ((targets.reachable.has(p) && p !== targets.here) || away) && zone !== p && player.rig.mode !== "orbit";
      chip.style.display = on ? "" : "none";
      if (!on) continue;
      const a = world.anchor(p);
      pv.set(a.x, a.y + 7.5, a.z).project(camera);
      let x = (pv.x * 0.5 + 0.5) * w, y = (-pv.y * 0.5 + 0.5) * h;
      if (pv.z > 1) { x = w - x; y = h - y; }
      const panel = document.querySelector(".inventory-panel");
      const minX = panel && w >= 760 && !panel.classList.contains("collapsed") ? panel.getBoundingClientRect().right + 70 : 60; // 왼쪽 정보 패널 위에 겹치지 않게
      const topMin = w < 761 ? 175 : 130;
      const story = document.querySelector(".story-panel");
      const maxX = w >= 761 && story && story.offsetParent ? story.getBoundingClientRect().left - 50 : w - 60; // 오른쪽 이야기 패널 위에 겹치지 않게
      const cx = Math.min(maxX, Math.max(minX, x)), cy = Math.min(h * 0.5, Math.max(topMin, y));
      const arrow = x < minX ? "◀ " : x > maxX ? " ▶" : y < topMin ? "▲ " : y > h * 0.5 ? "▼ " : "";
      const dist = Math.round(Math.hypot(a.x - player.pos.x, a.z - player.pos.z));
      chip.textContent = `${x > maxX ? "" : arrow}${PLACES[p].label} ${dist}m${x > maxX ? arrow : ""}`;
      chip.style.left = `${cx}px`;
      chip.style.top = `${cy}px`;
    }
  }

  const found = { cave: false, cliff: false };
  let lastPlace = null, shake = 0;

  // ── 위치 판정: 3D 화면에서 사용자(플레이어)의 실제 위치로 '어느 장소 안에 있는지'를 판단한다 ──
  let zone = null, dwell = 0, sentFor = null, sentAt = 0;
  const ZONE_R = 7; // 장소 중심에서 이 거리 안이면 그 장소 안
  const isFound = (p) => (p === "cave" ? found.cave : p === "cliff" ? found.cliff : true);
  function zoneAt() {
    let best = null, bd = ZONE_R;
    for (const p of Object.keys(PLACES)) {
      if (!isFound(p) && p !== targets.here) continue; // 서버가 지금 있다고 알려 준 장소는 늘 판정한다
      const d = Math.hypot(PLACES[p].x - player.pos.x, PLACES[p].z - player.pos.z) - (p === zone ? 1.2 : 0); // 경계에서 깜빡이지 않게 나갈 때는 조금 더 여유를 준다
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function trackZone(dt, t) {
    const z = zoneAt();
    if (z !== zone) { zone = z; dwell = 0; sentFor = null; hooks.onZone?.(zone); }
    // 다른 장소 안에서 멈춰 서면 '도착'으로 보고 서버에 알린다 (지나가기만 하면 도착하지 않는다)
    if (zone && zone !== targets.here && !player.isMoving()) {
      dwell += dt;
      if (sentFor && t - sentAt > 3) sentFor = null; // 응답이 없으면 다시 시도
      if (dwell > 0.45 && sentFor !== zone && hooks.arrive?.(zone)) { sentFor = zone; sentAt = t; }
    } else dwell = 0;
    hooks.onFrame?.(player.pos, zone);
  }

  // 목적지까지 길(흙길)을 따라 걸어가는 경로: 가장 가까운 길 위의 점에서 출발해 발견한 장소만 거쳐 간다
  function routePoints(dest) {
    const open = Object.keys(PLACES).filter(isFound);
    const adj = (a) => LINKS.filter((l) => l.includes(a)).map((l) => (l[0] === a ? l[1] : l[0])).filter((n) => open.includes(n));
    const bfs = (from) => {
      const prev = { [from]: null }, q = [from];
      while (q.length) { const c = q.shift(); if (c === dest) break; for (const n of adj(c)) if (!(n in prev)) { prev[n] = c; q.push(n); } }
      if (!(dest in prev)) return null;
      const path = [];
      for (let k = dest; k !== null; k = prev[k]) path.unshift(k);
      return path;
    };
    let best = null;
    for (const s of open) {
      const places = bfs(s);
      if (!places) continue;
      let pts = [];
      for (let i = 0; i + 1 < places.length; i++) pts = pts.concat(world.pathPoints(places[i], places[i + 1]) || [world.anchor(places[i + 1])]);
      if (!pts.length) pts = [world.anchor(dest)];
      let bi = 0, bd = 1e9;
      pts.forEach((p, i) => { const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z); if (d < bd) { bd = d; bi = i; } });
      let len = bd;
      for (let i = bi; i + 1 < pts.length; i++) len += pts[i].distanceTo(pts[i + 1]);
      if (!best || len < best.len) best = { len, pts: pts.slice(bi) };
    }
    const a = world.anchor(dest);
    return best ? [...best.pts, a] : [a];
  }
  function goTo(place) { if (isFound(place)) player.walkTo(routePoints(place)); }

  function refreshMarkers() {
    for (const p of ["beach", "jungle", "reef", "cave", "cliff"]) {
      world.setMarker(p, { found: p === "cave" ? found.cave : p === "cliff" ? found.cliff : true, here: p === targets.here, go: targets.reachable.has(p) && p !== targets.here });
    }
  }
  function applyState(s, replay) {
    found.cave = !!s.found.cave;
    found.cliff = !!s.found.cliff;
    targets.here = s.place;
    world.setEnv(s.phase === "night", s.weather, s.low);
    if (replay || lastPlace === null) world.snapEnv(player.pos); // 불러오기·재접속 직후엔 하늘을 즉시 맞춘다
    world.setFire(!!s.fx.fire, s.place);
    world.setShelters(Array.isArray(s.shelters) ? s.shelters : (s.fx.shelter ? [s.place] : []), s.shelterUpgrades || {});
    // 뗏목은 해변에서 한 번 제작되면 장면을 다시 그리거나 다른 장소로 이동해도 계속 남는다.
    world.setRaft(!!s.raft, !!s.raftDamaged);
    // 구명보트는 발견 이후 암초의 발견 위치에 유지한다. 노는 현재 소지품이 있을 때만 표시한다.
    world.setLifeboat(!!s.lifeboatFound, !!s.lifeboatHasOars);
    player.setIdentity(s.name, s.role);
    if (s.place !== lastPlace) {
      if (lastPlace === null || replay) player.teleportToPlace(s.place);
      else {
        const a = world.anchor(s.place);
        if (Math.hypot(player.pos.x - a.x, player.pos.z - a.z) >= 2.5) player.walkTo(routePoints(s.place)); // 발자국 길 등 흙길을 따라 이동
      }
      lastPlace = s.place;
      sentFor = null;
    }
    // 새 장소의 이벤트가 이동 시작 전에 도착해도, 이전 장소가 아니라 조우 장소의 플레이어 위치를 기준으로 멧돼지를 배치한다.
    const boarFocus = s.fx.boar && zone !== s.place ? world.anchor(s.place) : player.pos;
    world.setBoar(!!s.fx.boar, boarFocus, camera.position);
    refreshMarkers();
  }
  function setTargets(nav, travel, awaiting) {
    targets = { reachable: new Set([...(nav ? Object.keys(nav) : []), ...(travel || [])]), here: targets.here, awaiting: !!awaiting };
    refreshMarkers();
  }

  // 이야기 패널이 화면 아래를 가리므로, 플레이 중에는 장면을 위로 조금 밀어 올려 캐릭터가 가려지지 않게 한다
  let shiftTarget = 0, shiftCur = 0, xTarget = 0, xCur = 0;
  // PC: 좌측 정보 패널과 우측 이야기 패널 사이의 빈 곳이 화면 중앙이 되도록 장면을 가로로 민다
  function calcXTarget() {
    const w = window.innerWidth;
    if (!shiftTarget || w < 761) return 0;
    const panel = document.querySelector(".inventory-panel"), story = document.querySelector(".story-panel");
    const l = panel && !panel.classList.contains("collapsed") ? panel.getBoundingClientRect().right + 10 : 0;
    const r = story && story.offsetParent ? w - story.getBoundingClientRect().left + 10 : 0;
    return (l - r) / 2; // 양수면 장면이 오른쪽으로
  }
  function applyShift() {
    const w = window.innerWidth, h = window.innerHeight;
    if (Math.abs(shiftCur) < 0.002 && Math.abs(xCur) < 0.5 && shiftTarget === 0) camera.clearViewOffset();
    else camera.setViewOffset(w, h, -Math.round(xCur), Math.round(shiftCur * h), w, h);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyShift();
  }
  window.addEventListener("resize", resize);
  resize();

  // 자동 화질: 프레임이 느리면 해상도·그림자 품질을 단계적으로 낮춘다
  let quality = 2, accT = 0, accN = 0;
  function setQuality(q) {
    quality = q;
    if (q <= 1) { renderer.setPixelRatio(1); resize(); world.sun.shadow.mapSize.set(1024, 1024); world.sun.shadow.map?.dispose(); world.sun.shadow.map = null; }
    if (q <= 0) world.sun.castShadow = false;
  }
  const qParam = new URLSearchParams(location.search).get("q"); // ?q=0|1|2 로 화질을 직접 지정할 수 있다
  if (qParam !== null) setQuality(Math.max(0, Math.min(2, Number(qParam) || 0)));
  const clock = new THREE.Clock();
  let t = 0, frame = 0;
  renderer.setAnimationLoop(() => {
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.1);
    t += dt;
    accT += raw; accN++;
    if (accN >= 45) { if (accT / accN > 0.055 && quality > 0) setQuality(quality - 1); accT = 0; accN = 0; }
    player.update(dt, t);
    trackZone(dt, t);
    if ((frame++ & 15) === 0) xTarget = calcXTarget();
    if (Math.abs(shiftTarget - shiftCur) > 0.0005 || Math.abs(xTarget - xCur) > 0.5) {
      const k = Math.min(1, dt * 4);
      shiftCur += (shiftTarget - shiftCur) * k; xCur += (xTarget - xCur) * k; applyShift();
    }
    world.update(t, dt, player.pos, camera.position);
    updateWaypoints();
    if (shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake *= Math.pow(0.03, dt);
    }
    renderer.render(scene, camera);
  });

  const api = {
    applyState, setTargets, resize, goTo,
    resetPlace: () => { lastPlace = null; }, // 새 게임·불러오기 때 사용자를 서버가 알려 주는 장소에 다시 세운다
    setScreen: (name) => { player.setMode(name); shiftTarget = name === "play" ? (window.innerWidth < 761 ? 0.2 : 0.001) : 0; xTarget = calcXTarget(); }, // PC는 이야기 패널이 오른쪽에 있어 세로로는 밀지 않는다
    cycleView: () => player.cycleView(),
    shake: (v = 0.5) => { shake = Math.max(shake, v); },
    _debug: { scene, camera, world, player, renderer, getQuality: () => quality },
  };
  if (/[?&]debug/.test(location.search)) window.__island = api._debug;
  return api;
}
