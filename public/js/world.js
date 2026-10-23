// 3D 월드: 지형·바다·하늘·식생·장소 표식·날씨/낮밤/모닥불/멧돼지 연출.
// 게임 규칙은 전혀 없다 — 서버가 보낸 '상태'를 눈에 보이는 장면으로 바꿔 줄 뿐이다.
import * as THREE from "../vendor/three.module.min.js";

const { Color, Vector3, Group, Mesh } = THREE;

// 장소 좌표(월드 단위). 2D 지도의 배치와 같은 위치 관계를 유지한다.
export const PLACES = {
  beach: { x: 0, z: 25, label: "해변" },
  jungle: { x: 0, z: 0, label: "밀림" },
  reef: { x: 32, z: 17, label: "암초" },
  cave: { x: -29, z: -3, label: "동굴" },
  cliff: { x: 0, z: -24, label: "절벽" },
};
export const LINKS = [["beach", "jungle"], ["beach", "reef"], ["jungle", "reef"], ["jungle", "cave"], ["jungle", "cliff"]];
export const WALK_MIN = -0.35; // 이보다 깊은 물에는 들어갈 수 없다
export const WORLD_R = 52;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));
const noise2 = (x, z) => Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.7) * 0.5 + Math.sin(x * 0.47 + z * 0.31) * 0.25 + Math.sin(x * 0.11 - z * 0.13 + 2) * 0.25;
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 섬의 높이 지도: 타원형 섬 + 가운데 밀림 언덕 + 북쪽 산(절벽) + 서쪽 바위산(동굴) + 동쪽 암초 여울
export function heightAt(x, z) {
  const d = Math.hypot(x / 41, (z - 3) / 35);
  const isl = 1 - smooth(0.6, 1.0, d);
  let h = -3.2 + isl * 4.4 + isl * noise2(x, z) * 0.35;
  h += smooth(26, 4, Math.hypot(x, z)) * 2.4 * isl;
  h += gauss(x, z, 0, -27, 9.5) * 13;
  h += gauss(x, z, -37, -3, 7.5) * 10;
  h += gauss(x, z, 34, 18, 6.5) * 4.2;
  return h;
}
const rockiness = (x, z) => Math.max(smooth(0.08, 0.5, gauss(x, z, 0, -27, 9.5)), smooth(0.1, 0.5, gauss(x, z, -37, -3, 7.5)), smooth(0.1, 0.5, gauss(x, z, 34, 18, 6.5)));

const C = (hex) => new Color(hex);
const SAND = C(0xe9d7a6), WET = C(0xc2aa76), GRASS = C(0x4aa06a), JUNGLE = C(0x24704a), ROCK = C(0x8e949c), SEABED = C(0xbfae86), DEEP = C(0x2a5a6e), FOAM = C(0xffffff);
function terrainColor(x, z, h, out) {
  if (h < 0) out.copy(SEABED).lerp(DEEP, smooth(0, -3.2, h));
  else if (h < 0.7) out.copy(WET).lerp(SAND, smooth(0, 0.7, h));
  else out.copy(SAND).lerp(GRASS, smooth(0.7, 1.5, h)).lerp(JUNGLE, smooth(1.8, 3.6, h) * 0.85);
  out.lerp(ROCK, rockiness(x, z) * 0.92);
  out.lerp(FOAM, 0.5 * (1 - smooth(0, 0.28, Math.abs(h)))); // 해안선의 흰 거품 띠
  out.offsetHSL(0, 0, noise2(x * 3.1, z * 2.7) * 0.03);
}

// 시간대·날씨별 하늘/안개/빛 설정
const ENV_SRC = {
  clear: { top: 0x3f9ccb, bottom: 0xf3f9ef, fog: 0xcfe8ef, fogD: 0.0065, sun: 2.6, sunCol: 0xfff1d0, hemi: 1.0, hemiSky: 0xbfe3ff, hemiGnd: 0x55703d, water: 0x1d8aa0, stars: 0, cloud: 0.35, cloudCol: 0xffffff },
  cloud: { top: 0x5f9db8, bottom: 0xd3e4e8, fog: 0xc3d3d8, fogD: 0.013, sun: 1.2, sunCol: 0xf4ecd8, hemi: 0.95, hemiSky: 0xcfe0e8, hemiGnd: 0x4f6a42, water: 0x2a8296, stars: 0, cloud: 0.85, cloudCol: 0xe8eef0 },
  storm: { top: 0x39414f, bottom: 0x8a95a3, fog: 0x7d8895, fogD: 0.026, sun: 0.5, sunCol: 0xb8c4d6, hemi: 0.6, hemiSky: 0x93a2b4, hemiGnd: 0x3b4a3a, water: 0x2c4a58, stars: 0, cloud: 1.0, cloudCol: 0x59616d },
  night: { top: 0x050b22, bottom: 0x243f6b, fog: 0x0e1b3a, fogD: 0.009, sun: 1.6, sunCol: 0x8fa8ff, hemi: 0.85, hemiSky: 0x3f66b0, hemiGnd: 0x1a2f28, water: 0x0c3350, stars: 1, cloud: 0.18, cloudCol: 0x6f7f9f },
};
const ENV = {};
for (const [k, v] of Object.entries(ENV_SRC)) ENV[k] = { ...v, top: C(v.top), bottom: C(v.bottom), fog: C(v.fog), sunCol: C(v.sunCol), hemiSky: C(v.hemiSky), hemiGnd: C(v.hemiGnd), water: C(v.water), cloudCol: C(v.cloudCol) };
const DIR_DAY = new Vector3(0.5, 0.7, -0.45).normalize();
const DIR_NIGHT = new Vector3(-0.45, 0.6, -0.55).normalize();

function makeLabel(text, color = "#ffffff") {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(5.2, 1.95, 1);
  sprite.renderOrder = 10;
  sprite.userData.set = (t, col = "#ffffff") => {
    const g = c.getContext("2d");
    g.clearRect(0, 0, 256, 96);
    g.font = "bold 46px 'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 9;
    g.strokeStyle = "rgba(8,36,48,.9)";
    g.strokeText(t, 128, 50);
    g.fillStyle = col;
    g.fillText(t, 128, 50);
    tex.needsUpdate = true;
  };
  sprite.userData.set(text, color);
  return sprite;
}
export { makeLabel };

export function createWorld(scene) {
  const rnd = rng(20261014);
  const R = (a, b) => a + (b - a) * rnd();
  const root = new Group();
  scene.add(root);
  const anim = []; // (t, dt, focus) => void
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

  // ── 조명 ──
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x55703d, 1);
  const sun = new THREE.DirectionalLight(0xfff1d0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 1, far: 260 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  root.add(hemi, sun, sun.target);

  // ── 하늘 ──
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new Color(0x3f9ccb) }, bottom: { value: new Color(0xf3f9ef) } },
    vertexShader: ["varying vec3 vP;", "void main() {", "  vP = normalize(position);", "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);", "}"].join("\n"),
    fragmentShader: ["uniform vec3 top;", "uniform vec3 bottom;", "varying vec3 vP;", "void main() {", "  float h = clamp(vP.y * 1.7 + 0.08, 0.0, 1.0);", "  gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0);", "  #include <colorspace_fragment>", "}"].join("\n"),
  });
  const sky = new Mesh(new THREE.SphereGeometry(420, 32, 16), skyMat);
  sky.renderOrder = -10;
  root.add(sky);
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(0.06 + rnd() * 0.94);
    sp.set([400 * Math.sin(ph) * Math.cos(th), 400 * Math.cos(ph), 400 * Math.sin(ph) * Math.sin(th)], i * 3);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  root.add(stars);
  const sunDisc = new Mesh(new THREE.SphereGeometry(16, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffe9a0, fog: false }));
  const moonDisc = new Mesh(new THREE.SphereGeometry(10, 20, 14), new THREE.MeshBasicMaterial({ color: 0xf2f0e0, fog: false }));
  root.add(sunDisc, moonDisc);
  const cloudGroup = new Group();
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false, depthWrite: false });
  for (let i = 0; i < 20; i++) {
    const puff = new Group();
    for (let j = 0; j < 5; j++) {
      const s = new Mesh(new THREE.SphereGeometry(R(5, 9), 10, 8), cloudMat);
      s.position.set(R(-9, 9), R(-1.5, 2.5), R(-5, 5));
      s.scale.y = 0.55;
      puff.add(s);
    }
    const a = rnd() * Math.PI * 2, rr = R(55, 150);
    puff.position.set(Math.cos(a) * rr, R(48, 70), Math.sin(a) * rr);
    cloudGroup.add(puff);
  }
  root.add(cloudGroup);

  // ── 지형 ──
  const SEG = 170, SIZE = 130;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position;
  const tcol = new Float32Array(tp.count * 3);
  const tmp = new Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i), h = heightAt(x, z);
    tp.setY(i, h);
    terrainColor(x, z, h, tmp);
    tcol.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  tg.setAttribute("color", new THREE.BufferAttribute(tcol, 3));
  tg.computeVertexNormals();
  const terrain = new Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }));
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  root.add(terrain);

  // ── 바다 (밀물·썰물에 따라 수위가 변한다) ──
  const wg = new THREE.PlaneGeometry(440, 440, 130, 130);
  wg.rotateX(-Math.PI / 2);
  const wp = wg.attributes.position;
  const wBase = Float32Array.from(wp.array);
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x1d8aa0, transparent: true, opacity: 0.8, shininess: 90, specular: 0x9fd8e8, depthWrite: false });
  const water = new Mesh(wg, waterMat);
  water.renderOrder = 1;
  root.add(water);
  const farWater = new Mesh(new THREE.RingGeometry(216, 1800, 48, 1).rotateX(-Math.PI / 2), waterMat); // 수평선까지 이어지는 바다
  farWater.renderOrder = 1;
  root.add(farWater);
  let waterLevel = 0, waterTarget = 0, frame = 0;

  // ── 길: 장소 사이를 잇는 흙길 ──
  const pathPts = {};
  const allPath = [];
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xb08a55, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const [a, b] of LINKS) {
    const A = PLACES[a], B = PLACES[b];
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz), bend = (rnd() - 0.5) * 6;
    const mid = new Vector3((A.x + B.x) / 2 + (-dz / len) * bend, 0, (A.z + B.z) / 2 + (dx / len) * bend);
    const curve = new THREE.CatmullRomCurve3([new Vector3(A.x, 0, A.z), mid, new Vector3(B.x, 0, B.z)]);
    const pts = curve.getPoints(48).map((p) => new Vector3(p.x, heightAt(p.x, p.z), p.z));
    pathPts[`${a}>${b}`] = pts;
    pathPts[`${b}>${a}`] = pts.slice().reverse();
    allPath.push(...pts);
    const pos = [], idx = [];
    pts.forEach((p, i) => {
      const q = pts[Math.min(i + 1, pts.length - 1)], r = pts[Math.max(i - 1, 0)];
      const tx = q.x - r.x, tz = q.z - r.z, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
      for (const s of [-1, 1]) {
        const px = p.x + nx * 1.15 * s, pz = p.z + nz * 1.15 * s;
        pos.push(px, heightAt(px, pz) + 0.07, pz);
      }
      if (i < pts.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new Mesh(g, pathMat);
    m.receiveShadow = true;
    root.add(m);
  }
  const nearAnchor = (x, z, r) => Object.values(PLACES).some((p) => Math.hypot(p.x - x, p.z - z) < r);
  const nearPath = (x, z, r) => allPath.some((p) => Math.hypot(p.x - x, p.z - z) < r);

  // ── 발자국: 밀림에서 동굴 입구까지 흙길 위에 찍혀 이어진다 ──
  {
    const pts = pathPts["jungle>cave"];
    if (pts && pts.length > 1) {
      const gp = [], gi = [];
      const blob = (cx, cz, rx, rz, seg = 12) => {
        const base = gp.length / 3;
        gp.push(cx, 0, cz);
        for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; gp.push(cx + Math.cos(a) * rx, 0, cz + Math.sin(a) * rz); }
        for (let i = 0; i < seg; i++) gi.push(base, base + 1 + i, base + 1 + ((i + 1) % seg));
      };
      blob(0, 0.12, 0.17, 0.18);      // 앞발바닥
      blob(0.02, -0.04, 0.1, 0.16);   // 아치
      blob(0, -0.22, 0.12, 0.13);     // 뒤꿈치
      [[-0.12, 0.3], [-0.06, 0.35], [0, 0.37], [0.06, 0.35], [0.11, 0.31]].forEach(([x, z], i) => blob(x, z, i === 0 ? 0.055 : 0.048, i === 0 ? 0.055 : 0.048, 8)); // 발가락 다섯
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.Float32BufferAttribute(gp, 3));
      fg.setIndex(gi);
      fg.computeVertexNormals();
      const fm = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
      // 길이를 따라 일정 간격으로 왼발·오른발이 번갈아 찍힌다
      const seg = [0];
      for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      const total = seg[seg.length - 1], step = 1.0, prints = [], fpr = rng(777); // 나무 배치의 난수열을 건드리지 않도록 별도 난수
      for (let d = 4.5, n = 0; d < total - 4.5; d += step, n++) {
        let k = 1;
        while (k < seg.length - 1 && seg[k] < d) k++;
        const t = (d - seg[k - 1]) / Math.max(1e-6, seg[k] - seg[k - 1]);
        const x = lerp(pts[k - 1].x, pts[k].x, t), z = lerp(pts[k - 1].z, pts[k].z, t);
        const tx = pts[k].x - pts[k - 1].x, tz = pts[k].z - pts[k - 1].z, tl = Math.hypot(tx, tz) || 1;
        const side = n % 2 ? 1 : -1;
        prints.push({ x: x + (-tz / tl) * 0.34 * side, z: z + (tx / tl) * 0.34 * side, yaw: Math.atan2(tx, tz) + (fpr() - 0.5) * 0.25, side });
      }
      const feet = new THREE.InstancedMesh(fg, fm, prints.length);
      const dummy = new THREE.Object3D();
      prints.forEach((f, i) => {
        dummy.position.set(f.x, heightAt(f.x, f.z) + 0.12, f.z);
        dummy.rotation.set(0, f.yaw, 0);
        dummy.scale.set(1.1 * f.side, 1.1, 1.1);
        dummy.updateMatrix();
        feet.setMatrixAt(i, dummy.matrix);
      });
      feet.instanceMatrix.needsUpdate = true;
      feet.renderOrder = 2;
      root.add(feet);
    }
  }
  const dummy = new THREE.Object3D();
  const scatter = (n, test, tries = 4000) => {
    const out = [];
    for (let t = 0; t < tries && out.length < n; t++) {
      const x = R(-48, 48), z = R(-48, 48), h = heightAt(x, z);
      if (test(x, z, h)) out.push([x, z, h]);
    }
    return out;
  };

  // ── 야자수 (해변) ──
  const barkMat = std(0x7b5a3a), frondMat = std(0x3fa070, { side: THREE.DoubleSide });
  const trunkGeo = new THREE.CylinderGeometry(0.17, 0.3, 4.4, 7);
  const frondGeo = new THREE.BoxGeometry(2.7, 0.04, 0.6).translate(1.35, 0, 0);
  const palmCrowns = [];
  scatter(15, (x, z, h) => z > 15 && h > 0.55 && h < 1.5 && !nearAnchor(x, z, 5) && !nearPath(x, z, 2.5)).forEach(([x, z, h], i) => {
    const g = new Group();
    g.position.set(x, h, z);
    g.rotation.y = R(0, 6.28);
    const trunk = new Mesh(trunkGeo, barkMat);
    trunk.position.set(0.15, 2.2, 0);
    trunk.rotation.z = -0.1;
    trunk.castShadow = true;
    g.add(trunk);
    const crown = new Group();
    crown.position.set(0.4, 4.35, 0);
    for (let k = 0; k < 8; k++) {
      const f = new Mesh(frondGeo, frondMat);
      f.rotation.set(0, (k / 8) * Math.PI * 2, -0.38);
      f.castShadow = true;
      crown.add(f);
    }
    for (let k = 0; k < 3; k++) {
      const nut = new Mesh(new THREE.SphereGeometry(0.2, 8, 6), std(0x5b3a1e));
      nut.position.set(R(-0.25, 0.25), -0.25, R(-0.25, 0.25));
      crown.add(nut);
    }
    g.add(crown);
    root.add(g);
    palmCrowns.push({ crown, phase: i * 1.7 });
  });
  anim.push((t) => palmCrowns.forEach(({ crown, phase }) => { crown.rotation.z = Math.sin(t * 0.9 + phase) * 0.05; crown.rotation.x = Math.cos(t * 0.7 + phase) * 0.04; }));

  // ── 밀림 나무 (InstancedMesh로 한 번에 그린다) ──
  const spots = scatter(150, (x, z, h) => h > 1.8 && h < 7 && rockiness(x, z) < 0.25 && !nearAnchor(x, z, 5.5) && !nearPath(x, z, 2.2));
  const canopyData = [];
  const trunkI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.4, 1, 6).translate(0, 0.5, 0), barkMat, spots.length);
  const canopyI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), std(0xffffff, { flatShading: true }), spots.length * 2);
  const leafCols = [0x2c7c52, 0x23704a, 0x38905c, 0x2a6e44].map(C);
  spots.forEach(([x, z, h], i) => {
    const th = R(3, 6.5), r = R(1.9, 3);
    dummy.position.set(x, h - 0.1, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, th, 1); dummy.updateMatrix();
    trunkI.setMatrixAt(i, dummy.matrix);
    for (let j = 0; j < 2; j++) {
      dummy.position.set(x + (j ? R(-0.8, 0.8) : 0), h + th * (j ? 0.78 : 1) + r * 0.3, z + (j ? R(-0.8, 0.8) : 0));
      dummy.scale.set(r * (j ? 0.8 : 1), r * 0.85, r * (j ? 0.8 : 1));
      dummy.updateMatrix();
      canopyI.setMatrixAt(i * 2 + j, dummy.matrix);
      canopyData.push({ i: i * 2 + j, x: dummy.position.x, y: dummy.position.y, z: dummy.position.z, sx: dummy.scale.x, sy: dummy.scale.y, sz: dummy.scale.z, k: 1 });
      canopyI.setColorAt(i * 2 + j, leafCols[(i + j) % 4]);
    }
  });
  [trunkI, canopyI].forEach((m) => { m.castShadow = true; m.receiveShadow = true; root.add(m); });

  // ── 바위 ──
  const rockSpots = [
    ...scatter(34, (x, z, h) => Math.hypot(x - 34, z - 18) < 11 && h > -1.4 && !nearAnchor(x, z, 2.6)),
    ...scatter(24, (x, z, h) => Math.hypot(x, z + 27) < 13 && h > 1 && !nearPath(x, z, 1.8) && !nearAnchor(x, z, 3)),
    ...scatter(26, (x, z, h) => Math.hypot(x + 36, z + 3) < 10 && h > 1 && !nearPath(x, z, 2) && !nearAnchor(x, z, 3.5)),
  ];
  const rockI = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std(0xffffff, { flatShading: true }), rockSpots.length);
  rockSpots.forEach(([x, z, h], i) => {
    const s = R(0.6, 2.1);
    dummy.position.set(x, h + s * 0.25, z); dummy.rotation.set(R(0, 3), R(0, 3), R(0, 3)); dummy.scale.set(s * R(0.9, 1.4), s * R(0.6, 1), s * R(0.9, 1.4)); dummy.updateMatrix();
    rockI.setMatrixAt(i, dummy.matrix);
    rockI.setColorAt(i, C(i % 3 ? 0x8a9098 : 0x6d737b));
  });
  rockI.castShadow = true; rockI.receiveShadow = true;
  root.add(rockI);

  // ── 산호 (암초의 얕은 물속) ──
  const coralCols = [0xff7a8a, 0xff9a4a, 0xb58af0, 0xf0c04a];
  scatter(30, (x, z, h) => Math.hypot(x - 33, z - 18) < 13 && h > -1.5 && h < -0.15).forEach(([x, z, h], i) => {
    const m = new Mesh(new THREE.ConeGeometry(R(0.2, 0.45), R(0.7, 1.4), 6), std(coralCols[i % 4], { emissive: coralCols[i % 4], emissiveIntensity: 0.15 }));
    m.position.set(x, h + 0.4, z);
    root.add(m);
  });

  // ── 대나무 숲 ──
  const bambooMat = std(0x9bbb4a);
  scatter(34, (x, z, h) => Math.hypot(x + 12, z - 7) < 6 && h > 1.6 && !nearPath(x, z, 1.5) && !nearAnchor(x, z, 3.5)).forEach(([x, z, h]) => {
    const hh = R(5, 8);
    const m = new Mesh(new THREE.CylinderGeometry(0.1, 0.13, hh, 6), bambooMat);
    m.position.set(x, h + hh / 2 - 0.1, z);
    m.rotation.set(R(-0.06, 0.06), 0, R(-0.06, 0.06));
    m.castShadow = true;
    root.add(m);
  });

  // ── 난파선 잔해 (해변) ──
  const wreck = new Group();
  { const wy = heightAt(-9.5, 27.5);
    wreck.position.set(-9.5, wy, 27.5); wreck.rotation.y = 0.6;
    const wood = std(0x6b4a2b), woodD = std(0x4a321c);
    const hull = new Mesh(new THREE.BoxGeometry(5.8, 1.1, 2.3), wood); hull.position.y = 0.5; hull.rotation.z = 0.12; wreck.add(hull);
    for (let i = 0; i < 6; i++) { const rib = new Mesh(new THREE.BoxGeometry(0.2, 1.8, 0.2), woodD); rib.position.set(-2.4 + i * 0.95, 1.3, i % 2 ? 1.05 : -1.05); rib.rotation.z = R(-0.2, 0.2); wreck.add(rib); }
    const mast = new Mesh(new THREE.CylinderGeometry(0.1, 0.16, 5.4, 6), woodD); mast.position.set(0.4, 3.1, 0); mast.rotation.z = 0.35; wreck.add(mast);
    const sail = new Mesh(new THREE.PlaneGeometry(2.4, 3.2), std(0xe9e2cf, { side: THREE.DoubleSide })); sail.position.set(1.6, 3.6, 0); sail.rotation.z = 0.35; wreck.add(sail);
    for (let i = 0; i < 2; i++) { const barrel = new Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.95, 10), std(0x8a5a2b)); barrel.position.set(3.3 + i * 0.9, 0.3, 1.4 - i * 0.4); barrel.rotation.z = i ? 1.4 : 0; wreck.add(barrel); }
    const crate = new Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), wood); crate.position.set(-3.6, 0.3, 1.5); crate.rotation.y = 0.5; wreck.add(crate);
    wreck.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(wreck);
    anim.push((t) => { sail.rotation.y = Math.sin(t * 1.6) * 0.12; }); }

  // ── 제작한 뗏목: 해변에 영구 배치되며, 출항 실패로 손상되면 파손 표시가 나타난다 ──
  const raftModel = new Group();
  raftModel.name = "raft-model";
  const raftWood = std(0x8b6338), raftWoodLight = std(0xa77a49), raftWoodDark = std(0x50351f);
  const raftRope = std(0xb49a67), raftSailMat = std(0xe8dfc8, { side: THREE.DoubleSide, roughness: 0.98 });
  // 길이 방향으로 놓인 통나무와 판자를 엮어 만든 널빤지 뗏목
  for (let i = -2; i <= 2; i++) {
    const plank = new Mesh(new THREE.BoxGeometry(0.48, 0.18, 4.25), i % 2 ? raftWood : raftWoodLight);
    plank.position.set(i * 0.49, 0.27 + (i % 2 ? 0.015 : 0), 0);
    plank.rotation.y = (i % 2 ? -1 : 1) * 0.012;
    plank.castShadow = true; plank.receiveShadow = true; raftModel.add(plank);
  }
  // 아래쪽 가로대 두 개
  for (const z of [-1.25, 1.25]) {
    const beam = new Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.15, 8), raftWoodDark);
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0, 0.15, z);
    beam.castShadow = true; raftModel.add(beam);
  }
  // 갑판 위를 가로지르는 고정 밧줄
  for (const z of [-1.4, 1.4]) {
    const binding = new Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.65, 6), raftRope);
    binding.rotation.z = Math.PI / 2;
    binding.position.set(0, 0.39, z);
    binding.castShadow = true; raftModel.add(binding);
  }
  // 돛대와 삼각 돛
  const raftMast = new Mesh(new THREE.CylinderGeometry(0.075, 0.11, 3.3, 8), raftWoodDark);
  raftMast.position.set(-0.12, 1.9, -0.12);
  raftMast.rotation.z = -0.025;
  raftMast.castShadow = true; raftModel.add(raftMast);
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0.08); sailShape.lineTo(1.52, 0.25); sailShape.lineTo(0.08, 2.85); sailShape.closePath();
  const raftSail = new Mesh(new THREE.ShapeGeometry(sailShape), raftSailMat);
  raftSail.position.set(-0.04, 0.52, -0.16);
  raftSail.castShadow = true; raftSail.receiveShadow = true; raftModel.add(raftSail);
  // 돛의 아래쪽 가로 지지대와 선미 노
  const boom = new Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.65, 6), raftWoodDark);
  boom.rotation.z = Math.PI / 2; boom.position.set(0.66, 0.62, -0.12); raftModel.add(boom);
  const paddle = new Mesh(new THREE.BoxGeometry(0.17, 0.09, 2.5), raftWoodLight);
  paddle.position.set(1.9, 0.48, 0.95); paddle.rotation.y = 0.18; raftModel.add(paddle);
  // 파손 상태일 때 드러나는 느슨한 판자와 찢어진 돛 흔적
  const raftDamageMarks = new Group();
  raftDamageMarks.name = "raft-damage-marks";
  const loosePlank = new Mesh(new THREE.BoxGeometry(0.42, 0.14, 1.9), raftWoodDark);
  loosePlank.position.set(0.88, 0.48, 0.15); loosePlank.rotation.y = 0.28; loosePlank.rotation.x = 0.09;
  loosePlank.castShadow = true; raftDamageMarks.add(loosePlank);
  const tear = new Mesh(new THREE.BoxGeometry(0.045, 1.55, 0.035), raftWoodDark);
  tear.position.set(0.31, 1.55, 0.02); tear.rotation.z = -0.42; raftDamageMarks.add(tear);
  raftDamageMarks.visible = false;
  raftModel.add(raftDamageMarks);
  raftModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const raftSite = { x: 4.0, z: 27.1 };
  raftModel.position.set(raftSite.x, heightAt(raftSite.x, raftSite.z), raftSite.z);
  raftModel.rotation.y = -0.18;
  raftModel.visible = false;
  root.add(raftModel);

  // ── 발견한 구명보트: 암초의 해안에 계속 남으며, 노 소지 여부에 따라 노만 표시한다 ──
  const lifeboatModel = new Group();
  lifeboatModel.name = "lifeboat-found-model";
  const lifeboatTubeMat = std(0xf06a32, { roughness: 0.72 });
  const lifeboatTrimMat = std(0xc64c25, { roughness: 0.82 });
  const lifeboatFloorMat = std(0x3e484b, { roughness: 0.96 });
  const lifeboatSeatMat = std(0xb8a27d, { roughness: 0.95 });
  // 어두운 바닥과 양쪽 주황색 부력 튜브
  const lifeboatFloor = new Mesh(new THREE.BoxGeometry(1.55, 0.18, 3.72), lifeboatFloorMat);
  lifeboatFloor.position.set(0, 0.27, 0.02);
  lifeboatModel.add(lifeboatFloor);
  for (const side of [-1, 1]) {
    const tube = new Mesh(new THREE.CylinderGeometry(0.34, 0.36, 4.05, 12), lifeboatTubeMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(side * 0.82, 0.49, 0);
    lifeboatModel.add(tube);
    for (const end of [-1, 1]) {
      const cap = new Mesh(new THREE.SphereGeometry(0.35, 12, 8), lifeboatTubeMat);
      cap.position.set(side * 0.82, 0.49, end * 2.0);
      cap.scale.set(1, 0.94, 1.12);
      lifeboatModel.add(cap);
    }
    // 부력 튜브의 보강 밴드
    for (const z of [-1.35, -0.45, 0.45, 1.35]) {
      const band = new Mesh(new THREE.TorusGeometry(0.345, 0.035, 6, 12), lifeboatTrimMat);
      band.rotation.x = Math.PI / 2;
      band.position.set(side * 0.82, 0.49, z);
      lifeboatModel.add(band);
    }
  }
  // 앞뒤 끝을 묶는 부력 튜브와 좌석
  for (const z of [-1.82, 1.82]) {
    const endTube = new Mesh(new THREE.SphereGeometry(0.31, 12, 8), lifeboatTubeMat);
    endTube.position.set(0, 0.48, z);
    endTube.scale.set(2.25, 0.88, 1.0);
    lifeboatModel.add(endTube);
  }
  for (const z of [-0.83, 0.62]) {
    const seat = new Mesh(new THREE.BoxGeometry(1.25, 0.13, 0.25), lifeboatSeatMat);
    seat.position.set(0, 0.67, z);
    lifeboatModel.add(seat);
  }
  const stern = new Mesh(new THREE.BoxGeometry(1.38, 0.48, 0.16), lifeboatFloorMat);
  stern.position.set(0, 0.45, 1.78);
  lifeboatModel.add(stern);

  // 노는 별도 그룹으로 관리한다. 구명보트는 발견했지만 소지품에 '노'가 없으면 이 그룹은 숨겨진다.
  const lifeboatOars = new Group();
  lifeboatOars.name = "lifeboat-oars";
  const oarShaftMat = std(0x8a6339, { roughness: 0.92 });
  const oarBladeMat = std(0xa77a49, { roughness: 0.9 });
  for (const z of [-0.62, 0.72]) {
    const shaft = new Mesh(new THREE.CylinderGeometry(0.045, 0.055, 3.15, 8), oarShaftMat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(0, 0.98, z);
    lifeboatOars.add(shaft);
    for (const side of [-1, 1]) {
      const blade = new Mesh(new THREE.BoxGeometry(0.28, 0.055, 0.58), oarBladeMat);
      blade.position.set(side * 1.52, 0.98, z);
      blade.rotation.y = side * -0.12;
      lifeboatOars.add(blade);
    }
  }
  lifeboatModel.add(lifeboatOars);
  lifeboatModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // 암초 진입 지점 가까운 평탄한 해안에 배치한다. 이전 위치는 지형 경사가 커서 선체가 땅에 묻히고 화면 가장자리에서 잘릴 수 있었다.
  // 새 위치는 전체 선체와 노가 해안 위에 드러나도록 하며, 발견·저장·이동 후에도 같은 자리에 유지한다.
  const lifeboatSite = { x: 30.0, z: 16.0 };
  lifeboatModel.position.set(lifeboatSite.x, heightAt(lifeboatSite.x, lifeboatSite.z), lifeboatSite.z);
  lifeboatModel.rotation.y = Math.PI / 2;
  lifeboatModel.visible = false;
  lifeboatOars.visible = false;
  root.add(lifeboatModel);

  // ── 동굴 입구 (서쪽 바위산) ──
  const caveG = new Group();
  { const cx = -32.5, cz = -3, cy = heightAt(cx, cz);
    caveG.position.set(cx, cy, cz); caveG.rotation.y = Math.PI / 2; // 입구가 동쪽(+x)을 향한다
    const rockM = std(0x6e747c, { flatShading: true });
    const arch = new Mesh(new THREE.TorusGeometry(2.3, 0.75, 8, 20, Math.PI), rockM); arch.position.y = 2.6; caveG.add(arch);
    for (const s of [-1, 1]) { const p = new Mesh(new THREE.BoxGeometry(1.4, 3.2, 1.8), rockM); p.position.set(2.3 * s, 1.3, 0); caveG.add(p); }
    const dark = new Mesh(new THREE.CircleGeometry(2.3, 24), new THREE.MeshBasicMaterial({ color: 0x05050a })); dark.position.set(0, 2.5, -0.5); caveG.add(dark);
    const base = new Mesh(new THREE.PlaneGeometry(4.6, 3), new THREE.MeshBasicMaterial({ color: 0x05050a })); base.position.set(0, 1.0, -0.5); caveG.add(base);
    for (let i = 0; i < 5; i++) { const st = new Mesh(new THREE.ConeGeometry(0.2, R(0.6, 1.2), 5), rockM); st.position.set(-1.6 + i * 0.8, 4.2, 0.1); st.rotation.x = Math.PI; caveG.add(st); }
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x6ee7f9, emissive: 0x39c8e0, emissiveIntensity: 1.1, roughness: 0.2 });
    for (let i = 0; i < 6; i++) { const cr = new Mesh(new THREE.ConeGeometry(0.22, R(0.7, 1.4), 5), crystalMat); cr.position.set(R(-1.7, 1.7), 0.5, R(-0.3, 0.2)); cr.rotation.z = R(-0.4, 0.4); caveG.add(cr); }
    const cl = new THREE.PointLight(0x6ee7f9, 2.2, 14); cl.position.set(0, 1.4, 0.6); caveG.add(cl);
    caveG.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    root.add(caveG);
    anim.push((t) => { cl.intensity = 1.8 + Math.sin(t * 2.2) * 0.5; crystalMat.emissiveIntensity = 0.9 + Math.sin(t * 2.2) * 0.3; }); }

  // ── 절벽 꼭대기: 깃발과 먼 바다의 배 ──
  { const fy = heightAt(1.5, -26);
    const pole = new Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 6), std(0x5a4129)); pole.position.set(1.5, fy + 2.5, -26); root.add(pole);
    const flag = new Mesh(new THREE.PlaneGeometry(1.8, 1.1, 8, 1).translate(0.9, 0, 0), std(0xd4783a, { side: THREE.DoubleSide })); flag.position.set(1.5, fy + 4.4, -26); root.add(flag);
    const fp = flag.geometry.attributes.position, fb = Float32Array.from(fp.array);
    anim.push((t) => { for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.sin(fb[i * 3] * 2.4 - t * 4) * 0.18 * (fb[i * 3] / 1.8)); fp.needsUpdate = true; }); }
  const ship = new Group();
  { ship.add(new Mesh(new THREE.BoxGeometry(5, 1, 1.6), std(0x2a3a4a)));
    const m = new Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 5), std(0x333)); m.position.y = 2.4; ship.add(m);
    const s = new Mesh(new THREE.PlaneGeometry(2.4, 3), std(0xf3efe6, { side: THREE.DoubleSide })); s.position.set(0, 2.6, 0); ship.add(s);
    ship.position.set(-80, 0.3, -30); root.add(ship);
    anim.push((t) => { ship.position.x = -80 + ((t * 0.8) % 160); ship.position.y = 0.3 + Math.sin(t) * 0.12; }); }

  // ── 장소 표식(빛기둥 + 링 + 이름표) ──
  const markers = {}, hits = [];
  const ringGeo = new THREE.TorusGeometry(2.3, 0.14, 8, 48);
  for (const [key, P] of Object.entries(PLACES)) {
    const g = new Group();
    g.position.set(P.x, heightAt(P.x, P.z) + 0.1, P.z);
    const ring = new Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    const pillar = new Mesh(new THREE.CylinderGeometry(2, 2, 11, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa95a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    pillar.position.y = 5.5;
    const label = makeLabel(P.label);
    label.position.y = 7.4;
    const hit = new Mesh(new THREE.CylinderGeometry(3.4, 3.4, 12, 12), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.y = 6;
    hit.userData.place = key;
    g.add(ring, pillar, label, hit);
    root.add(g);
    markers[key] = { g, ring, pillar, label, state: { found: true, here: false, go: false }, shown: "" };
    hits.push(hit);
  }
  anim.push((t) => {
    for (const m of Object.values(markers)) {
      const { go, here, found } = m.state;
      const pulse = 1 + Math.sin(t * 4) * 0.08;
      m.ring.scale.setScalar(go ? pulse * 1.08 : 1);
      m.ring.material.opacity = go ? 0.75 + Math.sin(t * 4) * 0.2 : here ? 0.7 : found ? 0.3 : 0.18;
      m.pillar.material.opacity = lerp(m.pillar.material.opacity, go ? 0.2 + Math.sin(t * 4) * 0.05 : here ? 0.07 : 0, 0.12);
      m.label.position.y = 7.4 + (go ? Math.sin(t * 3) * 0.25 : 0);
    }
  });

  // ── 새·게·반딧불·비 ──
  const gulls = [];
  for (let i = 0; i < 6; i++) {
    const g = new Group();
    const wing = new THREE.BoxGeometry(1.1, 0.04, 0.34).translate(0.55, 0, 0);
    const wl = new Mesh(wing, std(0xf4f4f4)), wr = new Mesh(wing, std(0xf4f4f4));
    wr.rotation.y = Math.PI;
    g.add(wl, wr, new Mesh(new THREE.SphereGeometry(0.2, 6, 5), std(0xffffff)));
    root.add(g);
    gulls.push({ g, wl, wr, r: R(26, 48), a: R(0, 6.28), s: R(0.12, 0.22) * (i % 2 ? 1 : -1), h: R(15, 24) });
  }
  const crabs = [];
  for (let i = 0; i < 4; i++) {
    const g = new Group();
    const body = new Mesh(new THREE.SphereGeometry(0.28, 8, 6), std(0xe0624a)); body.scale.set(1.3, 0.55, 1);
    g.add(body);
    for (const s of [-1, 1]) { const claw = new Mesh(new THREE.SphereGeometry(0.1, 6, 5), std(0xe0624a)); claw.position.set(0.32 * s, 0.1, 0.25); g.add(claw); const eye = new Mesh(new THREE.SphereGeometry(0.05, 5, 4), std(0x111111)); eye.position.set(0.1 * s, 0.2, 0.2); g.add(eye); }
    const x = R(-14, 14), z = R(22, 28);
    g.position.set(x, heightAt(x, z) + 0.15, z);
    root.add(g);
    crabs.push({ g, dir: R(0, 6.28), timer: 0 });
  }
  const ffN = 80, ffGeo = new THREE.BufferGeometry(), ffPos = new Float32Array(ffN * 3), ffBase = [];
  for (let i = 0; i < ffN; i++) { const a = R(0, 6.28), r = R(2, 24), x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9 - 4; ffBase.push([x, heightAt(x, z) + R(0.8, 4), z, R(0, 6.28)]); }
  ffGeo.setAttribute("position", new THREE.BufferAttribute(ffPos, 3));
  const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ color: 0xd8ff7a, size: 0.35, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  fireflies.frustumCulled = false;
  root.add(fireflies);
  const RAIN = 1800, rainGeo = new THREE.BufferGeometry(), rainPos = new Float32Array(RAIN * 6), rainOff = [];
  for (let i = 0; i < RAIN; i++) rainOff.push([R(-38, 38), R(0, 32), R(-38, 38)]);
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xcfe3ea, transparent: true, opacity: 0, depthWrite: false }));
  rain.frustumCulled = false;
  root.add(rain);

  // ── 모닥불 ──
  const fire = new Group();
  const flameMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [new Mesh(new THREE.ConeGeometry(0.55, 1.7, 8), flameMat(0xff7a1a)), new Mesh(new THREE.ConeGeometry(0.38, 1.3, 8), flameMat(0xffb347)), new Mesh(new THREE.ConeGeometry(0.2, 0.9, 8), flameMat(0xffe99a))];
  flames.forEach((f, i) => { f.position.y = 0.85 - i * 0.1; fire.add(f); });
  for (let i = 0; i < 6; i++) { const log = new Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.5, 6), std(0x5a3a1e)); log.position.y = 0.2; log.rotation.set(Math.PI / 2 - 0.3, (i / 6) * Math.PI * 2, 0); log.rotateX(0); fire.add(log); }
  for (let i = 0; i < 9; i++) { const st = new Mesh(new THREE.SphereGeometry(0.2, 6, 5), std(0x777b80)); const a = (i / 9) * Math.PI * 2; st.position.set(Math.cos(a) * 1.05, 0.12, Math.sin(a) * 1.05); fire.add(st); }
  const fireLight = new THREE.PointLight(0xff8a2a, 0, 22);
  fireLight.position.y = 1.6;
  fireLight.castShadow = false;
  fire.add(fireLight);
  const emN = 24, emGeo = new THREE.BufferGeometry(), emPos = new Float32Array(emN * 3), emSeed = Array.from({ length: emN }, () => [R(0, 3), R(-0.5, 0.5), R(-0.5, 0.5)]);
  emGeo.setAttribute("position", new THREE.BufferAttribute(emPos, 3));
  const embers = new THREE.Points(emGeo, new THREE.PointsMaterial({ color: 0xffd45c, size: 0.18, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  embers.frustumCulled = false;
  fire.add(embers);
  fire.visible = false;
  root.add(fire);
  let fireOn = false;

  // ── 은신처: 나뭇가지 골조에 풀잎을 엮은 원시 A형 텐트. 장소별로 유지된다. ──
  const shelter = new Group();
  const shelterBranch = std(0x604329, { roughness: 1.0 });
  const shelterBranchLight = std(0x80603b, { roughness: 1.0 });
  const shelterTwig = std(0x98774d, { roughness: 1.0 });
  const shelterFiber = std(0xc1a66d, { roughness: 1.0 });
  const leafDark = std(0x355d2e, { side: THREE.DoubleSide, roughness: 1.0 });
  const leafGreen = std(0x4f7738, { side: THREE.DoubleSide, roughness: 1.0 });
  const leafLight = std(0x71934a, { side: THREE.DoubleSide, roughness: 1.0 });
  const leafUnder = std(0x294a27, { side: THREE.DoubleSide, roughness: 1.0 });
  const shelterGround = std(0x51402b, { roughness: 1.0 });
  const shelterLeafMats = [leafDark, leafGreen, leafLight, leafGreen, leafUnder];

  // 원점 기준 모델: 각 장소의 지형 높이에 맞춰 복제·배치한다.
  const addShelterBeam = (a, b, radius, material, sides = 7) => {
    const p1 = new Vector3(...a), p2 = new Vector3(...b);
    const delta = p2.clone().sub(p1);
    const beam = new Mesh(new THREE.CylinderGeometry(radius * 0.82, radius, delta.length(), sides), material);
    beam.position.copy(p1).add(p2).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.clone().normalize());
    beam.castShadow = true;
    beam.receiveShadow = true;
    shelter.add(beam);
    return beam;
  };
  const shelterCord = (a, b, radius = 0.018, material = shelterFiber) =>
    addShelterBeam(a, b, radius, material, 5);

  const halfW = 1.28, halfL = 1.42, peakY = 1.72, edgeY = 0.12;
  // 굵은 능선가지와 앞뒤로 반복되는 A형 지지대
  shelterCord([0, peakY, -halfL - 0.08], [0, peakY, halfL + 0.08], 0.085, shelterBranch);
  const frameZ = [-1.34, -0.72, 0, 0.72, 1.34];
  for (const z of frameZ) {
    addShelterBeam([0, peakY, z], [-halfW, edgeY, z], z === 0 ? 0.072 : 0.058, shelterBranch);
    addShelterBeam([0, peakY, z], [halfW, edgeY, z], z === 0 ? 0.072 : 0.058, shelterBranchLight);
  }
  // 지붕 양쪽 가장자리와 중간 가로대. 덩굴로 여러 지점을 묶은 느낌을 준다.
  for (const side of [-1, 1]) {
    shelterCord([side * halfW, edgeY + 0.025, -halfL], [side * halfW, edgeY + 0.025, halfL], 0.055, shelterBranch);
    shelterCord([side * 0.66, 0.91, -halfL * 0.92], [side * 0.66, 0.91, halfL * 0.92], 0.043, shelterBranchLight);
    for (const z of [-1.34, -0.72, 0, 0.72, 1.34]) {
      // 지지대 교차점의 섬유 매듭
      const knot = new Mesh(new THREE.SphereGeometry(0.07, 6, 5), shelterFiber);
      knot.position.set(side * Math.max(0.035, Math.abs(z) * 0.015), peakY - 0.015, z);
      knot.scale.set(1, 0.75, 1.15);
      knot.castShadow = true;
      shelter.add(knot);
    }
  }
  // 풀잎을 겹겹이 엮는다. 잎 패널은 경사면 위에 놓인 길쭉한 잎사귀 형태다.
  const roofPoint = (side, t, z) => [side * halfW * t, peakY * (1 - t) + edgeY * t, z];
  const addGrassFrond = (side, t0, t1, zCenter, halfWidth, material, ribMaterial) => {
    const span = t1 - t0;
    const pts = [
      roofPoint(side, t0, zCenter),
      roofPoint(side, t0 + span * 0.17, zCenter - halfWidth * 0.62),
      roofPoint(side, t0 + span * 0.52, zCenter - halfWidth),
      roofPoint(side, t0 + span * 0.82, zCenter - halfWidth * 0.68),
      roofPoint(side, t1, zCenter + halfWidth * 0.025),
      roofPoint(side, t0 + span * 0.82, zCenter + halfWidth * 0.68),
      roofPoint(side, t0 + span * 0.52, zCenter + halfWidth),
      roofPoint(side, t0 + span * 0.17, zCenter + halfWidth * 0.62),
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    geo.setIndex([0,1,2, 0,2,3, 0,3,4, 0,4,5, 0,5,6, 0,6,7]);
    geo.computeVertexNormals();
    const frond = new Mesh(geo, material);
    frond.castShadow = true;
    frond.receiveShadow = true;
    shelter.add(frond);
    // 잎 중앙의 굵은 주맥
    const midStart = roofPoint(side, t0 + 0.025, zCenter);
    const midEnd = roofPoint(side, Math.min(0.99, t1 - 0.025), zCenter + 0.01);
    shelterCord(midStart, midEnd, 0.012, ribMaterial);
  };
  for (const side of [-1, 1]) {
    // 아래쪽 잎을 먼저 깔고, 위쪽 잎을 겹쳐 비를 막는 초가지붕처럼 구성
    for (let row = 0; row < 2; row++) {
      const t0 = row === 0 ? 0.30 : 0.035;
      const t1 = row === 0 ? 0.995 : 0.73;
      const spacing = 0.37;
      for (let i = 0; i < 8; i++) {
        const z = -1.28 + i * spacing + (row ? 0.12 : 0);
        addGrassFrond(side, t0, t1, z, 0.245, shelterLeafMats[(i + row * 2) % shelterLeafMats.length], shelterTwig);
      }
    }
    // 외곽 가장자리에는 늘어진 잎과 가는 가지를 보태 야생 재료의 질감을 강조
    for (let i = 0; i < 6; i++) {
      const z = -1.22 + i * 0.48;
      addGrassFrond(side, 0.62, 0.995, z + 0.04, 0.18, i % 2 ? leafDark : leafGreen, shelterFiber);
    }
  }
  // 바닥은 가느다란 가지와 낙엽을 엮어 만든 깔개
  const floorBase = new Mesh(new THREE.BoxGeometry(1.72, 0.07, 2.45), shelterGround);
  floorBase.position.set(0, 0.06, 0);
  floorBase.receiveShadow = true;
  shelter.add(floorBase);
  for (let i = 0; i < 11; i++) {
    const x = -0.78 + i * 0.156;
    shelterCord([x, 0.105, -1.18], [x + R(-0.025, 0.025), 0.105, 1.18], 0.025, i % 3 ? shelterTwig : shelterBranchLight);
  }
  // 네 모서리의 나무 말뚝과 덩굴 고정줄
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const anchorX = sx * 1.62, anchorZ = sz * 1.67;
      shelterCord([sx * 0.82, 0.54, sz * 1.02], [anchorX, 0.07, anchorZ], 0.018, shelterFiber);
      const stake = new Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.32, 6), shelterBranch);
      stake.position.set(anchorX, 0.16, anchorZ);
      stake.rotation.z = -sx * 0.23;
      stake.rotation.x = sz * 0.12;
      stake.castShadow = true;
      shelter.add(stake);
    }
  }
  // 입구는 앞쪽을 완전히 막지 않아 몸을 숙여 드나들 수 있다.
  const entranceLintel = shelterCord([-0.5, 0.12, halfL * 0.88], [0.5, 0.12, halfL * 0.88], 0.035, shelterTwig);
  entranceLintel.visible = true;

  // 보강 1단계: 추가 지지대와 가로대를 덧대 바람에 흔들리지 않게 한다.
  const shelterUpgrade1 = new Group();
  shelterUpgrade1.name = "shelterUpgrade1";
  shelterUpgrade1.visible = false;
  const addUpgradeBeam = (parent, a, b, radius, material, sides = 7) => {
    const p1 = new Vector3(...a), p2 = new Vector3(...b);
    const delta = p2.clone().sub(p1);
    const beam = new Mesh(new THREE.CylinderGeometry(radius * 0.82, radius, delta.length(), sides), material);
    beam.position.copy(p1).add(p2).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.clone().normalize());
    beam.castShadow = true; beam.receiveShadow = true;
    parent.add(beam);
    return beam;
  };
  for (const side of [-1, 1]) {
    for (const z of [-0.95, 0.95]) {
      addUpgradeBeam(shelterUpgrade1, [side * 1.02, 0.16, z], [side * 0.34, 1.42, z], 0.052, shelterBranchLight);
    }
    addUpgradeBeam(shelterUpgrade1, [side * 0.92, 0.48, -1.18], [side * 0.92, 0.48, 1.18], 0.038, shelterTwig);
  }
  addUpgradeBeam(shelterUpgrade1, [-0.55, 1.12, 0], [0.55, 1.12, 0], 0.034, shelterFiber, 5);
  shelter.add(shelterUpgrade1);

  // 보강 2단계: 바닥에 마른 잎 침상을 덧대고 옆면 바람막이를 보강한다.
  const shelterUpgrade2 = new Group();
  shelterUpgrade2.name = "shelterUpgrade2";
  shelterUpgrade2.visible = false;
  const bedBase = new Mesh(new THREE.BoxGeometry(1.08, 0.11, 1.55), shelterBranch);
  bedBase.position.set(0, 0.18, -0.02);
  bedBase.castShadow = true; bedBase.receiveShadow = true;
  shelterUpgrade2.add(bedBase);
  const dryLeafBed = new Mesh(new THREE.BoxGeometry(0.98, 0.075, 1.44), leafLight);
  dryLeafBed.position.set(0, 0.27, -0.02);
  dryLeafBed.castShadow = true; dryLeafBed.receiveShadow = true;
  shelterUpgrade2.add(dryLeafBed);
  for (let i = 0; i < 7; i++) {
    const tuft = new Mesh(new THREE.BoxGeometry(0.055, 0.025, 1.28), i % 2 ? leafGreen : leafLight);
    tuft.position.set(-0.42 + i * 0.14, 0.32 + (i % 2) * 0.006, -0.02);
    tuft.rotation.y = (i % 3 - 1) * 0.025;
    shelterUpgrade2.add(tuft);
  }
  for (const side of [-1, 1]) {
    const windbreak = new Mesh(new THREE.BoxGeometry(0.035, 0.42, 1.85), leafDark);
    windbreak.position.set(side * 0.88, 0.43, 0);
    windbreak.rotation.z = side * -0.10;
    windbreak.castShadow = true; windbreak.receiveShadow = true;
    shelterUpgrade2.add(windbreak);
  }
  shelter.add(shelterUpgrade2);

  shelter.position.set(0, 0, 0);
  shelter.visible = false;
  shelter.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const shelterModels = {};
  const shelterSites = {
    beach: { x: -5.2, z: 24.0 },
    jungle: { x: 4.2, z: 1.6 },
    reef: { x: 26.4, z: 13.6 },
    cave: { x: -25.2, z: 0.5 },
    cliff: { x: 5.2, z: -21.2 },
  };
  for (const [place, site] of Object.entries(shelterSites)) {
    const model = shelter.clone(true);
    model.position.set(site.x, heightAt(site.x, site.z), site.z);
    model.visible = false;
    shelterModels[place] = model;
    root.add(model);
  }

  // ── 멧돼지 (조우 연출: 돌진 → 대치 → 도주) ──
  const boar = new Group();
  const bm = std(0x3a261a), legs = [];
  { const body = new Mesh(new THREE.SphereGeometry(1, 12, 10), bm); body.scale.set(1.0, 0.8, 1.55); body.position.y = 1.1; boar.add(body);
    const hump = new Mesh(new THREE.SphereGeometry(0.7, 10, 8), std(0x2c1c12)); hump.position.set(0, 1.65, 0.4); boar.add(hump);
    const head = new Mesh(new THREE.SphereGeometry(0.6, 10, 8), bm); head.position.set(0, 1.0, -1.55); boar.add(head);
    const snout = new Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.6, 8), std(0x6b4a3a)); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.9, -2.05); boar.add(snout);
    for (const s of [-1, 1]) {
      const tusk = new Mesh(new THREE.ConeGeometry(0.07, 0.6, 6), std(0xf3efe6)); tusk.position.set(0.3 * s, 0.75, -2.0); tusk.rotation.set(-0.5, 0, 0.5 * s); boar.add(tusk);
      const ear = new Mesh(new THREE.ConeGeometry(0.16, 0.4, 5), bm); ear.position.set(0.38 * s, 1.55, -1.4); boar.add(ear);
      const eye = new Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4a2a })); eye.position.set(0.3 * s, 1.15, -1.95); boar.add(eye);
    }
    for (const [lx, lz] of [[-0.5, -0.9], [0.5, -0.9], [-0.5, 0.8], [0.5, 0.8]]) {
      const lg = new Group(); lg.position.set(lx, 0.8, lz);
      const leg = new Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.9, 6), bm); leg.position.y = -0.45; lg.add(leg); boar.add(lg); legs.push(lg);
    }
    boar.traverse((o) => { if (o.isMesh) o.castShadow = true; }); }
  boar.visible = false;
  root.add(boar);
  const boarSt = { mode: "idle", t: 0, from: new Vector3(), to: new Vector3() };
  const dust = [];
  for (let i = 0; i < 8; i++) { const d = new Mesh(new THREE.SphereGeometry(0.5, 6, 5), new THREE.MeshBasicMaterial({ color: 0xd9c7a3, transparent: true, opacity: 0, depthWrite: false })); boar.add(d); dust.push(d); }

  // ── 환경(낮/밤/날씨/물때) ──
  const cur = { top: new Color(), bottom: new Color(), fog: new Color(), sunCol: new Color(), hemiSky: new Color(), hemiGnd: new Color(), water: new Color(), cloudCol: new Color(), fogD: 0.0065, sun: 2.6, hemi: 1, stars: 0, cloud: 0.35, dir: DIR_DAY.clone() };
  Object.keys(ENV.clear).forEach((k) => { if (cur[k] instanceof Color) cur[k].copy(ENV.clear[k]); });
  let tgt = ENV.clear, tgtDir = DIR_DAY, night = false, weather = "clear", flash = 0, nextBolt = 6;
  function setEnv(isNight, w, lowTide) {
    night = !!isNight; weather = w || "clear";
    tgt = ENV[night ? "night" : weather] || ENV.clear;
    tgtDir = night ? DIR_NIGHT : DIR_DAY;
    waterTarget = lowTide === false ? 0.55 : 0;
  }
  function applyEnv(dt, focus) {
    const k = 1 - Math.exp(-dt * 1.7);
    for (const key of ["top", "bottom", "fog", "sunCol", "hemiSky", "hemiGnd", "water", "cloudCol"]) cur[key].lerp(tgt[key], k);
    for (const key of ["fogD", "sun", "hemi", "stars", "cloud"]) cur[key] = lerp(cur[key], tgt[key] + (key === "fogD" && night && weather === "storm" ? 0.008 : 0), k);
    cur.dir.lerp(tgtDir, k).normalize();
    skyMat.uniforms.top.value.copy(cur.top);
    skyMat.uniforms.bottom.value.copy(cur.bottom);
    scene.fog.color.copy(cur.fog);
    scene.fog.density = cur.fogD;
    hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGnd); hemi.intensity = cur.hemi;
    sun.color.copy(cur.sunCol); sun.intensity = cur.sun + flash * 8;
    sun.position.copy(focus).addScaledVector(cur.dir, 100); sun.target.position.copy(focus); sun.target.updateMatrixWorld();
    sunDisc.position.copy(focus).addScaledVector(cur.dir, 330); moonDisc.position.copy(focus).addScaledVector(cur.dir, 330);
    sunDisc.visible = !night && weather !== "storm"; moonDisc.visible = night;
    stars.material.opacity = cur.stars; stars.position.copy(focus);
    waterMat.color.copy(cur.water);
    cloudMat.opacity = clamp(cur.cloud, 0, 1) * 0.9; cloudMat.color.copy(cur.cloudCol);
    if (weather === "storm") { nextBolt -= dt; if (nextBolt < 0) { flash = 1; nextBolt = 3 + Math.random() * 6; } }
    flash = Math.max(0, flash - dt * 3.2);
    skyMat.uniforms.top.value.lerp(new Color(0xdfe8ff), flash * 0.6);
  }

  function setMarker(place, st) {
    const m = markers[place];
    if (!m) return;
    Object.assign(m.state, st);
    const key = `${m.state.found}|${m.state.here}|${m.state.go}`;
    if (key === m.shown) return;
    m.shown = key;
    const col = m.state.go ? 0xffa95a : m.state.here ? 0x6fe3a1 : 0xd8e4ea;
    m.ring.material.color.setHex(m.state.found ? col : 0x8d99a3);
    m.pillar.material.color.setHex(m.state.go ? 0xffa95a : 0x6fe3a1);
    m.label.userData.set(m.state.found ? PLACES[place].label : "???", m.state.go ? "#ffd9a0" : "#ffffff");
  }
  function setFire(on, place) {
    fireOn = on;
    fire.visible = on;
    if (on) {
      const P = PLACES[place] || PLACES.beach;
      const x = P.x + 2.6, z = P.z - 1.8;
      fire.position.set(x, heightAt(x, z), z);
    }
  }
  function setShelters(places = [], upgrades = {}) {
    const active = new Set(Array.isArray(places) ? places : []);
    for (const [place, model] of Object.entries(shelterModels)) {
      const isBuilt = active.has(place);
      const tier = Math.max(0, Math.min(2, Number(upgrades?.[place]) || 0));
      model.visible = isBuilt;
      const frame = model.getObjectByName("shelterUpgrade1");
      const bed = model.getObjectByName("shelterUpgrade2");
      if (frame) frame.visible = isBuilt && tier >= 1;
      if (bed) bed.visible = isBuilt && tier >= 2;
    }
  }
  function setShelter(on, place = "jungle") {
    setShelters(on ? [place] : []);
  }
  function setRaft(built, damaged = false) {
    raftModel.visible = !!built;
    raftDamageMarks.visible = !!built && !!damaged;
    // 출항 실패 후 파손 플래그가 해제되면 원래의 완성된 뗏목 모습으로 복귀한다.
    raftSail.rotation.z = damaged ? -0.055 : 0;
  }
  function setLifeboat(found, hasOars = false) {
    lifeboatModel.visible = !!found;
    // '노'를 소지품에서 잃어버리면 다음 상태 갱신에서 즉시 3D 노도 숨긴다.
    lifeboatOars.visible = !!found && !!hasOars;
  }
  function setBoar(on, focus, cam) {
    if (on && boarSt.mode === "idle") {
      // 카메라 맞은편(화면 안쪽)에서 플레이어 쪽으로 돌진해 오게 한다
      const a = cam ? Math.atan2(focus.z - cam.z, focus.x - cam.x) + (Math.random() - 0.5) * 1.0 : Math.random() * Math.PI * 2;
      let sx = focus.x + Math.cos(a) * 26, sz = focus.z + Math.sin(a) * 26;
      for (let i = 0; i < 12 && heightAt(sx, sz) < 0.3; i++) { sx = lerp(sx, focus.x, 0.15); sz = lerp(sz, focus.z, 0.15); }
      boarSt.from.set(sx, heightAt(sx, sz), sz);
      boarSt.to.set(focus.x + Math.cos(a) * 3.6, 0, focus.z + Math.sin(a) * 3.6);
      boarSt.to.y = heightAt(boarSt.to.x, boarSt.to.z);
      boarSt.mode = "charge"; boarSt.t = 0; boar.visible = true;
    } else if (!on && (boarSt.mode === "charge" || boarSt.mode === "stand")) {
      boarSt.mode = "flee"; boarSt.t = 0; boarSt.from.copy(boar.position);
      boarSt.to.set(boar.position.x + (boar.position.x - focus.x) * 8, 0, boar.position.z + (boar.position.z - focus.z) * 8);
    }
  }

  const AB = new Vector3(), tgtPt = new Vector3();
  function fadeCanopy(cam, focus, dt) {
    tgtPt.set(focus.x, focus.y + 1.6, focus.z);
    AB.subVectors(tgtPt, cam);
    const L2 = AB.lengthSq() || 1;
    let dirty = false;
    for (const c of canopyData) {
      const u = clamp(((c.x - cam.x) * AB.x + (c.y - cam.y) * AB.y + (c.z - cam.z) * AB.z) / L2, 0, 1);
      const d = Math.hypot(c.x - (cam.x + AB.x * u), c.y - (cam.y + AB.y * u), c.z - (cam.z + AB.z * u));
      const block = u > 0.02 && u < 0.97 && d < c.sx + 1.7;
      const nk = lerp(c.k, block ? 0 : 1, 1 - Math.exp(-dt * 9));
      if (Math.abs(nk - c.k) > 0.004) {
        c.k = nk;
        dummy.position.set(c.x, c.y, c.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(c.sx * nk, c.sy * nk, c.sz * nk); dummy.updateMatrix();
        canopyI.setMatrixAt(c.i, dummy.matrix);
        dirty = true;
      }
    }
    if (dirty) canopyI.instanceMatrix.needsUpdate = true;
  }

  function update(t, dt, focus, camPos) {
    applyEnv(dt, focus);
    fadeCanopy(camPos, focus, dt);
    // 바다: 파도 + 수위
    waterLevel = lerp(waterLevel, waterTarget, 1 - Math.exp(-dt * 0.8));
    farWater.position.y = waterLevel - 0.03;
    for (let i = 0; i < wp.count; i++) {
      const x = wBase[i * 3], z = wBase[i * 3 + 2];
      wp.setY(i, waterLevel + Math.sin(x * 0.3 + t * 1.4) * 0.09 + Math.cos(z * 0.26 + t * 1.1) * 0.08 + Math.sin((x + z) * 0.15 + t * 0.7) * 0.06);
    }
    wp.needsUpdate = true;
    if (++frame % 3 === 0) wg.computeVertexNormals();
    cloudGroup.rotation.y += dt * 0.004;
    for (const f of anim) f(t, dt, focus);
    // 갈매기
    const birdsOn = !night && weather !== "storm";
    gulls.forEach((b) => {
      b.g.visible = birdsOn; if (!birdsOn) return;
      b.a += b.s * dt;
      b.g.position.set(Math.cos(b.a) * b.r, b.h + Math.sin(t * 0.7 + b.r) * 1.2, Math.sin(b.a) * b.r * 0.8);
      b.g.rotation.y = -b.a + (b.s > 0 ? 0 : Math.PI) + Math.PI / 2;
      const flap = Math.sin(t * 7 + b.r) * 0.5;
      b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
    });
    // 게
    crabs.forEach((c) => {
      c.g.visible = !night; if (night) return;
      c.timer -= dt;
      if (c.timer < 0) { c.dir = Math.random() * 6.28; c.timer = 1 + Math.random() * 2.5; }
      const nx = c.g.position.x + Math.cos(c.dir) * dt * 1.1, nz = c.g.position.z + Math.sin(c.dir) * dt * 1.1, h = heightAt(nx, nz);
      if (h > 0.25 && h < 1.5 && nz > 18) { c.g.position.set(nx, h + 0.15, nz); c.g.rotation.y = -c.dir + Math.PI / 2; } else c.dir += 2.4;
    });
    // 반딧불
    fireflies.material.opacity = lerp(fireflies.material.opacity, night ? 0.95 : 0, 0.05);
    ffBase.forEach(([x, y, z, ph], i) => ffPos.set([x + Math.sin(t * 0.6 + ph) * 1.4, y + Math.sin(t * 0.9 + ph * 2) * 0.6, z + Math.cos(t * 0.5 + ph) * 1.4], i * 3));
    ffGeo.attributes.position.needsUpdate = true;
    // 비
    const rainOn = weather === "storm";
    rain.material.opacity = lerp(rain.material.opacity, rainOn ? 0.5 : 0, 0.08);
    if (rain.material.opacity > 0.02) {
      for (let i = 0; i < RAIN; i++) {
        const o = rainOff[i];
        o[1] -= 30 * dt; if (o[1] < 0) o[1] += 32;
        const x = focus.x + o[0], y = focus.y + o[1] - 3, z = focus.z + o[2];
        rainPos.set([x, y, z, x - 0.12, y + 0.9, z - 0.05], i * 6);
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    // 모닥불
    if (fireOn) {
      flames.forEach((f, i) => { f.scale.set(1 + Math.sin(t * 9 + i) * 0.1, 1 + Math.sin(t * 13 + i * 2) * 0.16, 1 + Math.cos(t * 11 + i) * 0.1); f.rotation.y = t * 2 + i; });
      fireLight.intensity = (night ? 7 : 3.4) + Math.sin(t * 17) * 0.8 + Math.sin(t * 7.3) * 0.6;
      emSeed.forEach(([ph, ox, oz], i) => { const u = ((t * 0.7 + ph) % 3) / 3; emPos.set([ox + Math.sin(t + ph) * 0.3 * u, 0.9 + u * 3.2, oz + Math.cos(t + ph) * 0.3 * u], i * 3); });
      emGeo.attributes.position.needsUpdate = true;
    }
    // 멧돼지
    if (boarSt.mode !== "idle") {
      boarSt.t += dt;
      const run = (dur, ease) => { const u = clamp(boarSt.t / dur, 0, 1), e = ease ? u * u * (3 - 2 * u) : u; boar.position.lerpVectors(boarSt.from, boarSt.to, e); boar.position.y = heightAt(boar.position.x, boar.position.z); return u; };
      // 멧돼지의 머리는 모델의 -Z 쪽에 있다. target을 향해 -Z가 가리키도록 회전한다(예전엔 +π가 붙어 등을 돌리고 있었다).
      const face = (target) => { boar.rotation.y = Math.atan2(boar.position.x - target.x, boar.position.z - target.z); };
      if (boarSt.mode === "charge") { const u = run(1.5, false); face(focus); legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 22 + i * 1.6) * 0.8)); if (u >= 1) { boarSt.mode = "stand"; boarSt.t = 0; } }
      else if (boarSt.mode === "stand") { face(focus); boar.position.y = heightAt(boar.position.x, boar.position.z) + Math.abs(Math.sin(t * 7)) * 0.08; legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 6 + i) * 0.12)); }
      else if (boarSt.mode === "flee") { const u = run(1.3, true); face(boarSt.to); legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 24 + i * 1.6) * 0.8)); if (u >= 1) { boarSt.mode = "idle"; boar.visible = false; } }
      dust.forEach((d, i) => { const u = ((t * 1.4 + i / 8) % 1); d.position.set(Math.sin(i * 2.1) * 0.9, 0.3 + u * 1.2, 1.4 + u * 1.5); d.scale.setScalar(0.4 + u); d.material.opacity = boarSt.mode === "idle" ? 0 : (1 - u) * 0.35; });
    }
  }

  const anchor = (p) => new Vector3(PLACES[p].x, heightAt(PLACES[p].x, PLACES[p].z), PLACES[p].z);
  return { root, sun, terrain, hits, markers, update, snapEnv: (focus) => applyEnv(10, focus), setEnv, setMarker, setFire, setShelter, setShelters, setRaft, setLifeboat, setBoar, anchor, pathPoints: (a, b) => pathPts[`${a}>${b}`] || null, heightAt, boarState: boarSt };
}
