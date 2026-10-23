"use strict";

// 게임 로직 전체(서버 전용). 이 파일은 public/ 에 없으며 클라이언트로 전송되지 않는다.
module.exports = function createGame(emit, store) {
  const SLOT_COUNT = 3;

  const WEATHER_LABEL = { clear: "맑음", cloud: "흐림", storm: "폭풍" };
  const ENDINGS = {
    lifeboat: {
      title: "세레니티호의 구명보트",
      body:
        "누수 난 선체를 막고, 잃어버린 노를 되찾고, 암초 밖 해류를 확인한 끝에 구명보트를 바다로 밀어 넣는다.\n파도가 보트를 흔들고 암초가 선체 밑을 스치지만, 이번에는 준비한 장비와 판단이 당신을 지켜 준다.\n섬은 점점 작아지고, 세레니티호의 마지막 흔적은 마침내 바다 너머로 이어진다.",
    },
    rescue: {
      title: "구조",
      body:
        "연기를 보고 다가온 배가 당신을 발견했다.\n거친 손을 잡은 선원의 얼굴이, 세상에서 가장 반갑다.\n당신은 살아남았다.",
    },
    rescue_heli: {
      title: "굉음 속의 구조",
      body:
        "밤하늘을 가르는 굉음과 함께 탐조등이 섬을 훑는다.\n헬리콥터의 프로펠러 바람이 모래를 흩날린다.\n당신은 손을 흔들며, 마침내 하늘을 향해 웃는다.",
    },
    rescue_plane: {
      title: "날개 짓",
      body:
        "거울에 반사된 빛이 하늘을 찌른다.\n작은 비행기가 날개를 기우뚱, 당신을 보았다는 신호를 보낸다.\n몇 시간 뒤, 수평선에 구조선의 그림자가 떠오른다.",
    },
    rescue_late: {
      title: "늦은 구조",
      body:
        "열흘이 넘는 기다림 끝에, 멀리서 배가 나타났다.\n몸은 만신창이지만, 숨은 붙어 있다.\n집으로 가는 길이 열린다.",
    },
    raft_escape: {
      title: "자력 탈출",
      body:
        "대나무와 판자, 돛천으로 엮은 뗏목이 파도 위에 뜬다.\n떨리는 손으로 돛을 올리고, 섬을 등진다.\n수평선 너머, 당신은 스스로 길을 찾아냈다.",
    },
    survivor: {
      title: "섬의 주민",
      body:
        "구조는 오지 않았다. 대신 당신은 섬의 리듬을 배웠다.\n은신처, 물, 불. 이제 이곳이 집이다.\n…언젠가 배가 오겠지. 그때까지, 살아간다.",
    },
    fade: {
      title: "사라짐",
      body:
        "날이 갈수록 몸이 가벼워진다.\n바람과 파도 소리만 남고, 발자국은 모래에 지워진다.",
    },
    death_hp: {
      title: "탈진",
      body:
        "더 이상 일어설 힘이 없다.\n하늘이 하얗게 번진다. 갈매기 소리가 멀어진다.",
    },
    death_sanity: {
      title: "미아",
      body:
        "목소리가 머릿속에서 울린다.\n밀림 속으로 걸어 들어간 당신은, 다시는 해변에 나타나지 않았다.",
    },
  };

  // 생존 난이도별 최종 판정일. 목표일 시작 시점에 판정한다.
  const FINAL_SURVIVAL_DAY = Object.freeze({ easy: 16, normal: 14, hard: 12 });

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
  const MAP_LINKS = [
    ["beach", "jungle"],
    ["beach", "reef"],
    ["jungle", "reef"],
    ["jungle", "cave"],
    ["jungle", "cliff"],
  ];

  // 주인공의 과거 — 선택에 따라 시작 아이템과 성향이 달라진다
  const ROLES = [
    {
      id: "explorer",
      name: "탐험가",
      choiceLabel: "탐험가 — 낯선 땅에서도 길을 잃지 않는다",
    },
    {
      id: "sailor",
      name: "선원",
      choiceLabel: "선원 — 거친 바다와 매듭에 익숙하다",
    },
    {
      id: "medic",
      name: "의사",
      choiceLabel: "의사 — 상처를 돌보고 위험을 가려낼 줄 안다 · 잔해에서 성냥을 잘 찾는다",
    },
    {
      id: "fisher",
      name: "어부",
      choiceLabel: "어부 — 창을 들고 시작, 물고기를 더 많이 잡고 복통에 걸리지 않는다",
      unlock: ["rescue", "rescue_heli", "rescue_plane", "rescue_late"],
      hint: "구조 엔딩을 한 번 보면 열린다",
    },
    {
      id: "pilot",
      name: "조종사",
      choiceLabel: "조종사 — 신호거울을 들고 시작, 항공 신호와 구조 확률이 높다",
      unlock: ["rescue_plane", "rescue_heli"],
      hint: "비행기·헬리콥터 구조 엔딩을 보면 열린다",
    },
    {
      id: "navigator",
      name: "항해사",
      choiceLabel: "항해사 — 밧줄·나침반 보유, 뗏목 성공률↑, 구명보트 단서가 빨리 나온다",
      unlock: ["lifeboat", "raft_escape"],
      hint: "뗏목 탈출 또는 구명보트 엔딩을 보면 열린다",
    },
    {
      id: "survivalist",
      name: "생존 전문가",
      choiceLabel: "생존 전문가 — 성냥·칼 보유, 허기와 갈증이 느리게 준다",
      unlock: ["survivor"],
      hint: "‘섬의 주민’ 엔딩을 보면 열린다",
    },
  ];

  // 섬 어딘가에 흩어진, 먼저 표류했던 누군가의 일기
  const JOURNAL_ENTRIES = [
    "“나는 ‘세레니티호’의 항해사였다. 폭풍 속에서 배가 갈라지던 순간을 아직도 기억한다. 이 섬에 발이 묶인 지 벌써 여러 날이다.”",
    "“동굴 깊은 곳에 마실 물이 있다는 걸 알아냈다. 다만 길이 험하니 불빛 없이는 들어가지 않는 게 좋겠다.”",
    "“절벽 위에 오르면 섬 전체가 내려다보인다. 그곳에서 떠밀려온 물건을 찾으면, 언젠가 뗏목을 만들 수 있을지도 모른다.”",
    "“밤마다 두 손을 모은다. 믿음이 있어서가 아니라, 그래야 마음이 흔들리지 않기 때문이다.”",
    "“이 섬에는 나 말고도 누군가 있었던 흔적이 있다. 꺼진 불씨, 쌓아 둔 돌무더기… 그리고 이 일기장.”",
    "“언젠가 비행기가 섬 위를 지나가는 걸 봤다. 거울 같은 게 있었다면, 빛으로 신호를 보낼 수 있었을 텐데.”",
    "“여기, 이 페이지가 마지막이다. 이 글을 읽는 사람이 있다면 — 포기하지 마라. 길은 분명히 있다.”",
  ];

  // —— DOM ——
  let state = null;
  let choiceResolver = null;
  let pendingInventoryItem = null;
  let runId = 0;
  let lastTide = null;
  let pendingTravel = null;
  let travelOK = false;
  let lastBanner = null;
  let boarScene = false;

  // —— 실시간 소모 ——
  // 낮 동안 시간이 흐르면 포만·수분·정신·체력이 아주 조금씩 줄어든다. (행동으로 쓰는 소모와 별개)
  // 체력·정신은 시간만으로는 1 아래로 떨어지지 않는다 — 가만히 있다가 죽지는 않는다.
  const LIVE_TICK_MS = 1000;
  const LIVE_RATE_SEC = { hunger: 60, thirst: 45, sanity: 120, hp: 180 }; // 읽고 선택하는 시간을 고려해 완만하게 감소
  let liveDrain = false;
  const liveAcc = { hunger: 0, thirst: 0, sanity: 0, hp: 0 };
  const liveTimer = setInterval(() => {
    if (!liveDrain || !state || !state.alive || state.phase !== "day") return;
    const f = drainFactor();
    let changed = false;
    for (const k of Object.keys(LIVE_RATE_SEC)) {
      liveAcc[k] += (LIVE_TICK_MS / 1000) * f;
      if (liveAcc[k] < LIVE_RATE_SEC[k]) continue;
      liveAcc[k] -= LIVE_RATE_SEC[k];
      const floor = k === "hunger" || k === "thirst" ? 0 : 1;
      if (state[k] > floor) {
        state[k] -= 1;
        changed = true;
      }
    }
    if (changed) updateHud();
  }, LIVE_TICK_MS);
  if (liveTimer.unref) liveTimer.unref();

  function stopRun() {
    runId += 1;
    liveDrain = false;
    pendingInventoryItem = null;
    if (choiceResolver) {
      const r = choiceResolver;
      choiceResolver = null;
      clearChoices();
      r(-1);
    }
  }

  function isActive(id) {
    return id === runId;
  }

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function freshState(diff = "normal") {
    // 난이도별 시작 체력·정신력: 최고치에서 시작하지 않고, 포만·수분처럼
    // 중간 수준에서 출발하도록 범위를 부여한다. 직업 특성은 applyRole에서 별도 보정한다.
    const startingRanges = {
      easy:   { hp: [72, 82], sanity: [65, 75] },
      normal: { hp: [60, 70], sanity: [50, 60] },
      hard:   { hp: [45, 55], sanity: [40, 50] },
    };
    const start = startingRanges[diff] || startingRanges.normal;
    return {
      day: 1,
      hp: randInt(start.hp[0], start.hp[1]),
      // 포만감(hunger)·수분(thirst)은 숫자가 높을수록 좋은 상태다.
      // 표류 직후의 몸 상태는 사람마다 달라, 매 판마다 조금씩 다르게 시작한다.
      hunger: randInt(50, 75),
      thirst: randInt(45, 70),
      sanity: randInt(start.sanity[0], start.sanity[1]),
      inventory: ["생존 수첩"],
      flags: [],
      alive: true,
      ending: null,
      place: "beach",
      phase: "day", // day | night
      role: null,
      actionPoints: 0,
      journalPage: 0,
      shownHints: [],
      diff: ["easy", "normal", "hard"].includes(diff) ? diff : "normal",
      weather: "clear",
      status: {},
      playerName: "표류자",
      bonus: 0,
      crises: 0,
      searchTries: 0,
    };
  }

  function hasFlag(name) {
    return state.flags.includes(name);
  }

  function addFlag(name) {
    if (!hasFlag(name)) state.flags.push(name);
  }

  function removeFlag(name) {
    state.flags = (state.flags || []).filter((x) => x !== name);
  }

  const SHELTER_PLACE_PREFIX = "은신처위치:";
  const SHELTER_PREP_PREFIX = "은신처준비위치:";
  const SHELTER_UPGRADE_PREFIX = "은신처보강단계:";
  function migrateShelterFlags() {
    const flags = state.flags || [];
    if (hasFlag("은신처") && !flags.some((x) => x.startsWith(SHELTER_PLACE_PREFIX))) {
      addFlag(`${SHELTER_PLACE_PREFIX}jungle`); // 이전 저장 파일의 완성된 움막은 기존 위치인 밀림으로 이전
    }
    // 예전 저장 파일은 준비 상태를 장소와 무관한 전역 플래그로 저장했다.
    // 해당 플래그가 남아 있으면 다른 장소에서도 '은신처를 완성한다'가 뜰 수 있으므로
    // 위치별 준비 플래그로 한 번 이전한 뒤 전역 플래그는 반드시 제거한다.
    const hasLegacyPrep = hasFlag("은신처준비");
    const hasPlacePrep = flags.some((x) => x.startsWith(SHELTER_PREP_PREFIX));
    if (hasLegacyPrep) {
      if (!hasPlacePrep) addFlag(`${SHELTER_PREP_PREFIX}jungle`);
      removeFlag("은신처준비");
    }
  }
  function shelterPlaces() {
    migrateShelterFlags();
    return [...new Set((state.flags || []).filter((x) => x.startsWith(SHELTER_PLACE_PREFIX)).map((x) => x.slice(SHELTER_PLACE_PREFIX.length)))];
  }
  function hasShelterAt(place = state.place) {
    return shelterPlaces().includes(place);
  }
  function shelterPrepAt(place = state.place) {
    migrateShelterFlags();
    return hasFlag(`${SHELTER_PREP_PREFIX}${place}`);
  }
  function shelterUpgradeLevel(place = state.place) {
    if (hasFlag(`${SHELTER_UPGRADE_PREFIX}${place}:2`)) return 2;
    if (hasFlag(`${SHELTER_UPGRADE_PREFIX}${place}:1`)) return 1;
    return 0;
  }
  function shelterUpgradeLevels() {
    return Object.fromEntries(shelterPlaces().map((place) => [place, shelterUpgradeLevel(place)]));
  }
  function shelterActionLabel(place = state.place) {
    if (hasShelterAt(place)) return shelterUpgradeLevel(place) >= 2 ? "은신처를 손질한다" : "은신처를 보강한다";
    if (shelterPrepAt(place)) return "은신처를 완성한다";
    return "나뭇가지와 잎으로 은신처를 짓는다";
  }
  async function buildShelterAtCurrentPlace() {
    const place = state.place;
    const label = PLACE_LABEL[place] || "이곳";
    if (hasShelterAt(place)) {
      const level = shelterUpgradeLevel(place);
      if (level === 0) {
        addFlag(`${SHELTER_UPGRADE_PREFIX}${place}:1`);
        await typeLine(`${label}의 은신처에 굵은 나뭇가지를 덧대 지지대를 단단히 묶고, 풀잎 지붕의 빈틈을 촘촘히 메웠다. 바람과 비를 더 잘 견딜 수 있을 것 같다.`, "find");
        state.hp += 3;
        state.sanity += 2;
        bonusNote(4, "은신처 지붕 보강");
      } else if (level === 1) {
        addFlag(`${SHELTER_UPGRADE_PREFIX}${place}:2`);
        await typeLine(`${label}의 은신처 바닥에 마른 잎을 두껍게 깔고 옆면의 틈을 막았다. 이제 잠자리가 한결 따뜻하고 편안해졌다.`, "find");
        state.hp += 3;
        state.sanity += 2;
        bonusNote(4, "은신처 잠자리 개선");
      } else {
        await typeLine(`${label}의 은신처를 점검해 느슨해진 덩굴 매듭과 풀잎을 손질했다. 구조는 튼튼하게 유지되고 있다.`, "system");
        state.hp += 2;
        state.sanity += 1;
      }
    } else {
      const prepared = shelterPrepAt(place);
      const hasTools = hasItem("칼") || hasItem("밧줄");
      if (prepared || hasTools || Math.random() < 0.75) {
        addFlag("은신처");
        addFlag(`${SHELTER_PLACE_PREFIX}${place}`);
        removeFlag(`${SHELTER_PREP_PREFIX}${place}`);
        removeFlag("은신처준비"); // 이전 버전의 전역 준비 상태가 다른 장소에 남지 않도록 정리
        await typeLine(`${label}에서 나뭇가지와 잎, 주변 재료를 엮어 은신처를 세웠다. 이곳에서 밤을 보낼 수 있을 것 같다.`, "find");
        state.sanity += 8;
        state.hp += 3;
      } else {
        await typeLine(`${label}에서 은신처의 기초를 잡았지만, 재료가 부족해 완성하지 못했다. 다음에 이곳으로 돌아와 마저 지어야겠다.`);
        state.sanity -= 2;
        removeFlag("은신처준비");
        addFlag(`${SHELTER_PREP_PREFIX}${place}`);
      }
    }
    state.hunger -= 3;
    state.thirst -= 4;
  }

  function hasItem(item) {
    return state.inventory.includes(item);
  }

  function addItem(item, allowDup = false) {
    if (allowDup || !hasItem(item)) {
      state.inventory.push(item);
      const last = item.charCodeAt(item.length - 1);
      const isHangul = last >= 0xac00 && last <= 0xd7a3;
      const josa = !isHangul ? "을(를)" : (last - 0xac00) % 28 === 0 ? "를" : "을";
      say(`→ '${item}'${josa} 얻었다!`, "system");
    }
  }

  function removeItem(item) {
    state.inventory = state.inventory.filter((x) => x !== item);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function clamp() {
    state.hp = Math.max(0, Math.min(100, state.hp));
    state.hunger = Math.max(0, Math.min(100, state.hunger));
    state.thirst = Math.max(0, Math.min(100, state.thirst));
    state.sanity = Math.max(0, Math.min(100, state.sanity));


    state.hp = Math.max(0, Math.min(100, state.hp));
    state.sanity = Math.max(0, Math.min(100, state.sanity));

    if (state.hp <= 0) {
      state.alive = false;
      state.ending = state.ending || "death_hp";
    }
    if (state.sanity <= 0) {
      state.alive = false;
      state.ending = state.ending || "death_sanity";
    }
  }

  // 하루에 행동할 수 있는 횟수. 탐험가는 발걸음이 가벼워 하나 더 움직인다.
  function baseActionPoints() {
    return state.role === "explorer" ? 5 : 4;
  }

  // 실질적인 '행동'을 마쳤을 때 호출 — 체력 정리 + 행동력 1 소모 + 화면 갱신
  // 난이도·직업에 따른 허기/수분 소모 배율
  function drainFactor() {
    return (
      (state.diff === "easy" ? 0.75 : state.diff === "hard" ? 1.3 : 1) *
      (state.role === "survivalist" ? 0.85 : 1) *
      (state.role === "explorer" ? 1.1 : 1)
    );
  }

  // 허기·수분이 바닥일 때의 피해: 하루 한 번(×2), 행동마다 약하게(×1) 적용한다
  function applyDeprivation(scale) {
    const hungry = state.hunger <= 0;
    const thirsty = state.thirst <= 0;
    if (!hungry && !thirsty) return;
    if (hungry) {
      state.hp -= Math.round(2 * scale);
      state.sanity -= Math.round(1 * scale);
    }
    if (thirsty) {
      state.hp -= Math.round(4 * scale);
      state.sanity -= Math.round(1 * scale);
    }
    say(thirsty ? "목이 타들어 간다…" : "허기에 몸이 떨린다…", "system");
  }

  // 행동 하나마다 체력을 쓰므로 허기·수분이 조금씩 준다
  function spendAction(cost = 1) {
    const f = drainFactor();
    state.hunger -= Math.round(1.2 * f * cost);
    state.thirst -= Math.round(2 * f * cost);
    clamp();
    applyDeprivation(1);
    clamp();
    state.actionPoints = Math.max(0, state.actionPoints - cost);
    updateHud();
  }

  function tickDay() {
    state.day += 1;
    const f = drainFactor();
    state.hunger -= Math.round(5 * f);
    state.thirst -= Math.round(5 * f);
    state.sanity -= Math.round((1 + Math.floor(Math.random() * 2)) * f);
    state.flags = state.flags.filter((x) => !["오늘모닥불", "야간임시모닥불", "오늘기도", "해변휴식오늘", "밀림휴식오늘", "암초휴식오늘", "동굴휴식오늘", "동굴먹거리탐색오늘", "절벽사색오늘", "폭풍피해오늘", "암초파도피해오늘", "멧돼지조우오늘", "밀림수원탐색오늘", "뗏목출항시도오늘", "해변위협오늘", "밀림위협오늘", "암초위협오늘", "동굴위협오늘", "절벽위협오늘"].includes(x));
    clamp();
    applyDeprivation(2);
    clamp();
  }

  const BANNER = { beach: "🏖️ 해변", jungle: "🌴 밀림", reef: "🌊 암초", cave: "🕳️ 동굴", cliff: "⛰️ 언덕 위" };

  // 장소가 바뀌거나 새 날이 시작되면 로그에 장소 배너를 띄운다
  function classifyLine(t) {
    if (/멧돼지|송곳니|돌진|들이받|상처|통증|비명|무너지|헛디뎌|베였|물렸|곪|오한|펄펄|추락|미끄러/.test(t)) return "danger";
    if (/발견|찾았|얻었|손에 걸린|떨어진다|잡았다|드러난다|드러낸다|맺혔다|챙긴다/.test(t)) return "find";
    if (/폭풍|파도|비가|비바람|간조|만조|천둥|이슬|바람이/.test(t)) return "weather";
    return "";
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function choose(prompt, options) {
    if (prompt !== "무엇을 할까?" && prompt !== "동굴에서…") return rawChoose(prompt, options);
    for (;;) {
      const extras = [
        [hasFlag("오늘기도") ? "기도를 올린다 (오늘 기도함)" : "기도를 올린다", () => prayer()],
        ["모닥불을 만든다", () => makeCampfire()],
      ];
      if (craftable().length) extras.push(["도구를 만든다", () => craftMenu()]);
      extras.push(
        [
          "오늘은 여기까지 — 밤을 맞는다",
          async () => {
            await typeLine("오늘은 여기까지 하기로 한다. 밤이 다가온다.");
            state.actionPoints = 0;
            updateHud();
          },
        ]
      );
      // 이동 메뉴는 따로 두지 않고, 장소 메뉴의 맨 아래에 붙인다
      const moves = travelTargets(state.place); // 발견한 모든 장소로 이동할 수 있다
      const moveLabels = moves.map((k) => `→ ${PLACE_LABEL[k]} 이동`);
      const c = await rawChoose(prompt, [...options, ...extras.map((x) => x[0]), ...moveLabels]);
      if (c === -3 && pendingInventoryItem) {
        const item = pendingInventoryItem;
        pendingInventoryItem = null;
        await useInventoryItem(item);
        if (!state.alive || state.actionPoints <= 0) return -1;
        continue; // 아이템을 사용/읽은 뒤 동일한 행동 메뉴를 다시 표시
      }
      if (c < options.length) return c; // 일반 선택지 또는 취소(-1, -2)
      if (c >= options.length + extras.length) {
        pendingTravel = moves[c - options.length - extras.length];
        return -2; // 장면을 끝내고 moveMenu가 이동을 처리한다
      }
      const r = await extras[c - options.length][1]();
      if (r === "abort" || !state.alive || state.actionPoints <= 0) return -1;
    }
  }

  function checkVictory() {
    if (hasFlag("구조임박") && hasFlag("신호")) {
      state.ending = hasFlag("항공신호") ? "rescue_heli" : "rescue";
      state.alive = false;
      return true;
    }
    if (state.day >= 9 && hasFlag("신호") && state.hp >= 30) {
      state.ending = "rescue_late";
      state.alive = false;
      return true;
    }
    const finalDay = FINAL_SURVIVAL_DAY[state.diff] || FINAL_SURVIVAL_DAY.normal;
    if (state.day >= finalDay) {
      state.ending =
        state.hp >= 35 && hasFlag("은신처") ? "survivor" : "fade";
      state.alive = false;
      return true;
    }
    return false;
  }

  function showHints() {
    const tips = [];
    if (state.thirst < 35) {
      tips.push(
        "수분이 많이 부족하다. 밀림에서 물소리를 따라 샘물을 찾거나, 동굴 깊은 곳 물방울·빗물·달콤한 과일로 수분을 보충하자."
      );
    }
    if (state.hunger < 35) {
      tips.push(
        "배가 많이 고프다. 밀림의 과일, 암초의 조개나 물고기를 노려보자."
      );
    }
    if (state.sanity < 40) {
      tips.push("정신이 많이 흔들린다. 기도를 올리거나 은신처에서 쉬면 도움이 된다.");
    }
    if (!hasShelterAt(state.place) && !shelterPrepAt(state.place)) {
      tips.push("밤을 편하게 보내려면 현재 머무는 장소에서 구할 수 있는 재료로 은신처를 지어보자.");
    }
    if (!hasFlag("동굴발견")) {
      tips.push("밀림에서 발자국을 따라가면 숨겨진 장소로 이어질지도 모른다.");
    }
    if (!hasFlag("절벽발견")) {
      tips.push("밀림에서 높은 곳을 찾으면 섬 전체를 내려다볼 수 있을 것이다.");
    }
    if (!hasFlag("신호")) {
      tips.push("암초에서 성냥으로 연기를 피우면 지나가는 배를 향한 구조 신호가 된다.");
    }
    if (hasFlag("보트단서") && !hasFlag("구명보트발견")) {
      tips.push("일기장의 단서를 따라 간조 때 암초의 바위 틈을 살펴보자.");
    } else if (hasFlag("구명보트발견")) {
      if (!hasFlag("구명보트선체수리")) tips.push("구명보트 선체의 균열은 밧줄과 돛천, 또는 밧줄과 판자로 막을 수 있을 것 같다.");
      if (!hasItem("노")) tips.push("구명보트에 쓸 노가 없다. 간조 때 암초와 해안 잔해를 더 찾아보자.");
      if (!hasFlag("보트항로확인")) tips.push("절벽에서 암초 밖의 해류와 출항 방향을 살펴야 한다.");
    }
    if (hasFlag("절벽발견") && !hasItem("신호거울")) {
      tips.push("절벽에서 표류물을 뒤지면 하늘에 신호를 보낼 도구를 찾을 수 있을지도 모른다.");
    }
    const raftItems = ["대나무", "판자", "밧줄", "돛천"];
    const raftMissing = raftItems.some((x) => !hasItem(x));
    const raftGuide = "뗏목 재료 길잡이 — 대나무: 밀림에서 ‘대나무를 벤다’를 선택하거나 절벽 비탈 아래 대나무숲을 살핀다(칼이 있으면 더 확실하다). 판자: 절벽의 해안 표류물, 간조 때 암초 틈, 해변의 난파선 잔해를 뒤진다. 밧줄: 난파선 잔해를 뒤지거나 절벽의 표류물을 살핀다. 구명보트를 발견한 뒤에는 밀림에서 질긴 넝쿨을 꼬아 임시 밧줄을 만들 수도 있다. 선원·항해사는 처음부터 밧줄을 가지고 있을 수 있다. 돛천: 절벽 표류물에서 드물게 발견하거나, 성냥을 챙겨 동굴 깊은 곳의 선반을 탐색한다.";
    if (raftMissing) tips.unshift(raftGuide);
    if (hasItem("유리병") || hasItem("유리병(물)")) tips.push("유리병에 동굴의 민물을 담아 두었다가 마실 수 있다. 빈 물병과 똑같이 쓸 수 있다.");
    tips.push("간조에는 암초에서 조개와 표류목을 얻기 쉽고, 만조에는 물고기가 잘 잡히지만 파도가 위험하다. 구명보트는 간조에만 꺼낼 수 있다.");
    if (state.status.injury || state.status.fever) {
      tips.push("부상·열병은 구급상자로 치료하고, 은신처에서 쉬면 빨리 낫는다.");
    }
    if (state.status.cold) tips.push("감기는 모닥불 곁에서 몸을 녹이면 낫는다. 낮 행동력도 줄어든다.");
    if (state.status.stomach) tips.push("복통은 이틀쯤 쉬면 가라앉는다. 날음식과 짠물을 조심하자.");
    if (tips.length === 0) {
      tips.push("지금은 모든 것이 순조롭다. 하던 대로 신중하게 이어가자.");
    }

    // 한 번 보여 준 내용은 다시 보여 주지 않는다
    if (!Array.isArray(state.shownHints)) state.shownHints = [];
    const fresh = tips.filter((t) => !state.shownHints.includes(t));
    say("— 생존 수첩 —", "system");
    if (!fresh.length) {
      say("· 새로 적힌 내용이 없다. 지금 읽을 수 있는 건 이미 다 읽었다.", "system");
      return;
    }
    // 뗏목 재료 안내는 첫 수첩 열람 때 반드시 함께 표시하고, 나머지 힌트는 하나를 무작위로 덧붙인다.
    const raftTip = fresh.find((t) => t.startsWith("뗏목 재료 길잡이 —"));
    const otherFresh = fresh.filter((t) => t !== raftTip).sort(() => Math.random() - 0.5);
    const selected = raftTip ? [raftTip, ...otherFresh.slice(0, 1)] : otherFresh.slice(0, 2);
    selected.forEach((t) => {
      state.shownHints.push(t);
      say(`· ${t}`, "system");
    });
  }

  // —— 역할 선택 ——
  function applyRole(index) {
    const role = ROLES[index];
    state.role = role.id;

    if (role.id === "sailor") {
      addItem("밧줄");
      state.hp += 5;
      say(
        "선원 출신답게, 정신없는 와중에도 밧줄 하나는 손에 꼭 쥐고 있었다.",
        "system"
      );
    } else if (role.id === "medic") {
      addItem("구급상자");
      say("의사 가방에서 작은 구급상자만은 간신히 건져냈다.", "system");
    } else if (role.id === "explorer") {
      addItem("나침반");
      state.sanity += 6;
      say(
        "탐험가의 감각이 낯선 땅에서도 당신을 침착하게 만든다.",
        "system"
      );
    } else if (role.id === "fisher") {
      addItem("창");
      addItem("빈 물병");
      say("어부의 손에는 아직 작살 같은 창이 쥐어져 있다.", "system");
    } else if (role.id === "pilot") {
      addItem("신호거울");
      state.sanity += 5;
      say("조종사의 주머니에는 늘 신호거울이 들어 있었다.", "system");
    } else if (role.id === "navigator") {
      addItem("밧줄");
      addItem("나침반");
      say("항해사의 손이 밧줄과 나침반을 놓치지 않았다.", "system");
    } else if (role.id === "survivalist") {
      addItem("성냥");
      addItem("칼");
      say("생존 훈련의 기억이 배낭 속 성냥과 칼을 챙기게 했다.", "system");
    }
    clamp();
    updateHud();
  }


  // —— 기도 (정신력 회복) ——
  async function prayer() {
    if (hasFlag("오늘기도")) {
      await typeLine("오늘은 이미 마음을 가다듬었다. 다시 기도해도 지금은 정신이 쉬이 안정되지 않는다.", "system");
      spendAction();
      return;
    }
    addFlag("오늘기도");
    const lines = [
      "두 손을 모으고 눈을 감는다. 파도 소리만이 대답처럼 들려온다.",
      "낮은 목소리로 기도를 올린다. 누군가 듣고 있을지는 알 수 없지만.",
      "마음속으로 두고 온 사람들의 얼굴을 떠올리며 조용히 빈다.",
      "바람에 기도가 실려 간다. 왠지 조금은 가벼워진 기분이다.",
      "모래 위에 무릎을 꿇고, 하늘을 향해 속삭인다.",
    ];
    const byPlace = {
      beach: ["두 손을 모으고 눈을 감는다. 파도 소리만이 대답처럼 들려온다.", "모래 위에 무릎을 꿇고, 하늘을 향해 속삭인다."],
      jungle: ["나무 그늘에 무릎을 꿇고 눈을 감는다. 숲의 숨소리만이 대답처럼 들려온다.", "잎사귀 사이로 새어드는 빛을 향해 조용히 빈다."],
      reef: ["바위 위에 앉아 파도 소리를 들으며 두 손을 모은다.", "물보라를 맞으며 수평선을 향해 낮게 기도한다."],
      cave: ["어둠 속에서 두 손을 모은다. 물방울 떨어지는 소리가 대답처럼 울린다.", "동굴 벽에 이마를 기대고 조용히 빈다."],
      cliff: ["바람 부는 절벽 끝에서 눈을 감고 두 손을 모은다. 하늘이 한결 가깝게 느껴진다.", "탁 트인 하늘을 올려다보며 가만히 빈다."],
    };
    await typeLine(pick([lines[1], lines[2], ...(byPlace[state.place] || [lines[0]])]));

    const gain = randInt(6, 10);
    state.sanity += gain;

    if (!hasFlag("첫기도")) {
      addFlag("첫기도");
      await typeLine("처음으로 올린 기도. 이상하리만치 마음이 차분해진다.");
      state.sanity += 4;
    } else if (Math.random() < 0.08) {
      await typeLine("문득, 모든 게 다 괜찮아질 것 같은 예감이 든다.");
      state.sanity += 3;
    }

    state.hunger -= 1;
    state.thirst -= 1;
    spendAction();
  }

  // —— 장면 ——
  async function sceneBeach() {
    state.place = "beach";
    state.phase = "day";
    updateSceneImage();
    updateHud();

    if (!hasFlag("해변첫도착")) {
      addFlag("해변첫도착");
      await typeLine(
        "하얀 모래사장. 부서진 나무 조각과 해초가 여기저기 흩어져 있다."
      );
      await typeLine(
        "짠내 섞인 바람이 뺨을 스치고, 멀리 밀림의 초록이, 반대편엔 암초의 흰 포말이 보인다."
      );
    } else {
      await typeLine(
        pick([
          "파도가 밀려왔다 밀려간다. 모래 위로 작은 게 한 마리가 종종걸음으로 지나간다.",
          "야자수 잎이 바람에 서걱거린다. 저 멀리 수평선이 희미하게 빛난다.",
          "발밑의 모래가 따뜻하다. 부서지는 파도 소리에 조개껍질 구르는 소리가 섞여 든다.",
          "밀물이 남기고 간 해초 더미에서 비릿한 냄새가 풍긴다.",
        ])
      );
    }

    if (!hasItem("조개목걸이") && Math.random() < 0.2) {
      await typeLine("모래 속에서 윤이 나는 조개껍질을 발견했다.", "system");
      addItem("조개목걸이");
      state.sanity += 5;
      updateHud();
    }

    if (!hasFlag("유리병발견") && Math.random() < 0.18) {
      addFlag("유리병발견");
      await typeLine("파도에 떠밀려온 유리병 하나가 모래에 박혀 있다.", "system");
      await typeLine("유리병을 줍는다.");
      addItem("유리병");
      if (Math.random() < 0.5) {
        await typeLine("안에는 누군가의 짧은 메모가 들어 있다: '포기하지 마세요.'");
        state.sanity += 6;
      } else {
        await typeLine("병은 비어 있다. 그래도 왠지 혼자가 아닌 것 같다.");
        state.sanity += 3;
      }
      await typeLine("물을 담아 두면 물병 대신 쓸 수 있겠다.", "system");
      updateHud();
    }

    await placeHazard("beach");
    if (!state.alive) return;

    const raftReady =
      hasItem("대나무") && hasItem("판자") && hasItem("밧줄") && hasItem("돛천");
    const raftChoice = hasFlag("뗏목완성")
      ? hasFlag("뗏목손상")
        ? "뗏목을 보강한다"
        : hasFlag("뗏목출항시도오늘")
          ? "파도를 살피며 내일을 기다린다"
          : "뗏목으로 탈출을 시도한다"
      : raftReady
        ? "뗏목을 만든다 (재료 준비됨)"
        : "뗏목 재료를 점검한다";

    const beachChoices = [
      hasFlag("잔해수색") && !hasItem("성냥") ? "난파선 잔해를 더 깊이 뒤진다" : "난파선 잔해를 뒤진다",
      "바닷물을 마신다",
      hasFlag("해변휴식오늘") ? "잠시 더 휴식" : "그늘을 찾아 쉰다",
      raftChoice,
      shelterActionLabel(),
    ];

    const c = await choose("무엇을 할까?", beachChoices);

    if (c < 0) return;
    if (c === 0) {
      if (!hasFlag("잔해수색")) {
        addFlag("잔해수색");
        const matchChance = state.role === "medic" ? 0.85 : 0.6; // 의사는 방수 케이스를 알아본다
        const roll = Math.random();
        if (roll < matchChance) {
          addItem("성냥");
          addItem("빈 물병");
          await typeLine("녹슨 상자에서 성냥과 빈 물병을 찾았다.");
        } else if (roll < matchChance + (1 - matchChance) * 0.6) {
          addItem("칼");
          await typeLine("부서진 난간 아래에서 쓸 만한 칼을 발견했다.");
          state.sanity += 5;
        } else {
          await typeLine("쓸 만한 건 거의 없다. 낡은 밧줄 정도…");
          addItem("밧줄");
        }
        if (state.role === "sailor" && !hasItem("밧줄")) {
          addItem("밧줄");
          await typeLine("뱃사람의 감으로, 잔해 틈에 숨은 밧줄 하나를 더 찾아낸다.");
        }
        state.hunger -= 2;
        state.thirst -= 2;
      } else {
        if (!hasItem("성냥")) {
          // 성냥을 찾을 때까지 몇 번이든 뒤질 수 있다. 헛수고가 쌓일수록 발견 확률이 오른다.
          state.searchTries = (state.searchTries || 0) + 1;
          const chance = Math.min(0.95, 0.6 + 0.15 * (state.searchTries - 1) + (state.role === "medic" ? 0.2 : 0));
          await typeLine(
            state.searchTries === 1
              ? "잔해 아래를 더 깊이 파 본다. 모래에 반쯤 묻힌 방수 상자가 손에 걸린다."
              : pick([
                  "무너진 선체 틈을 다시 헤집는다. 아직 보지 못한 구석이 남아 있다.",
                  "파도가 물러난 자리의 모래를 손으로 걷어낸다.",
                  "부서진 갑판 조각을 하나씩 들춰 가며 샅샅이 뒤진다.",
                ])
          );
          if (Math.random() < chance) {
            await typeLine(pick(["눅눅하지만 쓸 만한 성냥갑이 들어 있다!", "비닐에 싸인 성냥갑이 손끝에 걸린다 — 아직 말라 있다!"]));
            addItem("성냥");
            state.sanity += 6;
          } else {
            await typeLine(pick(["젖은 모래와 부서진 나뭇조각뿐이다.", "금이 간 병과 찢어진 천 조각만 나온다.", "녹슨 못과 젖은 종이 뭉치뿐, 쓸 만한 건 없다."]));
            state.sanity -= 2;
          }
          state.hunger -= 2;
          state.thirst -= 2;
        } else {
          if (hasFlag("구명보트발견") && !hasItem("밧줄")) {
            await typeLine("이미 뒤진 난파선이지만, 구명보트를 수리할 재료를 찾아 갑판 밑을 다시 살핀다.");
          } else {
            await typeLine("이미 뒤져본 곳이다. 더 나올 게 없다.");
            state.sanity -= 1;
          }
        }
      }
      // 구명보트를 발견한 뒤에는 첫 수색이든 반복 수색이든 밧줄을 추가로 찾을 기회를 준다.
      if (hasFlag("구명보트발견") && !hasItem("밧줄") && Math.random() < 0.42) {
        await typeLine("부서진 돛대 아래를 들추자 바닷물에 젖었지만 아직 쓸 만한 밧줄 뭉치가 드러난다.", "find");
        addItem("밧줄");
      }
    } else if (c === 1) {
      await typeLine("짠물이 목을 태운다. 갈증은 더 심해진다…");
        if (Math.random() < 0.5) afflict("stomach", 2);
      state.thirst -= 10;
      state.hp -= 5;
      state.sanity -= 3;
    } else if (c === 2) {
      if (hasFlag("해변휴식오늘")) {
        await typeLine("잠시 더 휴식을 취하지만, 오늘은 이미 충분히 쉬어 피로가 거의 풀리지 않는다.", "system");
      } else {
        addFlag("해변휴식오늘");
        await typeLine("야자수 그늘에 등을 기대고 호흡을 고른다. 파도 소리에 긴장이 조금 풀리고, 몸의 떨림도 가라앉는다.");
        state.hp += 7;
        state.sanity += 5;
        state.hunger -= 2;
        state.thirst -= 3;
      }
    } else if (c === 3) {
      if (hasFlag("뗏목완성")) {
        if (hasFlag("뗏목손상")) {
          await repairRaft();
        } else if (hasFlag("뗏목출항시도오늘")) {
          await typeLine("오늘은 이미 출항을 시도했다. 바람과 파도는 잠잠해질 기미가 없다. 내일 다시 바다를 살피자.", "system");
          state.sanity += 1;
        } else {
          const escaped = await tryRaftEscape();
          if (escaped) return;
        }
      } else if (raftReady) {
        await typeLine("대나무, 판자, 밧줄, 돛천을 모래 위에 펼쳐 놓는다.");
        await typeLine("손바닥이 까지고 매듭이 여러 번 풀리지만, 마침내 재료를 단단히 엮는다.");
        removeItem("대나무");
        removeItem("판자");
        removeItem("밧줄");
        removeItem("돛천");
        addFlag("뗏목완성");
        state.hp -= 2;
        state.hunger -= 3;
        state.thirst -= 4;
        state.sanity += 3;
        state.bonus = (state.bonus || 0) + 5;
        await typeLine("뗏목이 완성되었다! 하지만 파도와 해류를 잘못 만나면 부서질 수 있다. 날씨와 몸 상태를 살핀 뒤 출항하자.", "find");
      } else {
        const need = ["대나무", "판자", "밧줄", "돛천"].filter(
          (x) => !hasItem(x)
        );
        await typeLine(`뗏목을 만들려면 아직 부족하다: ${need.join(", ")}`, "system");
        state.sanity -= 1;
      }
    } else if (c === 4) {
      await buildShelterAtCurrentPlace();
    }
    spendAction();
  }

  // 뗏목은 제작과 출항을 분리한다. 출항 실패 후에도 상황을 수습해 다시 시도할 수 있다.
  async function tryRaftEscape() {
    addFlag("뗏목출항시도오늘");

    if (state.hp < 25 || state.hunger < 15 || state.thirst < 15) {
      await typeLine("뗏목을 물가로 밀어 보지만 팔에 힘이 들어가지 않는다. 허기와 갈증까지 겹쳐 지금 출항하면 더 큰 위험에 빠질 것 같다.", "danger");
      await typeLine("체력 25, 포만 15, 수분 15 이상을 확보하고 다시 시도하자.", "system");
      state.hp -= 2;
      state.sanity -= 3;
      bonusNote(-5, "기력이 부족해 뗏목 출항 실패");
      clamp();
      updateHud();
      return false;
    }

    if (state.weather === "storm") {
      await typeLine("뗏목을 물에 띄우자마자 돌풍이 돛천을 세차게 잡아당긴다. 거대한 파도가 대나무 몸체를 옆으로 꺾어, 간신히 해안으로 기어 나온다.", "danger");
      state.hp -= 9;
      state.thirst -= 5;
      state.sanity -= 7;
      if (Math.random() < 0.65) {
        addFlag("뗏목손상");
        await typeLine("대나무 연결부가 벌어지고 밧줄 매듭이 느슨해졌다. 출항 전에 뗏목을 보강해야 한다.", "danger");
      } else {
        await typeLine("뗏목은 간신히 떠밀려 왔지만, 물살이 가라앉을 때까지 기다리는 편이 낫겠다.");
      }
      bonusNote(-18, "폭풍에 밀려 뗏목 출항 실패");
      clamp();
      updateHud();
      return false;
    }

    let chance = 0.58;
    if (state.role === "navigator") chance += 0.18;
    else if (state.role === "sailor") chance += 0.12;
    else if (state.role === "explorer") chance += 0.04;
    if (state.weather === "clear") chance += 0.08;
    if (state.weather === "cloud") chance -= 0.09;
    if (isLowTide()) chance -= 0.08;
    if (state.hp >= 60) chance += 0.05;
    if (state.hunger >= 45 && state.thirst >= 45) chance += 0.04;
    if (hasFlag("지형파악")) chance += 0.07;
    if (state.diff === "easy") chance += 0.05;
    if (state.diff === "hard") chance -= 0.08;
    chance = Math.max(0.28, Math.min(0.92, chance));

    if (Math.random() < chance) {
      await typeLine("뗏목을 무릎까지 차오르는 물에 띄운다. 첫 파도가 옆구리를 때리지만, 돛천을 조절하며 암초 바깥쪽으로 방향을 잡는다.");
      await typeLine("바람이 잠시 잦아든 틈에 해류를 탄다. 섬의 윤곽이 멀어지고, 마침내 탁 트인 바다로 나아간다!", "find");
      state.bonus = (state.bonus || 0) + 20;
      state.crises = (state.crises || 0) + 1;
      state.ending = "raft_escape";
      state.alive = false;
      clamp();
      updateHud();
      return true;
    }

    const incident = Math.random();
    if (incident < 0.4) {
      await typeLine("암초를 돌아 나가던 순간, 옆 파도가 뗏목 아래로 파고든다. 몸이 바다에 빠졌다가 해안으로 떠밀려 오고, 뗏목의 연결부가 비틀어진다.", "danger");
      state.hp -= 8;
      state.thirst -= 4;
      state.sanity -= 6;
      addFlag("뗏목손상");
      await typeLine("뗏목이 파손되었다. 밧줄·돛천·판자 중 하나로 보강하거나, 해변의 표류물을 이용해 수리해야 한다.", "system");
      bonusNote(-15, "파도에 뗏목이 파손되어 탈출 실패");
    } else if (incident < 0.75) {
      await typeLine("바람이 갑자기 돌아 돛천이 힘을 잃는다. 뗏목은 옆으로 밀려 몇 차례 파도에 휩쓸린 끝에 다시 해변으로 돌아온다.", "danger");
      state.hp -= 5;
      state.thirst -= 4;
      state.sanity -= 5;
      if (Math.random() < 0.25) {
        addFlag("뗏목손상");
        await typeLine("해안에 끌려온 뗏목의 매듭 몇 군데가 풀렸다. 다시 떠나기 전에 보강해야 한다.", "danger");
      }
      bonusNote(-10, "바람이 바뀌어 뗏목이 해안으로 밀려남");
    } else {
      await typeLine("바다가 잔잔해 보였지만 암초 바깥에 거센 횡류가 숨어 있었다. 뗏목이 제자리에서 맴돌자 더 멀리 나가지 않고 간신히 해안으로 돌아온다.", "danger");
      state.hp -= 3;
      state.hunger -= 2;
      state.thirst -= 3;
      state.sanity -= 4;
      bonusNote(-8, "해류를 잘못 만나 뗏목 탈출 실패");
    }
    clamp();
    updateHud();
    return false;
  }

  async function repairRaft() {
    await typeLine("뗏목의 대나무 연결부와 매듭을 살펴본다.");
    const patch = ["밧줄", "돛천", "판자"].find((item) => hasItem(item));
    if (patch) {
      removeItem(patch);
      removeFlag("뗏목손상");
      await typeLine(`${patch}을(를) 이용해 느슨해진 부분을 단단히 보강했다. 이제 다시 출항을 준비할 수 있다.`, "find");
      state.sanity += 3;
      state.bonus = (state.bonus || 0) + 4;
    } else if (Math.random() < 0.65) {
      removeFlag("뗏목손상");
      await typeLine("해변의 표류목과 질긴 덩굴을 찾아 임시로 매듭을 다시 묶었다. 완벽하진 않지만 출항은 가능할 것 같다.", "find");
      state.hunger -= 2;
      state.thirst -= 3;
      state.bonus = (state.bonus || 0) + 3;
    } else {
      await typeLine("손에 잡히는 표류목만으로는 매듭을 단단히 고정할 수 없다. 밧줄·돛천·판자 중 하나를 찾아 다시 보강해야 한다.", "danger");
      state.hp -= 2;
      state.sanity -= 2;
      bonusNote(-4, "뗏목 보강 실패");
    }
    clamp();
    updateHud();
  }

  function bonusNote(n, why) {
    // 점수는 내부 누적만 하고 이야기 패널에는 노출하지 않는다.
    state.bonus = (state.bonus || 0) + n;
    if (n > 0) state.crises = (state.crises || 0) + 1; // 위기 탈출 횟수
  }

  // 멧돼지 조우는 점수와 별개로 실제 체력·정신력에 반영한다.
  // 성공 보상은 작게, 물리적 피해가 발생한 경우에는 더 큰 손실을 준다.
  function boarOutcome(points, why) {
    let hpDelta = 0;
    let sanityDelta = 0;
    if (points > 0) {
      hpDelta = points >= 20 ? 1 : 0;
      sanityDelta = points >= 15 ? 1 : 0;
    } else {
      hpDelta = -Math.max(3, Math.ceil(Math.abs(points) / 6));
      sanityDelta = -Math.max(3, Math.ceil(Math.abs(points) / 6));
    }
    state.hp += hpDelta;
    state.sanity += sanityDelta;
    bonusNote(points, why);
    clamp();
  }

  // 멧돼지가 돌진하는 순간 — 피했는지, 들이받혔는지 판정해 점수에 반영한다
  async function boarCharge() {
    await typeLine("멧돼지가 땅을 박차며 곧장 달려든다. 눈앞이 온통 갈색 털과 송곳니로 가득 찬다!");
    const dodge =
      0.4 + (state.role === "explorer" ? 0.1 : 0) + (state.hp >= 60 ? 0.1 : 0) - (state.status.injury ? 0.2 : 0);
    if (Math.random() < dodge) {
      await typeLine("본능적으로 옆으로 몸을 던진다. 송곳니가 옷자락을 찢으며 스쳐 지나가고, 멧돼지는 수풀을 헤치며 멀어져 간다.");
      await typeLine("가슴이 터질 듯 뛴다. 팔꿈치가 조금 쓸렸을 뿐, 큰 상처는 없다 — 간발의 차였다.");
      state.hp -= 2;
      state.sanity -= 2;
      boarOutcome(25, "멧돼지의 돌진을 피했다");
    } else {
      await typeLine("피하려 했지만 발이 덩굴에 걸렸다. 묵직한 충격과 함께 몸이 허공으로 튕겨 나간다!");
      await typeLine("바닥에 나뒹굴며 정신을 차리니 허벅지에서 피가 배어난다. 멧돼지는 이미 수풀 너머로 사라졌다.");
      afflict("injury", 2);
      state.hp -= 14;
      state.sanity -= 7;
      boarOutcome(-25, "멧돼지에게 들이받혀 다쳤다");
    }
  }

  async function wildAnimalEncounter() {
    sfx("boar");
    boarScene = true;
    updateSceneImage();
    await typeLine("수풀이 거칠게 흔들리더니, 송곳니를 드러낸 멧돼지 한 마리가 당신을 노려본다!");
    await typeLine("콧김을 뿜으며 앞발로 흙을 긁는다. 곧 달려들 기세다.");

    const options = ["맞서 싸운다", "조용히 뒷걸음질친다", "나무 위로 피한다"];
    const c = await choose("어떻게 할까?", options);
    if (c < 0) return;

    const roleFightBonus = state.role === "sailor" ? 0.1 : 0;
    const roleEscapeBonus = state.role === "explorer" ? 0.1 : 0;

    if (c === 0) {
      const chance =
        (hasItem("창") ? 0.85 : hasItem("칼") ? 0.75 : hasItem("밧줄") ? 0.5 : 0.3) + roleFightBonus;
      if (Math.random() < chance) {
        await typeLine(
          hasItem("창")
            ? "창끝을 낮게 겨누고 버틴다. 돌진하던 멧돼지가 날카로운 끝에 멈칫하더니 비명을 지르며 달아난다."
            : hasItem("칼")
            ? "칼을 앞으로 겨누자 멧돼지가 주춤한다. 눈싸움 끝에 녀석이 먼저 수풀 속으로 달아난다."
            : "맨몸으로 소리를 지르며 맞서자, 기세에 놀란 멧돼지가 방향을 틀어 도망친다."
        );
        state.sanity += 3;
        boarOutcome(20, "멧돼지를 쫓아냈다");
        const bananaCount = randInt(1, 3);
        await typeLine(`달아나던 멧돼지가 부딪힌 나무에서 바나나 ${bananaCount}개가 우수수 떨어진다.`);
        for (let i = 0; i < bananaCount; i++) addItem("바나나", true);
        // 바나나는 인벤토리에 보관하며, 실제로 먹을 때만 포만을 회복한다.
      } else {
        await typeLine("맞서보지만 멧돼지의 기세가 훨씬 거세다. 송곳니가 다리를 훑고 지나가자 뜨거운 통증이 번진다.");
        await typeLine("비틀거리며 물러서자, 멧돼지는 콧김을 내뿜고 수풀 속으로 사라진다.");
        afflict("injury", 2);
        state.hp -= 16;
        state.sanity -= 7;
        boarOutcome(-20, "멧돼지에게 공격당해 다쳤다");
      }
    } else if (c === 1) {
      if (Math.random() < 0.75 + roleEscapeBonus) {
        await typeLine("숨을 죽이고 한 걸음씩 물러난다. 멧돼지는 한참을 노려보다 흥미를 잃고 수풀 속으로 사라진다.");
        state.sanity -= 2;
        boarOutcome(15, "멧돼지를 조용히 피했다");
      } else {
        await typeLine("뒷걸음질치다 나뭇가지를 밟아 '딱' 소리가 난다. 멧돼지의 귀가 쫑긋 서더니 몸을 낮춘다.");
        await boarCharge();
      }
      state.hunger -= 2;
      state.thirst -= 2;
    } else {
      if (Math.random() < 0.6 + roleEscapeBonus) {
        await typeLine("재빨리 가까운 나무 위로 기어오른다. 아래에서 멧돼지가 나무를 들이받으며 씩씩대다가, 한참 뒤에야 물러난다.");
        state.sanity -= 3;
        boarOutcome(10, "나무 위로 안전하게 피했다");
      } else {
        await typeLine("나무를 오르다 손이 미끄러진다! 떨어진 자리 바로 옆으로 멧돼지가 맹렬히 스쳐 지나간다.");
        afflict("injury", 2);
        state.hp -= 10;
        state.sanity -= 6;
        boarOutcome(-15, "허둥대다 다쳤다");
      }
    }
    boarScene = false;
    updateSceneImage();
    clamp();
    updateHud();
  }

  async function sceneJungle() {
    state.place = "jungle";
    state.phase = "day";
    updateSceneImage();
    updateHud();

    // 샘 찾기 선택지는 이번 방문의 상황 설명에서 실제로 물소리를 들었을 때만 열린다.
    removeFlag("밀림물소리들림");
    let jungleDescription = "";
    if (!hasFlag("밀림첫방문")) {
      addFlag("밀림첫방문");
      await typeLine(
        "습한 공기가 피부를 감싼다. 커다란 잎들 사이로 빛줄기가 가늘게 스며든다."
      );
      jungleDescription = "어디선가 새소리, 그리고 무언가 스쳐 지나가는 기척이 느껴진다.";
      await typeLine(jungleDescription);
    } else {
      jungleDescription = pick([
        "축축한 흙냄새가 짙다. 발밑에서 낙엽 밟히는 소리가 유난히 크게 울린다.",
        "머리 위로 커다란 나비 한 마리가 팔랑이며 지나간다.",
        "멀리서 물 흐르는 소리가 희미하게 들려오는 것 같다.",
        "나뭇가지 사이로 원숭이 울음소리가 메아리친다.",
      ]);
      await typeLine(jungleDescription);
    }
    if (/물 흐르는 소리|물소리가/.test(jungleDescription)) addFlag("밀림물소리들림");

    await placeHazard("jungle");
    if (!state.alive) return;

    const encounterChance = state.role === "explorer" ? 0.18 : 0.22;
    // 같은 날 밀림을 오갈 때 조우 피해가 연속 누적되지 않도록 하루 한 번으로 제한한다.
    if (!hasFlag("멧돼지조우오늘") && Math.random() < encounterChance) {
      addFlag("멧돼지조우오늘");
      await wildAnimalEncounter();
      if (!state.alive) return;
    }

    const jungleOptions = [
      [0, "과일을 찾아 딴다"],
      [1, shelterActionLabel()],
      [2, "대나무를 벤다"],
      [3, "발자국을 따라간다"],
      [4, "언덕 위로 올라가 본다"],
      ...(hasFlag("밀림물소리들림") && !hasFlag("밀림수원탐색오늘") ? [[5, "물소리를 따라 샘을 찾는다"]] : []),
      ...(hasFlag("구명보트발견") && !hasItem("밧줄") ? [[6, "질긴 넝쿨을 모아 밧줄을 만든다"]] : []),
      [7, hasFlag("밀림휴식오늘") ? "잠시 더 휴식" : "그늘에서 몸과 마음을 추스른다"],
    ].filter(([id]) => !(id === 3 && hasFlag("동굴발견")) && !(id === 4 && hasFlag("절벽발견")));

    const sel = await choose("무엇을 할까?", jungleOptions.map((o) => o[1]));
    if (sel < 0) return;
    const c = jungleOptions[sel][0];
    if (c === 0) {
      const successChance = state.role === "explorer" ? 0.85 : 0.75;
      if (Math.random() < successChance) {
        await typeLine("달콤한 열매를 몇 개 따냈다.");
        state.hunger += 24;
        state.thirst += 8;
        state.hp += 5;
        const poisonChance = state.role === "medic" ? 0.03 : 0.08;
        if (Math.random() < poisonChance) {
          await typeLine("…입안이 따끔하다. 상한 과일인 것 같다.");
        afflict("stomach", 2);
          state.hp -= 5;
          state.sanity -= 3;
        }
      } else {
        await typeLine("열매는 높은 곳에만 있다. 손이 닿지 않는다.");
        state.hunger -= 2;
        state.sanity -= 1;
      }
    } else if (c === 1) {
      await buildShelterAtCurrentPlace();
    } else if (c === 2) {
      if (hasItem("칼")) {
        await typeLine("칼로 튼튼한 대나무 몇 줄기를 베어낸다.");
        addItem("대나무");
        state.hunger -= 4;
        state.thirst -= 4;
      } else if (Math.random() < 0.4) {
        await typeLine("맨손으로 억지로 꺾어 대나무를 얻었다. 손바닥이 쓰라리다.");
        addItem("대나무");
        state.hp -= 3;
        state.hunger -= 4;
        state.thirst -= 4;
      } else {
        await typeLine("대나무는 질겨서 맨손으로는 잘 꺾이지 않는다.");
        state.sanity -= 1;
        state.hunger -= 2;
      }
    } else if (c === 3) {
      // 발자국을 따라가면 곧바로 동굴에 도착해 안으로 들어간다 (들어갈지 묻지 않는다)
      if (!hasFlag("동굴발견")) {
        await typeLine("발자국은 바위틈으로 이어진다… 어두운 동굴 입구다!");
        addFlag("동굴발견");
        state.sanity -= 2;
      } else {
        await typeLine("발자국이 이어진 바위틈 길을 따라 동굴로 향한다.");
      }
      await typeLine("망설일 틈도 없이, 당신은 어둠 속으로 발을 들인다.");
      await sceneCave();
      return;
    } else if (c === 4) {
      await sceneCliff();
      return;
    } else if (c === 5) {
      addFlag("밀림수원탐색오늘");
      const waterRoll = Math.random();
      if (waterRoll < 0.7) {
        await typeLine("물소리를 따라 덩굴과 바위를 헤치자, 바위 그늘 아래 맑은 샘이 나타난다. 두 손으로 물을 떠 마시니 타는 듯한 갈증이 한결 가신다.");
        state.thirst += 28;
        state.sanity += 2;
      } else if (waterRoll < 0.9) {
        await typeLine("샘은 찾지 못했지만, 커다란 잎사귀 안쪽에 빗물이 고여 있다. 조심스레 물을 마신다.");
        state.thirst += 14;
      } else {
        await typeLine("물소리를 따라 한참을 헤맸지만, 소리는 바람에 흔들리는 대나무 소리였다. 오늘은 물을 찾지 못했다.");
        state.sanity -= 1;
      }
    } else if (c === 6) {
      await typeLine("구명보트의 수리를 떠올리며 밀림에서 질긴 덩굴을 골라 모은다. 여러 가닥을 꼬아 서로 단단히 묶어 본다.");
      const ropeChance = hasItem("칼") ? 0.92 : state.role === "explorer" ? 0.86 : 0.78;
      if (Math.random() < ropeChance) {
        addItem("밧줄");
        await typeLine("덩굴 섬유가 단단히 맞물렸다. 임시 밧줄을 만드는 데 성공했다!", "find");
        state.sanity += 2;
      } else {
        await typeLine("덩굴이 꼬는 도중 끊어지고 매듭이 풀렸다. 더 질긴 덩굴을 찾아 다시 시도해야겠다.", "danger");
        state.sanity -= 1;
      }
      state.hunger -= 3;
      state.thirst -= 4;
    } else if (c === 7) {
      if (hasFlag("밀림휴식오늘")) {
        await typeLine("잠시 더 휴식을 취하지만, 몸과 마음은 거의 더 회복되지 않는다.", "system");
      } else {
        addFlag("밀림휴식오늘");
        await typeLine("넓은 잎이 햇빛을 가리는 자리에 앉아 숨을 고른다. 주변의 새소리에 귀를 기울이자 불안이 누그러지고, 가시에 긁힌 곳도 조심스레 살필 여유가 생긴다.");
        state.hp += 6;
        state.sanity += 4;
        state.hunger -= 2;
        state.thirst -= 3;
      }
    }
    spendAction();
  }

  async function sceneCliff() {
    state.place = "cliff";
    state.phase = "day";
    const firstVisit = !hasFlag("절벽발견");
    if (firstVisit) addFlag("절벽발견"); // 화면에 장소가 발견됨을 먼저 알려야 3D에서 절벽 메뉴가 열린다
    updateSceneImage();
    updateHud();

    if (firstVisit) {
      await typeLine("가파른 비탈을 올라서자 섬 전체가 한눈에 내려다보인다.");
      await typeLine(
        "초록빛 밀림, 하얀 해변, 부서지는 암초까지 — 섬의 모양이 처음으로 또렷해진다."
      );
      await typeLine("바람이 거세다. 발밑이 아찔하다.");
    } else {
      await typeLine(
        pick([
          "다시 절벽 위에 선다. 바람이 익숙하게 얼굴을 스친다.",
          "절벽 끝에 서니 저 아래 파도가 바위에 부서지는 소리가 크게 들린다.",
          "구름 그림자가 섬 위를 천천히 가로지른다.",
        ])
      );
    }

    const cliffChoices = [
      "수평선을 살핀다",
      "비탈 아래 대나무숲으로 내려간다",
      "해안가에 떠밀려온 것을 살핀다",
      hasItem("신호거울") ? "거울로 하늘에 신호를 보낸다" : "하늘을 올려다본다",
      shelterActionLabel(),
    ];

    await stormHazard();
    if (!state.alive) return;
    await placeHazard("cliff");
    if (!state.alive) return;
    const c = await choose("무엇을 할까?", cliffChoices);
    if (c < 0) return;

    if (c === 0) {
      if (hasFlag("구명보트발견") && !hasFlag("보트항로확인")) {
        addFlag("보트항로확인");
        if (!hasFlag("지형파악")) addFlag("지형파악");
        await typeLine("절벽 위에서 암초 바깥의 물결을 오래 관찰한다. 겉보기와 달리 해류가 동쪽 바위를 돌아 남쪽으로 빠져나간다는 걸 알아냈다. 이 경로라면 보트를 몰고 나갈 수 있다.", "find");
        state.sanity += 8;
      } else if (!hasFlag("지형파악")) {
        addFlag("지형파악");
        await typeLine("섬의 지형을 눈에 익힌다. 앞으로 길을 헤매는 일이 줄어들 것 같다.");
        state.sanity += 8;
      } else if (!hasFlag("절벽사색오늘")) {
        addFlag("절벽사색오늘");
        await typeLine("바람이 잠잠해진 틈에 수평선을 바라본다. 당장 해결할 일은 많지만, 호흡을 고르자 마음이 조금 가라앉는다.");
        state.sanity += 3;
      } else {
        await typeLine("수평선을 오래 바라보지만 바람만 거세다. 오늘은 이미 마음을 가다듬었으니 무리하지 않기로 한다.", "system");
      }
    } else if (c === 1) {
      if (Math.random() < 0.2) {
        await typeLine("발을 헛디뎌 미끄러졌다! 바위에 긁혀 상처가 났다.");
        afflict("injury", 3);
        state.hp -= 7;
        state.sanity -= 3;
      } else {
        await typeLine("비탈의 대나무숲에서 굵은 대나무를 베어낸다.");
        addItem("대나무");
      }
      state.hunger -= 3;
      state.thirst -= 4;
    } else if (c === 2) {
      if (!hasFlag("표류물수색")) {
        addFlag("표류물수색");
        await typeLine("파도에 밀려온 나무 판자 더미를 발견했다.");
        addItem("판자");
        if (Math.random() < 0.4) {
          await typeLine("판자 사이에 낡은 천 조각이 엉켜 있다 — 튼튼한 돛천이다!");
          addItem("돛천");
        }
        if (Math.random() < 0.25) {
          await typeLine("부서진 조종석 조각 틈에서 작은 손거울을 발견했다.");
          addItem("신호거울");
        }
      } else if (!hasItem("판자") && Math.random() < 0.5) {
        await typeLine("바위틈에 끼어 있던 판자 한 장을 더 찾았다.");
        addItem("판자");
      } else if (!hasItem("신호거울") && Math.random() < 0.2) {
        await typeLine("모래에 반쯤 묻힌 손거울 조각을 찾았다.");
        addItem("신호거울");
      } else {
        await typeLine("더 쓸 만한 것은 보이지 않는다.");
        state.sanity -= 1;
      }
      // 구명보트를 발견한 뒤에는 절벽 아래의 표류물에서 밧줄을 건질 수도 있다.
      if (hasFlag("구명보트발견") && !hasItem("밧줄") && Math.random() < 0.38) {
        await typeLine("널빤지 밑에 감겨 있던 밧줄 한 뭉치가 파도에 떠밀려와 바위에 걸려 있다.", "find");
        addItem("밧줄");
      }
    } else if (c === 3) {
      if (hasItem("신호거울")) {
        await typeLine("거울을 꺼내 하늘을 가로지르는 비행기를 향해 빛을 반사시킨다.");
        addFlag("항공신호");
        if (Math.random() < (state.role === "pilot" ? 0.22 : 0.12)) {
          await typeLine("비행기가 날개를 기울인다 — 당신을 본 것이다!");
          state.ending = "rescue_plane";
          state.alive = false;
          clamp();
          updateHud();
          return;
        }
        await typeLine("비행기는 그대로 지나쳐 사라진다. 다음 기회를 노려야 한다.");
        state.sanity -= 2;
      } else {
        await typeLine("하늘을 올려다보지만, 신호를 보낼 도구가 없다.");
        state.sanity -= 1;
      }
      state.thirst -= 1;
    } else if (c === 4) {
      await buildShelterAtCurrentPlace();
    }
    spendAction();
  }

  async function sceneCave() {
    state.place = "cave";
    state.phase = "day";
    updateSceneImage();
    updateHud();

    if (!hasFlag("동굴탐색")) {
      addFlag("동굴탐색");
      await typeLine("축축한 돌벽. 물방울 소리가 어둠 속에서 메아리친다.");
      if (hasItem("나침반")) {
        await typeLine(
          "바닥에 녹슨 나침반 하나가 더 떨어져 있다. 이미 가진 것과 같은 모델이라, 그냥 두기로 한다."
        );
      } else {
        await typeLine("깊숙한 곳에서 반짝이는 무언가를 발견했다 — 오래된 나침반!");
        addItem("나침반");
      }
      if (!hasItem("낡은 일기장") && Math.random() < 0.5) {
        await typeLine("구석, 가죽으로 된 낡은 일기장 한 권이 떨어져 있다.");
        addItem("낡은 일기장");
      }
      await typeLine("조용히 주변의 물건을 챙긴다. 하지만 어둠 속 어딘가에서 날갯짓 소리가 희미하게 들린다.");
      state.sanity += 4;
      clamp();
      updateHud();
      if (!state.alive) return;
    } else {
      await typeLine(
        pick([
          "다시 동굴 안으로 들어선다. 서늘한 공기가 몸을 감싼다.",
          "물방울이 규칙적으로 떨어지는 소리가 어둠 속에 울린다.",
          "눈이 어둠에 적응하자, 벽면의 희미한 무늬가 눈에 들어온다.",
        ])
      );
    }

    await placeHazard("cave");
    if (!state.alive) return;

    {
      const canGoDeep = hasItem("성냥") && !hasFlag("심층동굴");
      const caveOptions = ["민물을 모은다", hasFlag("동굴휴식오늘") ? "잠시 더 휴식" : "쉬어 간다"];
      if (canGoDeep) caveOptions.push("성냥에 불을 붙여 더 깊이 들어간다");
      const canSearch = !hasItem("낡은 일기장");
      if (canSearch) caveOptions.push("어둠 속 구석을 더듬어 본다");
      const shelterIndex = caveOptions.length;
      caveOptions.push(shelterActionLabel());
      const foodSearchIndex = caveOptions.length;
      const canSearchFood = !hasFlag("동굴먹거리탐색오늘");
      if (canSearchFood) caveOptions.push("동굴에서 먹거리를 찾는다");

      const c = await choose("동굴에서…", caveOptions);
      if (c < 0) return;
      const deepIndex = canGoDeep ? 2 : -1;
      const searchIndex = canSearch ? (canGoDeep ? 3 : 2) : -1;

      if (c === 0) {
        await typeLine("바위틈에서 떨어지는 물을 받았다.");
        if (hasItem("빈 물병")) {
          removeItem("빈 물병");
          state.inventory.push("물병(가득)");
          await typeLine("물병에 채웠다.");
        }
        if (hasItem("유리병")) {
          removeItem("유리병");
          state.inventory.push("유리병(물)");
          await typeLine("유리병에도 맑은 물을 채웠다.");
        }
        state.thirst += 30;
        state.hp += 5;
      } else if (c === 1) {
        if (hasFlag("동굴휴식오늘")) {
          await typeLine("잠시 더 휴식을 취하지만, 젖고 차가운 바닥에서는 몸이 편해지지 않는다.", "system");
        } else {
          addFlag("동굴휴식오늘");
          await typeLine("바람이 덜 드는 바위턱에 몸을 웅크리고 잠시 눈을 붙인다. 물방울 소리에 호흡을 맞추자 긴장이 누그러진다.");
          state.hp += 9;
          state.sanity += 5;
          state.hunger -= 3;
          state.thirst -= 3;
        }
      } else if (c === deepIndex) {
        await typeLine("성냥불을 밝히고 좁은 통로를 지나 더 깊은 곳으로 들어간다.");
        if (Math.random() < 0.3) {
          await typeLine("천장이 무너지며 돌가루가 쏟아진다! 황급히 몸을 피한다.");
        afflict("injury", 3);
          state.hp -= 8;
          state.sanity -= 4;
        } else {
          await typeLine("깊은 곳, 마른 선반 위에서 낡은 돛천 뭉치를 발견했다.");
          addItem("돛천");
          await typeLine("벽면의 수정이 은은한 빛을 낸다. 마음이 차분해진다.");
          state.sanity += 12;
          addFlag("심층동굴"); // 성공해야 탐사가 끝난다 — 무너졌다면 다시 도전할 수 있다
          await typeLine("수정 아래 고인 맑은 물로 목을 축인다.");
          state.thirst += 14;
          if (!hasItem("구급상자") && Math.random() < 0.5) {
            await typeLine("선반 안쪽에 먼저 다녀간 이의 구급상자가 남아 있다!");
            addItem("구급상자");
          }
        }
        state.hunger -= 4;
        state.thirst -= 4;
      } else if (c === searchIndex) {
        await typeLine("어둠 속 구석구석을 손으로 더듬는다. 차가운 돌바닥과 젖은 흙뿐이다…");
        if (Math.random() < 0.4) {
          await typeLine("손끝에 가죽 표지가 닿는다 — 낡은 일기장이다!");
          addItem("낡은 일기장");
          state.sanity += 6;
        } else {
          await typeLine("아무것도 없다. 허탕이다.");
          state.sanity -= 2;
        }
        state.hunger -= 2;
        state.thirst -= 2;
      } else if (c === shelterIndex) {
        await buildShelterAtCurrentPlace();
      } else if (canSearchFood && c === foodSearchIndex) {
        addFlag("동굴먹거리탐색오늘");
        await typeLine("불빛이 닿는 바위 틈과 축축한 돌바닥을 조심스럽게 살핀다. 작은 생물과 먹을 수 있는 식물을 찾는다.");
        const roll = Math.random();
        if (roll < 0.24) {
          await typeLine("바위 틈에서 갓 돋은 식용 버섯을 발견했다. 갓과 줄기를 살펴 독성이 없어 보이는 것만 챙긴다.", "find");
          addItem("버섯", true);
        } else if (roll < 0.47) {
          await typeLine("물기 머금은 바위 옆에서 연한 고사리 순을 몇 개 발견했다.", "find");
          addItem("고사리", true);
        } else if (roll < 0.74) {
          await typeLine("얕은 물웅덩이 아래로 숨던 가재를 발견했다. 조심스럽게 집어 올린다.", "find");
          addItem("가재", true);
        } else if (roll < 0.93) {
          await typeLine("물방울이 모인 웅덩이에서 작은 새우 몇 마리를 건져 올렸다.", "find");
          addItem("새우", true);
        } else {
          await typeLine("바위 틈과 물웅덩이를 뒤졌지만 먹을 만한 것은 찾지 못했다.");
          state.sanity -= 1;
        }
        state.hunger -= 2;
        state.thirst -= 3;
      }
    }
    spendAction();
  }

  // 구명보트 발견과 출항 준비는 별도의 과정이다. 잘못된 출항은 자원·체력 손실을 낳는다.
  async function tryLifeboat() {
    if (!isLowTide()) {
      await typeLine("밀물이 바위 틈을 덮었다. 보트에 손을 대려는 순간 파도가 발목을 휩쓴다. 간조까지 기다려야 한다.", "danger");
      state.hp -= 2;
      state.sanity -= 1;
      bonusNote(-4, "밀물 때 무리하게 접근했다");
      clamp();
      updateHud();
      return false;
    }
    if (!hasFlag("구명보트발견")) {
      addFlag("구명보트발견");
      await typeLine("간조가 되자 바위 틈 안쪽에서 방수포가 드러난다. 걷어 내자 세레니티호의 구명보트가 모습을 드러낸다!", "find");
      await typeLine("하지만 밑바닥 솔기가 갈라져 있고, 물을 막아 줄 덮개는 헐거우며 노도 보이지 않는다. 이 상태로 출항하면 암초 앞에서 가라앉을 수 있다.", "danger");
      await typeLine("선체를 수리하고 노를 찾은 다음, 절벽에서 해류를 살펴 안전한 출항 방향을 확인해야 한다.", "system");
      state.sanity += 4;
      clamp();
      updateHud();
      return false;
    }
    if (state.hp < 40 || state.hunger < 20 || state.thirst < 20) {
      await typeLine("보트를 끌어낼 힘이 부족하다. 출항 전 체력 40, 포만 20, 수분 20 이상을 확보하자.", "system");
      state.sanity -= 1;
      clamp();
      updateHud();
      return false;
    }
    if (!hasFlag("구명보트선체수리")) {
      await typeLine("보트를 물가로 밀자 갈라진 선체 틈으로 바닷물이 쏟아져 들어온다! 허겁지겁 암초 위로 끌어 올리지만, 안쪽이 흠뻑 젖었다.", "danger");
      state.hp -= 5;
      state.thirst -= 3;
      state.sanity -= 4;
      bonusNote(-12, "수리되지 않은 선체에서 누수 발생");
      clamp();
      updateHud();
      return false;
    }
    if (!hasItem("노")) {
      await typeLine("노도 없이 파도에 몸을 맡겼다가 보트가 옆으로 밀려 암초에 부딪힌다. 선체가 다시 긁히고 팔에 충격이 온다.", "danger");
      state.hp -= 8;
      state.sanity -= 5;
      state.thirst -= 3;
      bonusNote(-15, "노 없이 출항해 암초에 충돌");
      clamp();
      updateHud();
      return false;
    }
    if (!hasFlag("보트항로확인")) {
      await typeLine("암초 바깥으로 나가자 교차 해류가 보트를 옆으로 잡아챈다. 방향을 잘못 잡았다는 걸 깨달았을 때는 이미 암초가 코앞이다. 간신히 빠져나오지만 다시 방향을 살펴야 한다.", "danger");
      state.hp -= 4;
      state.sanity -= 6;
      state.thirst -= 3;
      bonusNote(-10, "해류를 파악하지 못해 출항 실패");
      clamp();
      updateHud();
      return false;
    }
    if (state.weather === "storm") {
      await typeLine("출항하려는 순간 돌풍이 돛처럼 펼쳐진 방수포를 낚아챈다. 파도가 보트를 뒤집을 듯 덮쳐 와, 간신히 암초 안쪽으로 돌아온다.", "danger");
      state.hp -= 9;
      state.sanity -= 5;
      state.thirst -= 4;
      if (Math.random() < 0.35) {
        removeItem("노");
        await typeLine("거센 파도에 노 하나가 손에서 빠져나가 바다로 사라졌다.", "danger");
      }
      bonusNote(-18, "폭풍 속 출항 실패");
      clamp();
      updateHud();
      return false;
    }
    const successChance = (state.role === "navigator" ? 0.9 : state.role === "sailor" ? 0.82 : 0.72) - (state.weather === "cloud" ? 0.12 : 0);
    if (Math.random() >= successChance) {
      await typeLine("출항은 시작됐지만, 암초를 돌아 나가는 순간 큰 파도가 보트를 옆으로 밀어붙인다. 노로 버텨 보지만 선체가 바위에 부딪혀 다시 해안으로 밀려난다.", "danger");
      state.hp -= 6;
      state.sanity -= 4;
      state.thirst -= 3;
      if (Math.random() < 0.25) {
        removeItem("노");
        await typeLine("충돌로 노가 부러졌다. 다시 쓸 노를 찾아야 한다.", "danger");
      }
      bonusNote(-12, "출항 도중 파도에 밀려남");
      clamp();
      updateHud();
      return false;
    }
    await typeLine("선체의 물기를 걷어 내고, 노를 단단히 쥔다. 절벽에서 확인한 해류를 따라 파도 사이로 보트를 밀어 넣는다.");
    await typeLine("한 차례 큰 파도가 보트를 들어 올리지만 이번에는 방향을 잃지 않는다. 암초가 뒤로 멀어지고 수평선 너머로 바다가 열린다!", "find");
    state.ending = "lifeboat";
    state.alive = false;
    clamp();
    updateHud();
    return true;
  }

  async function repairLifeboat() {
    if (hasFlag("구명보트선체수리")) {
      await typeLine("선체 보강은 이미 끝났다. 패치가 단단히 붙어 있는지 다시 눌러 확인한다.", "system");
      state.sanity += 1;
      return;
    }
    if (hasItem("밧줄") && hasItem("돛천")) {
      removeItem("밧줄");
      removeItem("돛천");
      addFlag("구명보트선체수리");
      await typeLine("돛천을 여러 겹으로 접어 균열을 덮고 밧줄로 가장자리를 단단히 묶는다. 물을 조금 부어 확인하니 더는 새지 않는다.", "find");
    } else if (hasItem("밧줄") && hasItem("판자")) {
      removeItem("밧줄");
      removeItem("판자");
      addFlag("구명보트선체수리");
      await typeLine("판자를 갈라진 부분 위에 대고 밧줄로 단단히 고정한다. 임시 수리지만 출항은 견딜 수 있을 것 같다.", "find");
    } else {
      await typeLine("균열을 막을 재료가 부족하다. 밧줄과 돛천, 또는 밧줄과 판자가 필요하다.", "system");
      state.sanity -= 1;
    }
    clamp();
    updateHud();
  }

  async function searchLifeboatOars() {
    if (hasItem("노")) {
      await typeLine("쓸 만한 노는 이미 챙겼다. 더 찾을 필요는 없다.", "system");
      return;
    }
    const chance = (isLowTide() ? 0.72 : 0.42) + (state.role === "navigator" ? 0.12 : 0);
    await typeLine("암초와 해안 잔해 사이를 뒤져 구명보트에 맞는 노를 찾는다. 파도에 밀린 나무 조각들이 발목을 친다.");
    if (Math.random() < Math.min(0.9, chance)) {
      addItem("노");
      await typeLine("바위 틈에 걸린 한 쌍의 노를 찾아냈다. 손잡이는 거칠지만 아직 쓸 만하다.", "find");
      state.sanity += 2;
    } else {
      await typeLine("노처럼 보이는 긴 나무는 산호에 갈라져 있었다. 갑자기 밀려든 파도에 몸을 부딪히고 만다.", "danger");
      state.hp -= 4;
      state.sanity -= 2;
      state.thirst -= 3;
      bonusNote(-5, "노 수색 중 파도에 휩쓸림");
    }
    clamp();
    updateHud();
  }

  async function sceneReef() {
    state.place = "reef";
    state.phase = "day";
    updateSceneImage();
    updateHud();

    if (!hasFlag("암초첫방문")) {
      addFlag("암초첫방문");
      await typeLine("파도가 부서지는 암초 지대. 물속으로 물고기 그림자가 스친다.");
      await typeLine("바위 틈 사이로 작은 게들이 분주히 움직인다.");
    } else {
      await typeLine(
        pick([
          "소금기 섞인 물보라가 얼굴에 튄다. 발밑 바위가 미끄럽다.",
          "파도가 밀려올 때마다 암초 틈에서 하얀 거품이 솟구친다.",
          "멀리 수평선 위로 갈매기 몇 마리가 낮게 날아간다.",
        ])
      );
    }

    await stormHazard();
    if (!state.alive) return;
    await reefTide();
    if (!state.alive) return;
    await placeHazard("reef");
    if (!state.alive) return;
    const reefOptions = [
      [0, "물고기를 잡는다"],
      [1, "바다를 향해 구조 신호를 보낸다"],
      [2, "조개를 줍는다"],
      [3, "암초 틈 표류목을 찾는다"],
      [4, hasFlag("암초휴식오늘") ? "잠시 더 휴식" : "파도가 덜 닿는 바위 뒤에서 숨을 고른다"],
      ...(hasFlag("보트단서") ? [[5, hasFlag("구명보트발견") ? "구명보트로 탈출을 시도한다" : "구명보트를 찾아 나선다"]] : []),
      ...(hasFlag("구명보트발견") && !hasFlag("구명보트선체수리") ? [[6, "구명보트 선체를 수리한다"]] : []),
      ...(hasFlag("구명보트발견") && !hasItem("노") ? [[7, "암초와 해안에서 노를 찾는다"]] : []),
      [8, shelterActionLabel()],
    ];
    const sel = await choose("무엇을 할까?", reefOptions.map((o) => o[1]));
    if (sel < 0) return;
    const c = reefOptions[sel][0];
    if (c === 5) {
      const escaped = await tryLifeboat();
      if (escaped) return;
      spendAction();
      clamp();
      updateHud();
      return;
    }
    if (c === 6) {
      await repairLifeboat();
      spendAction();
      clamp();
      updateHud();
      return;
    }
    if (c === 7) {
      await searchLifeboatOars();
      spendAction();
      clamp();
      updateHud();
      return;
    }
    if (c === 4) {
      if (hasFlag("암초휴식오늘")) {
        await typeLine("잠시 더 휴식을 취하려 하지만, 밀려드는 물보라가 거세져 제대로 쉬기 어렵다.", "system");
      } else {
        addFlag("암초휴식오늘");
        if (isLowTide()) {
          await typeLine("파도가 덜 닿는 바위 뒤에 앉아 호흡을 고른다. 잔물결과 갈매기 소리를 들으며 긴장을 풀자 몸과 마음이 조금씩 안정된다.");
          state.hp += 4;
          state.sanity += 5;
        } else {
          await typeLine("바위 뒤에 몸을 붙이고 잠시 숨을 고른다. 만조의 물보라가 가까워 오래 쉴 수는 없다.");
          state.hp += 2;
          state.sanity += 3;
        }
        state.hunger -= 2;
        state.thirst -= 3;
      }
      spendAction();
      clamp();
      updateHud();
      return;
    }
    if (c === 8) {
      await buildShelterAtCurrentPlace();
      spendAction();
      clamp();
      updateHud();
      return;
    }
    if (c === 0) {
      if (hasItem("창") || hasItem("칼") || hasItem("밧줄") || Math.random() < 0.35) {
        if (Math.random() < (isLowTide() ? 0.7 : 0.92)) {
          await typeLine("작은 물고기를 잡았다! 배불리 먹는다…");
          state.hunger += (hasItem("창") ? 36 : 28) + (state.role === "fisher" ? 5 : 0) + (isLowTide() ? 0 : 5); // 도구·직업·만조 위험에 따른 보상
          state.hp += 5;
          const illnessChance = state.role === "medic" ? 0.12 : 0.3;
          if (!hasItem("성냥") && Math.random() < illnessChance) {
            await typeLine("익히지 못해 배가 약간 불편하다.");
        afflict("stomach", 2);
            state.hp -= 3;
          }
        } else {
          await typeLine("미끄러져 빠져나갔다. 헛수고였다.");
          state.hunger -= 2;
          state.thirst -= 3;
        }
      } else {
        await typeLine("맨손으로는 잡기 어렵다. 도구가 있으면 더 나을 것 같다.");
        state.sanity -= 1;
      }
    } else if (c === 1) {
      if (hasItem("성냥")) {
        if (Math.random() < (state.weather === "storm" ? 0.05 : 0.3)) {
          await typeLine("모닥불을 피워 연기를 올린다!");
          addFlag("신호");
          state.sanity += 12;
          if (hasShelterAt(state.place)) {
            await typeLine("이곳의 은신처 옆에서 불을 키우니 연기가 멀리까지 뻗는다.");
            addFlag("강한신호");
          } else {
            await typeLine("멀리 수평선이 흐릿하다… 어쩌면 배가?");
          }
        } else {
          const failLines = [
            "나뭇가지가 축축해서 불이 쉽게 붙지 않는다. 가느다란 연기만 피어오르다 꺼진다.",
            "막 불씨가 붙으려는 순간, 거센 바람이 불어와 불씨를 날려버린다.",
            "연기가 피어오르기도 전에 먹구름이 몰려와 소나기가 쏟아진다.",
            "성냥을 몇 개나 긁었지만 눅눅해서 불이 붙지 않는다.",
          ];
          await typeLine(pick(failLines));
          await typeLine("멀리서 지켜볼 사람은 없었던 것 같다…");
          state.sanity -= 4;
          state.hunger -= 2;
          state.thirst -= 3;
          if (Math.random() < 0.2) {
            await typeLine("연기를 들이마셔 기침이 멈추지 않는다.");
            state.hp -= 3;
          }
        }
      } else {
        await typeLine("불을 피울 수단이 없다. 소리만 질러본다.");
        state.sanity -= 3;
        state.thirst -= 4;
      }
    } else if (c === 2) {
      await typeLine("조개 몇 개를 주워 껍질을 깐다.");
      state.hunger += isLowTide() ? 24 : 14;
      state.thirst -= 1;
      if (isLowTide() && !hasItem("구급상자") && Math.random() < 0.12) {
        await typeLine("조개를 줍다 바위 틈에 끼어 있는 방수 상자를 발견했다 — 구급상자다!");
        addItem("구급상자");
      }
      if (Math.random() < 0.08) {
        await typeLine("날카로운 껍질에 손을 베였다.");
        state.hp -= 4;
      }
    } else if (c === 3) {
      if (!hasItem("판자") && Math.random() < (isLowTide() ? 0.85 : 0.4)) {
        await typeLine("암초 틈에 박힌 판자 한 장을 힘겹게 빼냈다.");
        addItem("판자");
      } else if (Math.random() < 0.15) {
        await typeLine("날카로운 산호에 발을 베였다!");
        afflict("injury", 2);
        state.hp -= 6;
        state.sanity -= 2;
      } else {
        await typeLine("쓸 만한 나뭇조각은 더 보이지 않는다.");
        state.sanity -= 1;
      }
      state.thirst -= 2;
    }
    spendAction();
  }

  // 소지품 행을 눌렀을 때 바로 처리하는 아이템별 이벤트
  async function useInventoryItem(item) {
    if (!hasItem(item)) return;
    if (item === "생존 수첩") {
      showHints();
      updateHud();
      return;
    }
    if (item === "물병(가득)") return quickUse("drink");
    if (item === "유리병(물)") return quickUse("drinkGlass");
    if (item === "바나나") return quickUse("banana");
    const caveFood = {
      "버섯": { hunger: 12, hp: 0, sanity: 1, line: "식용 버섯을 조심스럽게 씹는다. 흙내가 조금 나지만 허기가 가신다." },
      "고사리": { hunger: 14, hp: 1, sanity: 1, line: "연한 고사리 순을 먹는다. 풋풋한 맛이 입안에 퍼진다." },
      "가재": { hunger: 22, hp: 2, sanity: 0, line: "가재 살을 발라 먹는다. 적은 양이지만 단백질이 몸에 힘을 보탠다." },
      "새우": { hunger: 18, hp: 1, sanity: 0, line: "작은 새우를 먹는다. 바다의 짠 향이 나며 허기가 조금 가신다." },
    };
    if (caveFood[item]) {
      const food = caveFood[item];
      await typeLine(food.line);
      removeItem(item);
      state.hunger += food.hunger;
      state.hp += food.hp;
      state.sanity += food.sanity;
      if ((item === "가재" || item === "새우") && !hasItem("성냥") && !hasFlag("오늘모닥불") && Math.random() < (item === "가재" ? 0.12 : 0.15)) {
        await typeLine("충분히 익히지 못한 갑각류 탓인지 속이 뒤틀린다. 복통이 시작된다.", "danger");
        afflict("stomach", 2);
        state.hp -= 3;
        state.sanity -= 2;
      }
      clamp();
      updateHud();
      return;
    }
    if (item === "구급상자") {
      await typeLine("구급상자를 열어 상처를 소독하고 붕대를 감는다.");
      removeItem("구급상자");
      (state.role === "medic" ? ["injury", "fever", "stomach", "cold"] : ["injury", "fever", "stomach"]).forEach((k) => delete state.status[k]);
      state.hp += 20;
      state.sanity += 4;
      spendAction();
      say("구급상자를 사용했다.", "system");
      updateHud();
      return;
    }
    if (item === "낡은 일기장") {
      const entry = JOURNAL_ENTRIES[state.journalPage % JOURNAL_ENTRIES.length];
      await typeLine(entry);
      state.journalPage += 1;
      state.sanity += 2;
      if (state.journalPage >= (state.role === "navigator" ? 3 : 5) && !hasFlag("보트단서")) {
        addFlag("보트단서");
        await typeLine("마지막 장 귀퉁이에 거칠게 그린 지도가 있다. ‘암초 너머 바위 틈에 구명보트를 숨겨 두었다.’", "find");
        await typeLine("일기장에는 선체가 손상됐다는 짧은 기록도 있다. 밧줄과 천, 노와 안전한 항로를 준비하지 않으면 위험할 것이다.", "system");
      }
      clamp();
      updateHud();
      return;
    }
    if ((item === "빈 물병" || item === "유리병") && state.place === "cave") {
      await typeLine("바위틈에서 떨어지는 맑은 물을 용기에 받는다.");
      if (item === "빈 물병") {
        removeItem("빈 물병");
        addItem("물병(가득)");
      } else {
        removeItem("유리병");
        addItem("유리병(물)");
      }
      state.thirst += 8;
      spendAction();
      clamp();
      updateHud();
      return;
    }
    if (item === "빈 물병" || item === "유리병") {
      await typeLine(`${item}을(를) 채우려면 동굴의 민물이나 깨끗한 물을 찾는 편이 좋겠다.`, "system");
      return;
    }
    const descriptions = {
      "성냥": "성냥은 모닥불이나 구조 신호를 피울 때 쓸 수 있다. 폭풍이 불 때는 동굴 밖에서 불을 지키기 어렵다.",
      "칼": "날이 선 칼은 대나무를 자르고 은신처를 보강할 때 유용하다.",
      "창": "창은 사냥과 낚시에 도움이 된다. 멧돼지와 마주쳤을 때도 든든한 도구다.",
      "밧줄": "밧줄은 뗏목을 엮거나 구명보트 선체를 보강하는 데 쓸 수 있다.",
      "돛천": "튼튼한 돛천은 뗏목의 돛이나 구명보트 선체의 임시 패치로 쓸 수 있다.",
      "판자": "판자는 뗏목 재료이자 구명보트에 난 틈을 막을 임시 보강재다.",
      "대나무": "대나무는 뗏목이나 간이 도구의 재료다.",
      "노": "구명보트에 맞는 노다. 출항 전에 챙기고 놓치지 않도록 하자.",
      "나침반": "낡았지만 쓸 만한 나침반이다. 주변 지형과 일기의 기록을 함께 살펴 방향을 판단하자.",
      "신호거울": "햇빛을 반사해 하늘을 지나는 비행기에 신호를 보낼 수 있다.",
      "조개목걸이": "조개를 엮은 목걸이다. 살아남았다는 작은 증표처럼 느껴진다.",
    };
    await typeLine(descriptions[item] || `${item}을 살펴본다. 지금은 바로 사용할 수 없지만, 필요한 순간에 쓸모가 있을지 모른다.`, "system");
  }

  const TRAVEL_TEXT = {
    "beach>jungle": "모래사장을 가로질러 어두운 밀림 속으로 발을 들인다.",
    "jungle>beach": "나뭇가지를 헤치며 밀림을 벗어나 다시 해변으로 향한다.",
    "beach>reef": "젖은 모래를 따라 물보라가 이는 암초 쪽으로 걸어간다.",
    "reef>beach": "바위를 밟으며 암초에서 해변으로 돌아온다.",
    "jungle>reef": "덤불을 헤치고 바닷소리가 나는 암초 쪽으로 내려간다.",
    "reef>jungle": "미끄러운 바위를 벗어나 숲 그늘로 올라간다.",
    "jungle>cave": "발자국이 이어진 바위틈 길을 따라 동굴로 향한다.",
    "cave>jungle": "동굴을 나와 눈부신 밀림으로 돌아간다.",
    "jungle>cliff": "가파른 비탈을 붙잡고 언덕 위로 오른다.",
    "cliff>jungle": "바람 부는 언덕을 내려와 밀림으로 돌아간다.",
  };

  // 목적지까지 거쳐 갈 장소들 (발견한 장소만 지난다). 연결되어 있지 않으면 null.
  function routeTo(from, to) {
    if (from === to) return [];
    const prev = { [from]: null };
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of neighborsOf(cur)) {
        if (n in prev) continue;
        prev[n] = cur;
        if (n === to) {
          const path = [];
          for (let k = to; k !== from; k = prev[k]) path.unshift(k);
          return path;
        }
        queue.push(n);
      }
    }
    return null;
  }

  // 낮 행동 한 번: 이동 요청이 있으면 길을 떠나고, 지금 있는 장소의 장면(메뉴 포함)을 연다.
  // 이동은 따로 묻지 않는다 — 각 장소 메뉴 맨 아래의 '→ 장소 이동'이나 지도·3D 이동으로 요청된다.
  async function moveMenu() {
    let key = state.place;
    if (pendingTravel) {
      const dest = pendingTravel;
      pendingTravel = null;
      const path = dest !== key && MAP_NODES[dest] ? routeTo(key, dest) : null;
      if (path && path.length) {
        let from = key;
        for (const next of path) {
          sfx("move");
          await typeLine(TRAVEL_TEXT[`${from}>${next}`] || `${PLACE_LABEL[next]} 쪽으로 길을 나선다…`, "system");
          state.hunger -= 2;
          state.thirst -= 3;
          clamp();
          updateHud();
          if (!state.alive) return;
          from = next;
        }
        key = dest;
      }
    }

    if (key === "beach") await sceneBeach();
    else if (key === "jungle") await sceneJungle();
    else if (key === "reef") await sceneReef();
    else if (key === "cave") await sceneCave();
    else if (key === "cliff") await sceneCliff();
  }

  async function nightEvent() {
    state.phase = "night";
    updateSceneImage(); // 밤 배경 이미지로 전환
    await typeLine(`Day ${state.day} - 밤`, "daypart");
    const shelterHere = hasShelterAt(state.place);
    const shelterTier = shelterHere ? shelterUpgradeLevel(state.place) : 0;
    if (shelterHere) {
      const restText = shelterTier >= 2
        ? `${PLACE_LABEL[state.place]}에 보강한 은신처에서 마른 잎 침상에 몸을 누이고 따뜻하게 잠을 잔다.`
        : shelterTier === 1
          ? `${PLACE_LABEL[state.place]}에 지붕을 보강한 은신처에서 비바람을 피하며 잠을 잔다.`
          : `${PLACE_LABEL[state.place]}에 세운 은신처에서 비를 피하며 잠을 잔다.`;
      await typeLine(restText, "night");
      state.hp += shelterTier >= 2 ? 10 : shelterTier === 1 ? 9 : 7;
      state.sanity += shelterTier >= 2 ? 7 : shelterTier === 1 ? 6 : 5;
    } else {
      await typeLine("은신처가 없어 밤이슬과 벌레에 시달린다. 잠을 설친다.", "night");
      const shelterHint = `숙면을 취하려면 현재 머무는 ${PLACE_LABEL[state.place]}에서 구할 수 있는 재료로 은신처를 마련해야 할 것 같다.`;
      if (!Array.isArray(state.shownHints)) state.shownHints = [];
      if (!state.shownHints.includes(shelterHint)) {
        await typeLine(shelterHint, "system");
        state.shownHints.push(shelterHint);
      }
      state.hp -= 4;
      state.sanity -= 4;
    }

    await nightChill();
    if (hasFlag("오늘모닥불")) {
      if (hasFlag("야간임시모닥불")) {
        await typeLine("급히 피운 작은 불씨가 잠깐 온기를 보탠다. 밤을 버티는 데는 도움이 되지만, 오래 타지는 않는다.", "night");
        state.hp += 2;
        state.sanity += 2;
      } else {
        await typeLine("모닥불의 온기가 밤을 견디게 한다.", "night");
        state.hp += 6;
        state.sanity += 5;
      }
    }
    if (hasFlag("집수기")) {
      await typeLine("집수기에 밤이슬이 맺혔다.", "night");
      state.thirst += 8;
    }
    await applyStatusEffects();
    if (Math.random() < 0.28) {
      await typeLine("갑자기 거센 비가 쏟아진다!", "night");
      if (!hasShelterAt(state.place)) {
        state.hp -= 2;
        state.sanity -= 2;
        if (Math.random() < 0.5) afflict("cold", 3);
      } else {
        await typeLine(shelterTier >= 1
          ? "보강한 풀잎 지붕이 빗물을 받아 모았다. 비바람에도 안쪽은 마른 채로 유지된다."
          : "은신처 덕분에 비바람을 버틴다. 빗물을 모을 수 있었다.", "night");
        state.thirst += shelterTier >= 2 ? 24 : shelterTier === 1 ? 21 : 18;
      }
    }
    if (Math.random() < 0.15) {
      await typeLine(
        "꿈속에서 도시의 불빛이 스친다… 깨어나니 더 외롭다.",
        "night"
      );
      state.sanity -= 3;
    }
    let rescueChance = hasFlag("강한신호") ? 0.36 : hasFlag("신호") ? 0.2 : 0;
    if (rescueChance > 0 && hasFlag("지형파악")) rescueChance += 0.07;
    if (rescueChance > 0 && hasFlag("항공신호")) rescueChance += state.role === "pilot" ? 0.1 : 0.05;
    if (Math.random() < rescueChance) {
      await typeLine("!!! 수평선에 불빛이 보인다. 배가 다가오는 것 같다!", "night");
      addFlag("구조임박");
    }

    clamp();
    updateHud();
  }

  // 장소마다 하루 한 번, 환경 위험 이벤트를 판정한다. 이동을 반복해 같은 위험이 연속 발생하는 것을 막는다.
  async function placeHazard(place) {
    const dailyFlag = {
      beach: "해변위협오늘",
      jungle: "밀림위협오늘",
      reef: "암초위협오늘",
      cave: "동굴위협오늘",
      cliff: "절벽위협오늘",
    }[place];
    if (!dailyFlag || hasFlag(dailyFlag)) return false;
    addFlag(dailyFlag);

    let chance = { beach: 0.14, jungle: 0.16, reef: 0.15, cave: 0.14, cliff: 0.16 }[place] || 0.15;
    if (place === "reef" && !isLowTide()) chance += 0.05;
    if (place === "cliff" && state.weather === "storm") chance += 0.06;
    if (state.diff === "easy") chance -= 0.04;
    else if (state.diff === "hard") chance += 0.06;
    if (state.role === "explorer") chance -= 0.03;
    if (state.role === "survivalist") chance -= 0.01;
    if (state.role === "sailor" && ["beach", "reef"].includes(place)) chance -= 0.02;
    chance = Math.max(0.06, Math.min(0.30, chance));
    if (Math.random() >= chance) return false;

    if (place === "beach") {
      if (Math.random() < 0.56) {
        await typeLine("갑작스러운 이안류가 다리를 낚아챈다! 물살에 휩쓸려 한참을 허우적댄 끝에 간신히 모래 위로 기어 나온다.", "danger");
        state.hp -= 6;
        state.sanity -= 5;
        state.thirst -= 3;
        if (Math.random() < 0.25) afflict("injury", 2);
      } else {
        await typeLine("얕은 물에 발을 담그는 순간 해파리에 쏘였다! 타는 듯한 통증과 공포에 숨이 가빠진다.", "danger");
        state.hp -= 4;
        state.sanity -= 5;
        if (Math.random() < 0.35) afflict("injury", 2);
      }
    } else if (place === "jungle") {
      if (Math.random() < 0.48) {
        await typeLine("덤불 속 벌집을 건드렸다! 벌떼가 얼굴과 팔을 쏘며 달려들어, 나뭇가지 사이로 황급히 몸을 피한다.", "danger");
        state.hp -= 4;
        state.sanity -= 5;
        if (Math.random() < 0.18) afflict("injury", 2);
      } else {
        await typeLine("발목이 가시덩굴에 걸려 넘어졌다. 날카로운 가시가 종아리를 깊게 긁는다.", "danger");
        state.hp -= 5;
        state.sanity -= 3;
        state.hunger -= 2;
        if (Math.random() < 0.45) afflict("injury", 3);
      }
    } else if (place === "reef") {
      await typeLine(isLowTide()
        ? "드러난 암초를 건너다 젖은 이끼를 밟고 미끄러진다! 팔과 무릎이 날카로운 바위에 부딪힌다."
        : "만조의 파도가 발밑 바위를 덮친다. 균형을 잃고 암초에 넘어져 겨우 물 밖으로 기어 나온다!", "danger");
      state.hp -= isLowTide() ? 5 : 7;
      state.sanity -= 4;
      state.thirst -= 2;
      if (Math.random() < 0.48) afflict("injury", 3);
    } else if (place === "cave") {
      await typeLine("천장에 매달려 있던 박쥐 떼가 갑자기 머리 위로 쏟아져 나온다! 날갯짓과 날카로운 울음소리에 놀라 바위에 어깨를 부딪힌다.", "danger");
      state.hp -= 4;
      state.sanity -= 6;
      if (Math.random() < 0.22) afflict("injury", 2);
    } else if (place === "cliff") {
      if (state.weather === "storm") {
        await typeLine("폭풍 돌풍이 몸을 옆으로 밀어낸다! 발을 헛디뎌 자갈 비탈로 구르며 간신히 바위턱을 붙잡는다.", "danger");
        state.hp -= 8;
        state.sanity -= 6;
        if (Math.random() < 0.55) afflict("injury", 3);
      } else {
        await typeLine("갑작스러운 돌풍이 절벽 끝에서 몸을 밀어낸다. 비틀거리며 넘어져 바위에 팔을 부딪힌다.", "danger");
        state.hp -= 5;
        state.sanity -= 4;
        if (Math.random() < 0.35) afflict("injury", 2);
      }
    }

    clamp();
    updateHud();
    return true;
  }

  async function randomDayEvent() {
    if (Math.random() >= 0.35) return;

    const events = [];

    events.push(async () => {
      await typeLine("벌레에 물렸다. 가려움이 가시지 않는다.", "system");
        if (Math.random() < 0.3) afflict("fever", 4);
      state.hp -= 2;
      state.sanity -= 1;
    });

    // 바다가 보이는 곳(해변·암초·절벽)에서만 돌고래를 볼 수 있다
    if (["beach", "reef", "cliff"].includes(state.place)) {
      events.push(async () => {
        await typeLine(
          state.place === "cliff" ? "절벽 아래, 먼 바다 위로 돌고래 떼가 뛰어오른다." : "먼 바다 위로 돌고래 떼가 뛰어오른다.",
          "system"
        );
        state.sanity += 7;
      });
    }


    events.push(async () => {
      await typeLine("속이 메스껍다. 상한 음식을 먹었던 모양이다.", "system");
        afflict("stomach", 2);
      state.hp -= 4;
      state.hunger -= 3;
    });

    // 발자국은 그 장소의 바닥에 맞는 문장으로, 발자국이 남을 만한 곳(해변·밀림·동굴)에서만 나온다
    const FOOTPRINT = {
      beach: "모래 위에 낯선 발자국이 나 있다. 당신의 것이 아니다.",
      jungle: "축축한 흙 위에 낯선 발자국이 찍혀 있다. 당신의 것이 아니다.",
      cave: "동굴 바닥의 젖은 흙에 낯선 발자국이 남아 있다. 당신의 것이 아니다.",
    };
    if (FOOTPRINT[state.place]) {
      events.push(async () => {
        await typeLine(FOOTPRINT[state.place], "system");
        state.sanity -= 2;
      });
    }

    if (state.place === "beach" || state.place === "reef") {
      events.push(async () => {
        await typeLine("얕은 물가에서 은빛 물고기 떼가 발밑을 스쳐 간다!", "system");
        const k = await choose("어떻게 할까?", ["재빨리 낚아챈다", "숨을 죽이고 기다린다"]);
        if (k < 0) return;
        const armed = hasItem("창") || hasItem("칼");
        if (k === 0 ? Math.random() < (armed ? 0.7 : 0.45) : Math.random() < 0.75) {
          await typeLine(
            k === 0
              ? "물살을 가르며 큼직한 물고기를 낚아챘다! 단번에 배가 든든해진다."
              : "기다린 끝에 얕은 곳에 갇힌 물고기를 손쉽게 건져 올렸다."
          );
          state.hunger += k === 0 ? 24 : 14;
          state.sanity += 4;
          bonusNote(k === 0 ? 10 : 5, k === 0 ? "물고기 떼를 놓치지 않았다" : "침착하게 기다려 얻었다");
        } else {
          await typeLine("물고기 떼가 순식간에 흩어졌다. 허탕이다.");
          state.sanity -= 2;
        }
      });
    }
    if (state.place === "beach") {
      events.push(async () => {
        await typeLine("밤새 파도가 큰 유목 하나를 해변 위로 밀어 올려놓았다.", "system");
        if (!hasItem("판자")) {
          await typeLine("쓸 만한 널빤지를 뜯어낸다.");
          addItem("판자");
        } else {
          await typeLine("마른 부분을 떼어 모닥불감으로 챙겨 둔다.");
          state.sanity += 3;
        }
      });
    }

    const chosen = pick(events);
    await chosen();
    clamp();
    updateHud();
  }

  async function gameLoop(id) {
    showScreen("play");
    updateHud();
    liveDrain = true;
    liveAcc.hunger = liveAcc.thirst = liveAcc.sanity = liveAcc.hp = 0;

    while (state.alive && isActive(id)) {
      if (checkVictory()) break;

      state.phase = "day";
      state.actionPoints = baseActionPoints();
      if (state.status.cold || state.status.fever) {
        state.actionPoints = Math.max(2, state.actionPoints - 1);
      }
      state.apStart = state.actionPoints;
      const wr = Math.random();
      state.weather = wr < (state.diff === "hard" ? 0.28 : 0.18) ? "storm" : wr < 0.5 ? "cloud" : "clear";
      updateSceneImage();
      say(`Day ${state.day} - 낮`, "daypart");
      say(
        `오늘은 ${state.actionPoints}번 움직이거나 행동할 수 있다. 날씨는 ${WEATHER_LABEL[state.weather]}이다.${state.weather === "storm" ? " 폭풍이 몰아친다 — 암초와 절벽은 위험하다." : ""}`,
        "system"
      );
      updateHud();

      await randomDayEvent();
      if (!isActive(id)) return;
      if (!state.alive) break;
      if (checkVictory()) break;

      while (state.actionPoints > 0 && state.alive && isActive(id)) {
        await moveMenu();
        if (!isActive(id)) return;
        if (!state.alive) break;
        if (checkVictory()) break;
      }
      if (!isActive(id)) return;
      if (!state.alive) break;
      if (checkVictory()) break;

      await nightEvent();
      if (!isActive(id)) return;
      if (!state.alive) break;
      if (checkVictory()) break;

      tickDay();
      updateHud();
    }

    if (isActive(id)) {
      liveDrain = false;
      await finalBeat();
      if (isActive(id)) showEnding();
    }
  }

  async function startNewGame(settings = {}) {
    stopRun();
    const id = runId;
    const selectedDiff = ["easy", "normal", "hard"].includes(settings.diff) ? settings.diff : "normal";
    state = freshState(selectedDiff);
    lastTide = null;
    pendingTravel = null;
    clearLog();
    clearChoices();

    // 이름·난이도·역할은 타이틀 화면의 설정 모달에서 미리 선택한다.
    const playerName = String(settings.name ?? "").replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 12) || "표류자";
    state.playerName = playerName;
    store.setName(playerName);
    const done = new Set(readRecords().map((r) => r.ending));
    let roleChoice = ROLES.findIndex((r) => r.id === settings.role && roleUnlocked(r, done));
    if (roleChoice < 0) roleChoice = 0;

    showScreen("play");
    updateSceneImage();

    await typeLine("폭풍우가 배를 삼켰다.");
    if (!isActive(id)) return;
    await typeLine("정신을 잃기 직전, 지나온 날들이 어지럽게 스쳐 지나간다.");
    if (!isActive(id)) return;

    applyRole(roleChoice);
    if (!isActive(id)) return;
    await typeLine("눈을 떠보니, 낯선 해변. 머릿속이 울린다.");
    if (!isActive(id)) return;
    await typeLine("멀리서 갈매기 울음소리만 들린다…");
    if (!isActive(id)) return;

    await typeLine("당신은 일어선다. 살아남기 위해.");
    if (!isActive(id)) return;
    await gameLoop(id);
  }

  async function resumeGame() {
    stopRun();
    lastTide = null;
    pendingTravel = null;
    const id = runId;
    clearLog();
    clearChoices();
    showScreen("play");
    updateSceneImage();
    say(
      `저장된 생존을 이어갑니다. (Day ${state.day} · ${PLACE_LABEL[state.place] || state.place})`,
      "system"
    );
    updateHud();
    await gameLoop(id);
  }

  // —— 저장 / 불러오기 ——
  function serializeState() {
    return {
      savedAt: new Date().toISOString(),
      state: {
        day: state.day,
        hp: state.hp,
        hunger: state.hunger,
        thirst: state.thirst,
        sanity: state.sanity,
        inventory: [...state.inventory],
        flags: [...state.flags],
        alive: state.alive,
        ending: state.ending,
        place: state.place,
        phase: state.phase,
        role: state.role,
        actionPoints: state.actionPoints,
        journalPage: state.journalPage,
        shownHints: [...(state.shownHints || [])],
        diff: state.diff,
        status: { ...state.status },
        playerName: state.playerName,
        bonus: state.bonus,
        crises: state.crises,
        searchTries: state.searchTries,
      },
    };
  }

  function isDiscovered(k) {
    if (k === "cave") return hasFlag("동굴발견");
    if (k === "cliff") return hasFlag("절벽발견");
    return true;
  }

  // 지금 있는 곳에서 갈 수 있는 모든 장소(발견한 곳만). 길이 이어져 있지 않으면 밀림을 거쳐 간다.
  function travelTargets(k) {
    return Object.keys(MAP_NODES).filter((x) => x !== k && isDiscovered(x));
  }

  function neighborsOf(k) {
    return MAP_LINKS.filter((l) => l.includes(k))
      .map((l) => (l[0] === k ? l[1] : l[0]))
      .filter(isDiscovered);
  }

  const RECORD_KEY = "island-survival-records-v1";
  const ENDING_BONUS = {
    raft_escape: 600,
    rescue_heli: 400,
    rescue_plane: 350,
    rescue: 300,
    survivor: 250,
    rescue_late: 200,
    lifeboat: 800,
  };

  function calcScore() {
    let s =
      state.day * 50 +
      (ENDING_BONUS[state.ending] || 0) +
      state.hp * 2 +
      state.sanity * 2 +
      state.inventory.length * 10;
    if (hasFlag("은신처")) s += 30;
    if (hasFlag("신호")) s += 30;
    if (hasFlag("지형파악")) s += 20;
    // 위기 대처 점수는 배율 없이 표시된 값 그대로 더한다 (bonusNote의 +/- 값과 일치)
    return Math.max(0, Math.round(s * scoreMultiplier()) + (state.bonus || 0));
  }

  // 난이도 × 도구 완성도(창·집수기·은신처·신호·뗏목 재료) × 위기 탈출 횟수
  function scoreMultiplier() {
    const raft = ["대나무", "판자", "밧줄", "돛천"].filter((x) => hasItem(x)).length;
    const tools =
      (hasItem("창") ? 1 : 0) + (hasFlag("집수기") ? 1 : 0) + (hasFlag("은신처") ? 1 : 0) + (hasFlag("신호") ? 1 : 0) + (raft === 4 ? 1 : 0);
    const diff = state.diff === "easy" ? 0.8 : state.diff === "hard" ? 1.3 : 1;
    return +(diff * (1 + 0.04 * tools) * (1 + 0.05 * Math.min(4, state.crises || 0))).toFixed(2);
  }

  function gradeOf(s) {
    return s >= 1500 ? "S" : s >= 1150 ? "A" : s >= 800 ? "B" : s >= 500 ? "C" : "D";
  }

  async function nightChill() {
    if (hasShelterAt(state.place) || hasFlag("오늘모닥불") || state.weather === "clear") return;
    // 흐린 밤보다 비바람 부는 밤에 한기에 노출될 가능성이 높다.
    const encounterChance = state.weather === "storm" ? 0.78 : 0.60;
    if (Math.random() >= encounterChance) return;

    await typeLine("밤공기가 뼛속까지 스며든다. 젖은 피부와 옷에 한기가 달라붙고 몸이 떨린다.", "night");
    const options = [];
    const canLightFire = hasItem("성냥") && (state.weather !== "storm" || state.place === "cave");
    if (canLightFire) options.push("성냥으로 작은 모닥불을 피운다");
    options.push(
      "마른 잎과 풀을 여러 겹 덮어 보온한다",
      "바람을 덜 타는 바위 뒤로 옮겨 몸을 웅크린다",
      "제자리걸음으로 몸을 움직여 체온을 유지한다"
    );
    const c = await choose("어떻게 추위를 견딜까?", options);
    if (c < 0) return;

    if (canLightFire && c === 0) {
      addFlag("오늘모닥불");
      addFlag("야간임시모닥불");
      updateSceneImage();
      await typeLine("마른 잔가지를 모아 성냥불을 붙인다. 작은 불꽃이 살아나며 손끝의 감각이 돌아온다. 급히 피운 불은 오래 버티지 못할 것 같다.", "night");
      // 밤의 응급 불씨는 하루 행동으로 준비한 모닥불보다 효과가 작고 허기·수분을 더 소모한다.
      state.hunger -= 2;
      state.thirst -= 2;
      if (state.status.cold) {
        state.status.cold = Math.max(0, state.status.cold - 1);
        if (!state.status.cold) delete state.status.cold;
        await typeLine("불 가까이에서 몸을 녹이자 오한이 조금 누그러진다.", "night");
      }
      // 아래 nightEvent의 모닥불 효과가 체력·정신력 회복을 처리한다.
    } else {
      const action = c - (canLightFire ? 1 : 0);
      if (action === 0) {
        let chance = state.weather === "storm" ? 0.48 : 0.70;
        if (state.place === "jungle") chance += 0.08;
        if (state.place === "cave") chance += 0.14;
        if (state.place === "cliff") chance -= 0.16;
        if (state.diff === "easy") chance += 0.05;
        if (state.diff === "hard") chance -= 0.07;
        chance = Math.max(0.25, Math.min(0.88, chance));
        if (Math.random() < chance) {
          await typeLine("마른 잎과 풀을 겹겹이 덮고 몸을 둥글게 만다. 보온층이 한기를 막아 준다.", "night");
          state.hp -= 1;
          state.sanity -= 1;
          state.hunger -= 1;
          if (state.weather === "storm" && Math.random() < 0.12) afflict("cold", 3);
          bonusNote(5, "추위를 잘 견뎠다");
        } else {
          await typeLine("겉보기엔 마른 풀도 속은 축축하다. 열이 빠르게 빠져나가며 오한이 심해진다.", "night");
          state.hp -= 3;
          state.sanity -= 4;
          state.hunger -= 1;
          afflict("cold", 3);
        }
      } else if (action === 1) {
        const placeChance = { cave: 0.86, jungle: 0.68, beach: 0.56, reef: 0.52, cliff: 0.34 };
        let chance = placeChance[state.place] ?? 0.55;
        if (state.weather === "storm") chance -= 0.14;
        if (state.diff === "easy") chance += 0.05;
        if (state.diff === "hard") chance -= 0.07;
        chance = Math.max(0.18, Math.min(0.90, chance));
        if (Math.random() < chance) {
          await typeLine(state.place === "cave"
            ? "동굴 안쪽의 움푹한 바위 그늘로 몸을 옮기자 바람이 한결 잦아든다."
            : "바람이 덜 부는 바위 뒤에 몸을 붙인다. 적어도 살을 에는 바람은 피할 수 있다.", "night");
          state.hp -= 1;
          state.sanity -= 1;
        } else {
          await typeLine("바람이 모퉁이를 돌아 그대로 들이친다. 몸이 떨리고 이가 딱딱 부딪힌다.", "night");
          state.hp -= 4;
          state.sanity -= 4;
          afflict("cold", 3);
        }
      } else {
        await typeLine("제자리에서 팔과 다리를 움직이며 체온을 지킨다. 한기는 조금 누그러지지만 기운이 빠진다.", "night");
        state.hp -= 4;
        state.hunger -= 3;
        state.thirst -= 2;
        state.sanity += 1;
      }
    }
    clamp();
    updateHud();
  }

  // —— 물때 ——
  // 하루 안에서 행동 2번마다 간조/만조가 바뀌고, 시작 물때는 날짜 홀짝으로 달라진다
  function isLowTide() {
    const used = Math.max(0, (state.apStart ?? baseActionPoints()) - (state.actionPoints || 0));
    return (state.day + Math.floor(used / 2)) % 2 === 0;
  }

  async function reefTide() {
    if (isLowTide()) {
      await typeLine("🌊 간조다. 물이 빠져 드러난 바위 틈에 조개와 표류물이 보인다.", "system");
      return;
    }
    await typeLine("🌊 만조다. 파도가 바위를 덮치며 밀려든다.", "system");
    if (hasFlag("암초파도피해오늘")) return;
    addFlag("암초파도피해오늘");
    if (Math.random() < 0.25) {
      await typeLine("거센 물살에 휩쓸려 바위에 부딪혔다!");
      state.hp -= state.role === "sailor" ? 2 : 4;
      state.sanity -= 2;
      if (Math.random() < 0.3) afflict("cold", 3);
      clamp();
      updateHud();
    }
  }

  // —— 역할 해금 ——
  function roleUnlocked(r, doneEndings) {
    return !r.unlock || r.unlock.some((e) => doneEndings.has(e));
  }

  function setupData() {
    const done = new Set(readRecords().map((r) => r.ending));
    return {
      t: "setup",
      name: store.getName() || "",
      roles: ROLES.map((r) => ({
        id: r.id,
        name: r.name,
        label: r.choiceLabel,
        unlocked: roleUnlocked(r, done),
        hint: r.hint || "",
      })),
    };
  }

  // —— 상태이상 ——
  const STATUS_INFO = {
    injury: { name: "부상", icon: "🩹" },
    stomach: { name: "복통", icon: "🤢" },
    cold: { name: "감기", icon: "🤧" },
    fever: { name: "열병", icon: "🔥" },
  };

  function afflict(kind, days) {
    state.status = state.status || {};
    if (state.role === "fisher" && kind === "stomach") return; // 강한 위장
    if (state.status[kind]) return;
    // 의사는 병을 빨리 다스린다
    sfx("bad");
    state.status[kind] = state.role === "medic" ? Math.max(1, days - 1) : days;
    say(kind === "injury" ? "⚠ 부상 당했다!" : `⚠ ${STATUS_INFO[kind].name}에 걸렸다!`, "system");
    const recoveryPerNight = hasShelterAt(state.place) ? 2 : 1;
    const recoveryDays = Math.max(1, Math.ceil(state.status[kind] / recoveryPerNight));
    const shelterHint = hasShelterAt(state.place) ? "이곳의 은신처에서 쉬면 회복이 조금 더 빨라질 것 같다." : "현재 장소에 은신처를 마련하고 충분히 쉬면 회복이 빨라질 것 같다.";
    say(`몸이 회복되려면 약 ${recoveryDays}일 정도 걸릴 것 같다. ${shelterHint}`, "hint");
    updateHud();
  }

  async function applyStatusEffects() {
    state.status = state.status || {};
    const st = state.status;
    const shelterTier = hasShelterAt(state.place) ? shelterUpgradeLevel(state.place) : 0;
    if (state.role === "medic") state.hp += 3; // 의사는 밤마다 스스로를 돌본다
    if (!hasShelterAt(state.place) && !hasFlag("오늘모닥불") && Math.random() < 0.1) afflict("cold", 3);
    if (st.injury && !st.fever && !hasShelterAt(state.place) && Math.random() < 0.35) {
      await typeLine("방치한 상처가 곪기 시작한다…", "night");
      afflict("fever", 4);
    }
    const lines = [];
    if (st.injury) {
      state.hp -= shelterTier >= 1 ? 2 : 3;
      lines.push(shelterTier >= 1 ? "보강한 은신처에서 쉬어 상처의 통증이 조금 덜하다." : "상처가 욱신거린다.");
    }
    if (st.stomach) {
      state.hunger -= 3;
      state.hp -= 1;
      lines.push("배가 쥐어짜듯 아프다.");
    }
    if (st.cold) {
      state.sanity -= shelterTier >= 1 ? 1 : 2;
      lines.push(shelterTier >= 1 ? "촘촘한 풀잎 지붕이 한기를 막아 오한이 조금 누그러진다." : "오한에 몸이 떨리고 기침이 난다.");
    }
    if (st.fever) {
      state.hp -= 4;
      state.thirst -= 3;
      state.sanity -= 2;
      lines.push("열이 끓어 헛것이 보인다.");
    }
    if (lines.length) await typeLine(lines.join(" "), "night");
    const heal = shelterTier >= 2 ? 3 : shelterTier >= 1 ? 2 : 1; // 보강 단계가 높을수록 현재 장소에서 상태이상이 빨리 회복된다
    for (const k of Object.keys(st)) {
      st[k] = Math.max(0, st[k] - heal);
      if (!st[k]) {
        delete st[k];
        say(`${STATUS_INFO[k].name}이(가) 나았다.`, "system");
      }
    }
    clamp();
    updateHud();
  }

  // —— 연출 ——
  async function stormHazard() {
    if (state.weather !== "storm" || hasFlag("폭풍피해오늘")) return;
    addFlag("폭풍피해오늘");
    sfx("wave");
    await typeLine(state.place === "cliff" ? "비바람이 절벽을 후려친다. 미끄러운 바위에 몸이 휘청인다!" : "거센 파도와 바람이 몰아친다!", "system");
    state.hp -= state.role === "sailor" ? 2 : 4; // 선원은 거친 바다에 익숙하다
    state.sanity -= 2;
    if (Math.random() < 0.3) afflict("cold", 3);
    clamp();
    updateHud();
  }

  // 먹고 마시기: 행동력 없이 곧바로 사용 (행동 메뉴의 바로가기와 아이템 메뉴가 공유)
  async function quickUse(kind) {
    if (kind === "drink") {
      await typeLine("시원한 물이 목을 적신다. 이제 빈 물병이 남았다.");
      removeItem("물병(가득)");
      state.inventory.push("빈 물병");
      state.thirst += 35;
      state.hp += 3;
    } else if (kind === "drinkGlass") {
      await typeLine("서늘한 물이 목을 적신다. 이제 빈 유리병이 남았다.");
      removeItem("유리병(물)");
      state.inventory.push("유리병");
      state.thirst += 28;
      state.hp += 2;
    } else {
      await typeLine("껍질을 벗겨 바나나를 먹는다. 달콤한 과육이 허기를 달래 준다.");
      const i = state.inventory.indexOf("바나나");
      if (i >= 0) state.inventory.splice(i, 1);
      state.hunger += 20;
      state.sanity += 2;
    }
    clamp();
    updateHud();
  }

  const FIRE_TEXT = {
    beach: "해변에 떠밀려온 마른 유목 조각을 모아 쌓고 성냥불을 붙인다.",
    jungle: "마른 가지와 낙엽을 모아 쌓고 성냥불을 붙인다.",
    reef: "바위 틈의 마른 표류목 조각을 긁어모아 성냥불을 붙인다.",
    cave: "동굴 입구에서 주워 온 마른 가지를 쌓고 성냥불을 붙인다. 벽에 그림자가 일렁인다.",
    cliff: "바위 틈의 마른 풀과 가지를 모아, 바람을 막아 가며 성냥불을 붙인다.",
  };

  // 모닥불: 메뉴 없이 곧바로 만든다 (성냥·날씨·장소 조건 확인)
  async function makeCampfire() {
    if (!hasItem("성냥")) {
      await typeLine("불을 피울 방법이 없어서 만들 수 없다.", "system");
      return;
    }
    if (hasFlag("오늘모닥불")) {
      await typeLine("오늘은 이미 모닥불을 피웠다. 불씨가 아직 남아 있다.", "system");
      return;
    }
    if (state.weather === "storm" && state.place !== "cave") {
      await typeLine("비바람이 몰아쳐 불씨가 금세 꺼져 버린다. 지금은 모닥불을 만들 수 없다.", "system");
      return;
    }
    addFlag("오늘모닥불");
    updateSceneImage();
    await typeLine(FIRE_TEXT[state.place] || FIRE_TEXT.beach);
    await typeLine("불길이 살아나자 마음까지 한결 놓인다.");
    state.sanity += 5;
    if (state.status.cold) {
      state.status.cold = Math.max(0, state.status.cold - 2);
      if (!state.status.cold) delete state.status.cold;
      await typeLine("불 곁에서 몸을 녹이니 오한이 가신다.");
    }
    clamp();
    spendAction();
  }

  // 도구 제작: 만들 수 있는 것이 있을 때만 메뉴에 나타난다 (집수기는 야외에서만)
  function craftable() {
    const list = [];
    if (hasItem("칼") && hasItem("대나무") && !hasItem("창")) list.push(["spear", "창을 만든다 (칼 + 대나무)"]);
    if (hasItem("대나무") && hasItem("돛천") && !hasFlag("집수기") && state.place !== "cave") {
      list.push(["catcher", "빗물 집수기를 만든다 (대나무 + 돛천, 뗏목 재료 소모)"]);
    }
    return list;
  }

  async function craftMenu() {
    const list = craftable();
    const c = await choose("무엇을 만들까?", [...list.map((x) => x[1]), "그만둔다"]);
    if (c < 0 || c >= list.length) return;
    if (list[c][0] === "spear") {
      await typeLine("대나무 끝을 칼로 날카롭게 깎아 창을 만들었다.");
      addItem("창");
      state.hunger -= 2;
    } else {
      removeItem("대나무");
      removeItem("돛천");
      addFlag("집수기");
      await typeLine("돛천을 펼쳐 대나무에 걸어 빗물 집수기를 만들었다.");
    }
    updateHud(); // 도구 제작은 행동력을 쓰지 않는다
  }

  const WIN_ENDINGS = ["rescue", "rescue_heli", "rescue_plane", "rescue_late", "raft_escape", "survivor", "lifeboat"];
  async function finalBeat() {
    const win = WIN_ENDINGS.includes(state.ending);
    sfx(win ? "win" : "lose");
    await typeLine(win ? "드디어....." : "마침내....", win ? "final win" : "final lose", 70);
    await choose("마지막 순간", ["다음"]);
  }


  // =====================================================================
  //  서버용 화면 대체층 — 화면을 그리지 않고 클라이언트로 '이벤트'만 보낸다.
  //  게임 규칙·확률·시나리오 문장은 모두 이 파일(서버)에만 존재한다.
  // =====================================================================
  let pendingEv = null;
  let nameResolver = null;
  let nameEv = null;
  let optionCount = 0;

  function run(p) {
    Promise.resolve(p).catch((e) => {
      console.error(e);
      emit({ t: "error", message: "서버 오류가 발생했습니다. 새로 시작하거나 저장된 슬롯을 불러오세요." });
    });
  }

  function say(text, kind = "") {
    emit({ t: "line", text, kind });
  }
  async function typeLine(text, kind = "") {
    emit({ t: "line", text, kind: kind || classifyLine(text), typed: true });
  }
  function clearLog() {
    lastBanner = null;
    boarScene = false;
    emit({ t: "clear" });
  }
  function clearChoices() {
    if (pendingEv) {
      pendingEv.answered = true;
      pendingEv = null;
    }
  }
  function showScreen(name) {
    emit({ t: "screen", name });
  }
  function sfx(kind) {
    emit({ t: "sfx", kind });
  }

  function sceneBanner() {
    if (!state || state.phase !== "day" || !state.place) return;
    const key = `${state.place}|${state.day}`;
    if (lastBanner === key) return;
    lastBanner = key;
    emit({ t: "banner", text: `${BANNER[state.place] || state.place} · Day ${state.day}` });
  }

  function tideNotice() {
    if (!state || state.phase !== "day") return;
    const low = isLowTide();
    if (lastTide !== null && lastTide !== low) {
      say(low ? "🌊 물이 빠지며 간조가 되었다. 암초의 바위 틈이 드러난다." : "🌊 물이 차오르며 만조가 되었다. 암초에 파도가 몰아친다.", "system");
    }
    lastTide = low;
  }

  const RAFT_PARTS = ["대나무", "판자", "밧줄", "돛천"];
  function goalsList() {
    const raft = RAFT_PARTS.filter((x) => hasItem(x)).length;
    const raftBuilt = hasFlag("뗏목완성");
    const raftGoalCount = raftBuilt ? 4 : raft;
    const goals = [
      ["은신처 짓기", hasFlag("은신처")],
      ["구조 신호 올리기", hasFlag("신호")],
      ["절벽에서 지형 파악", hasFlag("지형파악")],
      [`뗏목 재료 모으기 ${raftGoalCount}/4`, raftGoalCount === 4],
    ];
    if (raftBuilt) goals.push([hasFlag("뗏목손상") ? "뗏목 보강하기" : "뗏목으로 탈출하기", false]);
    if (!hasFlag("보트단서")) goals.push(["일기에서 탈출방법 찾아보기", false]);
    else if (!hasFlag("구명보트발견")) goals.push(["구명보트 찾기", false]);
    else {
      goals.push(["구명보트 선체 수리", hasFlag("구명보트선체수리")]);
      goals.push(["구명보트 노 확보", hasItem("노")]);
      goals.push(["절벽에서 출항 항로 파악", hasFlag("보트항로확인")]);
    }
    return goals;
  }

  // 화면에 필요한 값만 골라 보낸다 (플래그·확률·내부 카운터는 보내지 않는다)
  function emitState() {
    if (!state) return;
    const day = state.phase === "day";
    const placeLabel = PLACE_LABEL[state.place] || state.place;
    emit({
      t: "state",
      s: {
        day: state.day,
        hp: state.hp,
        hunger: state.hunger,
        thirst: state.thirst,
        sanity: state.sanity,
        inventory: [...state.inventory],
        place: state.place,
        phase: state.phase,
        weather: state.weather,
        name: state.playerName,
        role: state.role,
        low: isLowTide(),
        placeText: `${placeLabel}${day ? ` · 행동력 ${state.actionPoints}` : ""}${day && state.weather ? " · " + WEATHER_LABEL[state.weather] : ""}${day ? " · " + (isLowTide() ? "간조" : "만조") : ""}`,
        status: Object.keys(state.status || {}).map((k) => ({ k, name: STATUS_INFO[k].name, icon: STATUS_INFO[k].icon, days: state.status[k] })),
        goals: goalsList(),
        score: calcScore(),
        found: { cave: isDiscovered("cave"), cliff: isDiscovered("cliff") },
        shelters: shelterPlaces(),
        shelterUpgrades: shelterUpgradeLevels(),
        raft: hasFlag("뗏목완성"),
        raftDamaged: hasFlag("뗏목손상"),
        lifeboatFound: hasFlag("구명보트발견"),
        lifeboatHasOars: hasItem("노"),
        fx: { fire: hasFlag("오늘모닥불"), boar: boarScene, shelter: hasShelterAt(state.place) },
      },
    });
  }

  function updateSceneImage() {
    if (!state) return;
    sceneBanner();
    emitState();
  }
  function updateMap() {
    if (!state) return;
    tideNotice();
    emitState();
  }
  function updateHud() {
    if (!state) return;
    tideNotice();
    emitState();
  }

  function rawChoose(prompt, options) {
    return new Promise((resolve) => {
      clearChoices();
      choiceResolver = resolve;
      optionCount = options.length;
      travelOK = (prompt === "무엇을 할까?" || prompt === "동굴에서…") && !!state && state.phase === "day";
      pendingEv = emit({
        t: "choices",
        prompt,
        options,
        // 장소 메뉴일 때만 위치 기반으로 보여 준다. 지도·3D 이동은 발견한 모든 장소로 가능하다.
        placeMenu: travelOK ? state.place : null,
        travel: travelOK ? Object.keys(MAP_NODES).filter((k) => k !== state.place && isDiscovered(k)) : [],
      });
    });
  }

  function settle(value) {
    if (!choiceResolver) return false;
    const r = choiceResolver;
    choiceResolver = null;
    travelOK = false;
    clearChoices();
    r(value);
    return true;
  }

  function askName() {
    return new Promise((resolve) => {
      nameResolver = resolve;
      nameEv = emit({ t: "askName", name: store.getName() || "" });
    });
  }

  const readRecords = () => store.readRecords();
  const writeRecords = (a) => store.writeRecords(a);

  function buildStats(rec, all) {
    const sorted = [...all].sort((a, b) => b.score - a.score || a.at - b.at);
    const rank = sorted.findIndex((r) => r.at === rec.at) + 1;
    const avg = Math.round(all.reduce((t, r) => t + r.score, 0) / all.length);
    const best = sorted[0].score;
    const pct = Math.max(1, Math.ceil((rank / all.length) * 100));
    const nm = rec.name || "표류자";
    const verdict =
      all.length === 1
        ? `${nm}님의 첫 기록이 등록되었습니다. 다음 판부터 순위 비교가 시작됩니다.`
        : rank === 1
        ? `🏆 ${nm}님, 역대 최고 기록입니다!`
        : `${nm}님은 전체 ${all.length}판 중 ${rank}위 · 상위 ${pct}%`;
    const row = (r, i) => ({
      rank: i + 1,
      name: r.name || "-",
      score: r.score,
      grade: gradeOf(r.score),
      ending: (ENDINGS[r.ending]?.title || "-") + (r.diff === "hard" ? " 🔥" : r.diff === "easy" ? " 🌱" : ""),
      day: r.day,
      me: r.at === rec.at,
    });
    const rows = sorted.slice(0, 5).map(row);
    const gap = rank > 5;
    if (gap) rows.push(row(rec, rank - 1));
    const scale = Math.max(best, rec.score, 1);
    return {
      score: rec.score,
      grade: gradeOf(rec.score),
      rank,
      best,
      avg,
      diff: rec.score - avg,
      verdict,
      rows,
      gap,
      myW: +((rec.score / scale) * 100).toFixed(1),
      avgX: +((avg / scale) * 100).toFixed(1),
    };
  }

  function showEnding() {
    const data = ENDINGS[state.ending] || ENDINGS.fade;
    const inv = state.inventory.length > 0 ? state.inventory.join(", ") : "(없음)";
    const roleName = ROLES.find((r) => r.id === state.role)?.name || "표류자";
    let meta = `${state.playerName}님 · 생존 ${state.day}일 · ${roleName} 출신 · 체력 ${state.hp} · 정신 ${state.sanity} · 점수 배율 ×${scoreMultiplier()}${state.bonus ? ` · 위기 대처 ${state.bonus > 0 ? "+" : ""}${state.bonus}점` : ""} · 소지품: ${inv}`;
    const rec = {
      at: Date.now(),
      score: calcScore(),
      day: state.day,
      ending: state.ending || "fade",
      role: state.role,
      hp: state.hp,
      sanity: state.sanity,
      diff: state.diff,
      name: state.playerName,
    };
    const all = readRecords();
    all.push(rec);
    writeRecords(all);
    const before = new Set(all.slice(0, -1).map((r) => r.ending));
    const after = new Set(all.map((r) => r.ending));
    const fresh = ROLES.filter((r) => r.unlock && !roleUnlocked(r, before) && roleUnlocked(r, after));
    if (fresh.length) meta += ` · 🎭 새 역할 해금: ${fresh.map((r) => r.name).join(", ")}`;
    clearChoices();
    emit({
      t: "ending",
      key: state.ending || "fade",
      win: WIN_ENDINGS.includes(state.ending),
      kicker: `${state.playerName}님의 결말`,
      title: data.title,
      body: `${state.playerName}님의 이야기는 여기서 끝이 난다.\n\n${data.body}`,
      meta,
      stats: buildStats(rec, all),
    });
  }

  function galleryData() {
    const found = new Set(readRecords().map((r) => r.ending));
    const keys = Object.keys(ENDINGS);
    return {
      t: "gallery",
      desc: `${keys.filter((k) => found.has(k)).length} / ${keys.length} 엔딩 수집`,
      items: keys
        .map((k) => (found.has(k) ? { found: true, title: ENDINGS[k].title, text: ENDINGS[k].body.split("\n")[0] } : { found: false }))
        .concat(
          ROLES.filter((r) => r.unlock).map((r) =>
            roleUnlocked(r, found) ? { found: true, title: `🎭 ${r.name} 해금`, text: r.choiceLabel } : { found: false, role: true, text: r.hint }
          )
        ),
    };
  }

  function slotMeta(slot) {
    if (!slot) return null;
    const s = slot.state;
    return {
      title: `Day ${s.day} · ${PLACE_LABEL[s.place] || s.place}`,
      detail: `체력 ${s.hp} · 정신 ${s.sanity}`,
      at: slot.savedAt,
    };
  }

  function loadSlot(index) {
    const slot = store.readSaves()[index];
    if (!slot) return;
    const loaded = structuredClone(slot.state);
    // 예전 저장 데이터와의 호환을 위한 기본값 보정
    if (typeof loaded.actionPoints !== "number") loaded.actionPoints = 4;
    if (typeof loaded.journalPage !== "number") loaded.journalPage = 0;
    if (!Array.isArray(loaded.shownHints)) loaded.shownHints = [];
    if (typeof loaded.role === "undefined") loaded.role = null;
    if (!loaded.diff) loaded.diff = "normal";
    if (!loaded.status) loaded.status = {};
    if (!loaded.playerName) loaded.playerName = "표류자";
    if (typeof loaded.bonus !== "number") loaded.bonus = 0;
    if (typeof loaded.crises !== "number") loaded.crises = 0;
    if (typeof loaded.searchTries !== "number") loaded.searchTries = 0;
    if (!Array.isArray(loaded.inventory)) loaded.inventory = [];
    if (!loaded.inventory.includes("생존 수첩")) loaded.inventory.unshift("생존 수첩");
    state = loaded;
    run(resumeGame());
  }

  const slotIndex = (v) => (Number.isInteger(v) && v >= 0 && v < SLOT_COUNT ? v : -1);

  // 클라이언트가 보낼 수 있는 메시지는 이것뿐이다. 모두 서버가 검증한다.
  function handle(m) {
    if (!m || typeof m.type !== "string") return;
    switch (m.type) {
      case "new":
        emit(setupData());
        break;
      case "start": {
        const mRole = String(m.role || "");
        const mDiff = String(m.diff || "normal");
        const mName = String(m.name || "");
        run(startNewGame({ name: mName, diff: mDiff, role: mRole }));
        break;
      }
      case "title":
        stopRun();
        emit({ t: "screen", name: "title" });
        break;
      case "choose":
        if (choiceResolver && Number.isInteger(m.index) && m.index >= 0 && m.index < optionCount) settle(m.index);
        break;
      case "item": {
        const item = String(m.name || "");
        if (choiceResolver && travelOK && state && state.alive && state.inventory.includes(item)) {
          pendingInventoryItem = item;
          settle(-3);
        } else {
          emit({ t: "notice", message: "행동 메뉴가 열린 상태에서 소지품을 선택해 주세요." });
        }
        break;
      }
      case "map": {
        // 지도·3D 화면에서 장소에 도착했다는 요청. 장소 메뉴를 기다리는 중일 때만, 이어진 장소로만 받는다.
        const k = String(m.place);
        if (!choiceResolver || !travelOK || !Object.prototype.hasOwnProperty.call(MAP_NODES, k)) break;
        if (k === state.place || !isDiscovered(k) || !routeTo(state.place, k)) break;
        pendingTravel = k;
        settle(-2);
        break;
      }
      case "name":
        if (nameResolver) {
          const v = String(m.value ?? "").replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 12) || "표류자";
          store.setName(v);
          const r = nameResolver;
          nameResolver = null;
          if (nameEv) nameEv.answered = true;
          r(v);
        }
        break;
      case "saves":
        emit({ t: "saves", slots: store.readSaves().map(slotMeta) });
        break;
      case "save": {
        const i = slotIndex(m.slot);
        if (i < 0 || !state || !state.alive) break;
        const slots = store.readSaves();
        slots[i] = serializeState();
        store.writeSaves(slots);
        if (m.exitAfter === true) {
          stopRun();
          emit({ t: "notice", message: `슬롯 ${i + 1}에 저장했습니다. 타이틀 화면으로 돌아갑니다.` });
          emit({ t: "screen", name: "title" });
        } else {
          say(`슬롯 ${i + 1}에 저장했습니다.`, "system");
        }
        break;
      }
      case "load": {
        const i = slotIndex(m.slot);
        if (i >= 0) loadSlot(i);
        break;
      }
      case "delete": {
        const i = slotIndex(m.slot);
        if (i < 0) break;
        const slots = store.readSaves();
        slots[i] = null;
        store.writeSaves(slots);
        emit({ t: "saves", slots: slots.map(slotMeta) });
        break;
      }
      case "gallery":
        emit(galleryData());
        break;
    }
  }

  return { handle, dispose: () => { liveDrain = false; clearInterval(liveTimer); } };
};
