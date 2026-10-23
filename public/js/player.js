// 플레이어 아바타 · 입력(키보드/마우스/터치) · 카메라 리그(3인칭/탑뷰/1인칭/궤도)
import * as THREE from "../vendor/three.module.min.js";
import { PLACES, WALK_MIN, heightAt, makeLabel } from "./world.js";

const ROLE_COLOR = { sailor: 0x2b6cb0, medic: 0xe8edf2, explorer: 0xc28a3a, fisher: 0x2f855a, pilot: 0x6b7280, navigator: 0x3b4a8a, survivalist: 0x6b4f2a };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

export const VIEWS = ["third", "top", "first"];

export function createPlayer({ scene, world, camera, canvas, hooks }) {
  // ── 아바타 ──
  const avatar = new THREE.Group();
  scene.add(avatar);
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const shirt = mat(0xd4783a);
  const part = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; return o; };
  const limb = (w, h, d, m, x, y) => { const g = new THREE.Group(); g.position.set(x, y, 0); g.add(part(new THREE.BoxGeometry(w, h, d), m, 0, -h / 2, 0)); return g; };
  const body = new THREE.Group();
  avatar.add(body);
  body.add(part(new THREE.BoxGeometry(0.7, 0.9, 0.4), shirt, 0, 1.35, 0));
  body.add(part(new THREE.SphereGeometry(0.28, 14, 10), mat(0xf0c8a0), 0, 2.0, 0));
  const hair = part(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a1d15), 0, 2.04, -0.02);
  body.add(hair);
  body.add(part(new THREE.BoxGeometry(0.5, 0.6, 0.25), mat(0x7a5230), 0, 1.4, -0.32));
  const legL = limb(0.26, 0.85, 0.28, mat(0x3a4a6a), -0.17, 0.9), legR = limb(0.26, 0.85, 0.28, mat(0x3a4a6a), 0.17, 0.9);
  const armL = limb(0.2, 0.75, 0.22, shirt, -0.47, 1.78), armR = limb(0.2, 0.75, 0.22, shirt, 0.47, 1.78);
  body.add(legL, legR, armL, armR);
  let nameSprite = null, shownName = "";

  const pos = avatar.position;
  const rig = { mode: "orbit", view: "third", yaw: 0, pitch: 0.62, fpitch: 0, dist: 14, orbit: 0.6 };
  const look = V(0, 3, 0);
  let auto = null, clickTarget = null, phase = 0, moving = 0, hint = null, facing = 0, lastSpeed = 0;

  // 클릭 이동 표시
  const ping = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 }));
  ping.rotation.x = Math.PI / 2;
  scene.add(ping);

  // ── 입력 ──
  const keys = new Set();
  const blocked = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector("dialog[open]");
  window.addEventListener("keydown", (e) => {
    if (blocked(e)) return;
    keys.add(e.code);
    if (rig.mode !== "orbit" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyE" && hint) hooks.interact(hint);
    if (e.code === "KeyV") cycleView();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (rig.mode === "orbit") return;
    rig.yaw -= dx * 0.006;
    if (rig.mode === "first") rig.fpitch = clamp(rig.fpitch - dy * 0.004, -0.9, 0.9);
    else rig.pitch = clamp(rig.pitch + dy * 0.005, 0.1, 1.3);
  });
  canvas.addEventListener("pointerup", (e) => { const d = drag; drag = null; if (d && d.moved < 6 && rig.mode !== "orbit") pick(e); });
  canvas.addEventListener("wheel", (e) => { rig.dist = clamp(rig.dist * (1 + Math.sign(e.deltaY) * 0.08), 4, 26); e.preventDefault(); }, { passive: false });

  const ray = new THREE.Raycaster();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const t = hooks.getTargets();
    const hit = ray.intersectObjects(world.hits, false)[0];
    if (hit) {
      const place = hit.object.userData.place;
      if (place !== t.here && t.reachable.has(place)) { walkTo([world.anchor(place)], () => hooks.interact(place)); return; }
      if (place === t.here && t.awaiting) { walkTo([world.anchor(place)]); return; }
    }
    const g = ray.intersectObject(world.terrain, false)[0];
    if (g && heightAt(g.point.x, g.point.z) > WALK_MIN) { auto = null; clickTarget = g.point.clone(); ping.position.set(g.point.x, g.point.y + 0.15, g.point.z); ping.material.opacity = 1; }
  }

  function cycleView() {
    if (rig.mode === "orbit") return;
    rig.view = VIEWS[(VIEWS.indexOf(rig.view) + 1) % VIEWS.length];
    rig.mode = rig.view;
    hooks.onView?.(rig.view);
  }
  function setMode(mode) {
    rig.mode = mode === "play" ? rig.view : "orbit";
    if (mode === "play") hooks.onView?.(rig.view);
  }
  function setIdentity(name, role) {
    shirt.color.setHex(ROLE_COLOR[role] || 0xd4783a);
    if (name && name !== shownName) {
      shownName = name;
      if (nameSprite) avatar.remove(nameSprite);
      nameSprite = makeLabel(name, "#ffe9b8");
      nameSprite.scale.set(3.4, 1.28, 1);
      nameSprite.position.y = 3.05;
      avatar.add(nameSprite);
    }
  }

  // ── 이동 ──
  function walkTo(points, onDone) { auto = { pts: points.map((p) => p.clone()), i: 0, onDone }; clickTarget = null; }
  function teleportToPlace(place) { const a = world.anchor(place); pos.copy(a); auto = null; clickTarget = null; }
  function walkToPlace(place, from) {
    const dest = world.anchor(place);
    if (Math.hypot(pos.x - dest.x, pos.z - dest.z) < 2.5) { auto = null; return; }
    let pts = null;
    if (from && Math.hypot(pos.x - PLACES[from].x, pos.z - PLACES[from].z) < 10) {
      pts = world.pathPoints(from, place);
      if (pts) { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p.x - pos.x, p.z - pos.z); if (d < bd) { bd = d; bi = i; } }); pts = pts.slice(bi); }
    }
    walkTo(pts && pts.length > 1 ? pts : [dest]);
  }
  function step(dx, dz, free) {
    const nx = pos.x + dx, nz = pos.z + dz;
    if (free || heightAt(nx, nz) > WALK_MIN) { pos.x = nx; pos.z = nz; }
    else if (heightAt(nx, pos.z) > WALK_MIN) pos.x = nx;
    else if (heightAt(pos.x, nz) > WALK_MIN) pos.z = nz;
    pos.x = clamp(pos.x, -56, 56); pos.z = clamp(pos.z, -56, 56);
  }

  function update(dt, t) {
    let dx = 0, dz = 0, speed = 0, free = false;
    if (auto) {
      const tg = auto.pts[auto.i], vx = tg.x - pos.x, vz = tg.z - pos.z, d = Math.hypot(vx, vz);
      if (d < 0.7) { auto.i++; if (auto.i >= auto.pts.length) { const cb = auto.onDone; auto = null; cb && cb(); } }
      else { speed = 9; dx = (vx / d) * speed * dt; dz = (vz / d) * speed * dt; free = true; }
    } else if (clickTarget) {
      const vx = clickTarget.x - pos.x, vz = clickTarget.z - pos.z, d = Math.hypot(vx, vz);
      if (d < 0.5) clickTarget = null;
      else { speed = 6.5; dx = (vx / d) * speed * dt; dz = (vz / d) * speed * dt; }
    } else if (rig.mode !== "orbit") {
      const ix = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      const iz = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      if (keys.has("KeyQ")) rig.yaw += dt * 1.6;
      if (keys.has("KeyR")) rig.yaw -= dt * 1.6;
      if (ix || iz) {
        const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw), rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
        let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix;
        const l = Math.hypot(mx, mz) || 1;
        speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 11 : 6.5;
        dx = (mx / l) * speed * dt; dz = (mz / l) * speed * dt;
        clickTarget = null;
      }
    }
    lastSpeed = speed;
    if (dx || dz) { step(dx, dz, free); facing = angLerp(facing, Math.atan2(dx, dz), clamp(dt * 12, 0, 1)); }
    pos.y += (heightAt(pos.x, pos.z) - pos.y) * clamp(dt * 18, 0, 1);
    avatar.rotation.y = facing;
    moving += ((speed ? 1 : 0) - moving) * clamp(dt * 10, 0, 1);
    phase += dt * (speed > 8 ? 13 : 9) * (speed ? 1 : 0.2);
    const sw = Math.sin(phase) * 0.85 * moving;
    legL.rotation.x = sw; legR.rotation.x = -sw; armL.rotation.x = -sw * 0.9; armR.rotation.x = sw * 0.9;
    body.position.y = Math.abs(Math.cos(phase)) * 0.07 * moving + Math.sin(t * 1.6) * 0.012;
    avatar.visible = rig.mode !== "first";
    ping.material.opacity = Math.max(0, ping.material.opacity - dt * (clickTarget ? 0.3 : 2));
    ping.scale.setScalar(1 + Math.sin(t * 6) * 0.1);

    // 가까이 있는 이동 가능 장소 → 상호작용 안내
    const tg = hooks.getTargets();
    let near = null;
    if (rig.mode !== "orbit" && tg.awaiting) for (const p of tg.reachable) { if (p !== tg.here && Math.hypot(PLACES[p].x - pos.x, PLACES[p].z - pos.z) < 4.6) near = p; }
    if (near !== hint) { hint = near; hooks.onHint?.(near); }
    updateCamera(dt, t);
  }

  // ── 카메라 ──
  const want = V(), wlook = V();
  function updateCamera(dt, t) {
    let k = 1 - Math.exp(-dt * 7);
    if (rig.mode === "third") {
      const cp = Math.cos(rig.pitch);
      want.set(pos.x + Math.sin(rig.yaw) * cp * rig.dist, pos.y + 1.7 + Math.sin(rig.pitch) * rig.dist, pos.z + Math.cos(rig.yaw) * cp * rig.dist);
      wlook.set(pos.x, pos.y + 1.7, pos.z);
    } else if (rig.mode === "top") {
      want.set(pos.x + Math.sin(rig.yaw) * 14, pos.y + 44, pos.z + Math.cos(rig.yaw) * 14);
      wlook.set(pos.x, pos.y, pos.z);
    } else if (rig.mode === "first") {
      const cp = Math.cos(rig.fpitch);
      want.set(pos.x, pos.y + 1.75, pos.z);
      wlook.set(pos.x - Math.sin(rig.yaw) * cp * 10, pos.y + 1.75 + Math.sin(rig.fpitch) * 10, pos.z - Math.cos(rig.yaw) * cp * 10);
      k = 1 - Math.exp(-dt * 30);
    } else {
      rig.orbit += dt * 0.05;
      want.set(Math.cos(rig.orbit) * 72, 30 + Math.sin(rig.orbit * 0.7) * 4, Math.sin(rig.orbit) * 72 + 6);
      wlook.set(0, 15, 4); // 시선을 위로 두어 섬이 화면 아래쪽에 오게 한다
      k = 1 - Math.exp(-dt * 2);
    }
    want.y = Math.max(want.y, heightAt(want.x, want.z) + 1.2);
    camera.position.lerp(want, k);
    look.lerp(wlook, k);
    camera.lookAt(look);
  }

  return { avatar, pos, rig, update, walkToPlace, teleportToPlace, setMode, cycleView, setIdentity, isAuto: () => !!auto, isMoving: () => lastSpeed > 0 || !!auto || !!clickTarget, walkTo };
}
