/**
 * field/balance.ts — 전투의 수치는 전부 여기 모은다.
 *
 * 규칙: **코드에 숫자를 박지 않는다.** 밸런스를 고칠 때 여러 파일을 헤매지
 * 않도록, 전투가 쓰는 값은 예외 없이 이 파일의 표에서 나온다.
 * (전략 쪽 formulas.ts 의 B 표와 같은 방침이다)
 *
 * 출처가 둘이다.
 *   · docs/battle-system.md — 기획 값 (단계 계수·상성·지형·태세)
 *   · pipeline/prototype — 실제로 돌려 보며 잡은 값 (밀어내기 76m 등)
 * 프로토타입에서 온 값에는 그렇게 적어 둔다. 이유 없이 고치면 안 되는 것들이다.
 */

import type { FactionId, Troop } from '../types';
import type { Row, Stance, TerrainCode, Tier } from './types';

/* ------------------------------------------------------------------ *
 * ① 국가 병종 단계 — 이 게임에서 가장 큰 계수
 * ------------------------------------------------------------------ */

/**
 * 단계 계수. 4단계는 1단계의 1.9배다.
 *
 * 장수 능력치 차이는 최대 2배 남짓인데, 그것과 맞먹게 잡은 것이 요점이다.
 * **명장 하나로 뒤집기보다 나라를 키우는 쪽이 정답이어야 한다** (§4.9).
 */
export const TIER_POWER: Record<Tier, number> = { 1: 1.0, 2: 1.25, 3: 1.55, 4: 1.9 };

/** 단계별 이름 (§2.1). 화면에 그대로 쓴다 */
export const TIER_NAME: Record<Troop, Record<Tier, string>> = {
  inf: { 1: '농민병', 2: '경보병', 3: '중보병', 4: '철갑보병' },
  cav: { 1: '기마병', 2: '경기병', 3: '중기병', 4: '개마무사' },
  arc: { 1: '사수', 2: '궁병', 3: '맥궁병', 4: '쇠뇌병' },
  str: { 1: '서기', 2: '참모', 3: '군사', 4: '국사' },
};

/**
 * 세력 계수 — **1단계부터 나라마다 유불리가 있다.**
 *
 * 기획서 §2.3 은 해금 차등(개마무사는 고구려 전용)만 정해 두었는데,
 * 그러면 4단계에 닿기 전까지는 네 나라의 같은 병종이 완전히 똑같다.
 * 고구려 기병은 1단계부터 고구려 기병이어야 한다.
 *
 * 폭을 ±12% 로 묶은 것은 의도적이다. 단계 계수가 1.0 → 1.9 인데 세력
 * 보정이 그만큼 커지면 §4.9 가 못 박은 "나라를 키우는 쪽이 정답"이 깨진다.
 * 세력색은 **처음부터 느껴지되 판을 가르지는 않는** 크기여야 한다.
 */
export const FACTION_AFFINITY: Record<FactionId, Record<Troop | 'navy', number>> = {
  // 기마민족. 개마무사와 맥궁이 이 나라의 얼굴이다. 대신 바다가 약하다
  goguryeo: { cav: 1.12, inf: 1.0, arc: 1.08, str: 0.95, navy: 0.92 },
  // 해상국가. 쇠뇌와 누선, 그리고 두꺼운 책략계
  baekje: { cav: 0.95, inf: 1.0, arc: 1.1, str: 1.05, navy: 1.1 },
  // 화랑과 모사의 나라. 보병 전열이 단단하다
  silla: { cav: 1.0, inf: 1.08, arc: 0.95, str: 1.1, navy: 1.0 },
  // 철의 나라. 철갑보병이 먼저 열리고 배를 잘 부린다
  gaya: { cav: 0.92, inf: 1.1, arc: 0.95, str: 1.0, navy: 1.08 },
};

/** 세력이 그 계열을 4단계까지 올릴 수 있는가 (§2.3 전용 병종) */
export const TIER_CAP: Record<FactionId, Record<Troop, Tier>> = {
  goguryeo: { cav: 4, inf: 3, arc: 4, str: 4 }, // 개마무사 전용
  baekje: { cav: 3, inf: 3, arc: 4, str: 4 }, // 쇠뇌병 우선
  silla: { cav: 4, inf: 4, arc: 3, str: 4 },
  gaya: { cav: 3, inf: 4, arc: 3, str: 3 }, // 철갑보병 우선
};

/* ------------------------------------------------------------------ *
 * ② 계열의 성질
 * ------------------------------------------------------------------ */

export interface ClassSpec {
  /** 행군 속도 (m/초). 실제 값을 쓴다 — 보병 4km/h */
  speed: number;
  /** 교전 사거리 (m) */
  range: number;
  attack: number;
  defense: number;
  /** 어느 열에 서야 제 몫을 하는가 */
  home: Row;
}

/**
 * 속도를 실제 행군 속도로 잡은 것이 이 설계의 핵심이다.
 * 7km 전장을 보병이 가로지르는 데 1시간 45분이 걸리므로, **행군과 전개
 * 자체가 판단 대상**이 된다(§4.9). 고지를 먼저 점하려면 일찍 보내야 한다.
 *
 * 사거리는 「활이 날아가는 거리」가 아니라 **부대끼리 닿는 거리**다.
 *
 * 수천 명이 늘어선 부대는 정면 폭이 수백 미터다. 근접 사거리를 30m 로 잡았더니
 * 보병이 영영 붙지 못하고 여섯 시간을 마주 본 채 지쳐 쓰러졌다(실측). 부대를
 * 점으로 두는 이상 사거리에 정면 폭이 들어가 있어야 한다.
 */
export const CLASS: Record<Troop, ClassSpec> = {
  //           4.0km/h              창벽으로 기병을 세운다
  inf: { speed: 1.11, range: 180, attack: 1.0, defense: 1.35, home: 'front' },
  //           8.0km/h              측면으로 돌아 유린한다
  cav: { speed: 2.22, range: 180, attack: 1.35, defense: 0.95, home: 'mid' },
  //           4.6km/h              붙으면 약하다
  arc: { speed: 1.28, range: 430, attack: 0.85, defense: 0.7, home: 'rear' },
  //           4.3km/h              직접 싸우지 않는다. 계략이 본업이다
  str: { speed: 1.2, range: 700, attack: 0.4, defense: 0.6, home: 'rear' },
};

/** 수군 편성. 육상 계열 대신 이 값을 쓴다 */
export const NAVY_SPEC: ClassSpec = { speed: 1.9, range: 350, attack: 1.0, defense: 1.0, home: 'front' };

/**
 * 상성 — 보병 → 기병 → 궁병 → 보병 (§4.10).
 * 책략계는 이 고리 밖이다. 대신 계략이 성공하면 판을 뒤집는다.
 */
export const COUNTER: Partial<Record<Troop, Partial<Record<Troop, number>>>> = {
  inf: { cav: 1.5 },
  cav: { arc: 1.5 },
  arc: { inf: 1.4 },
};

/** 열이 맞지 않으면 깎인다 (§4.5 "궁병을 전열에 세우면 방어력 절반") */
export const ROW_FIT: Record<Row, Partial<Record<Troop, number>>> = {
  front: { inf: 1.0, cav: 0.9, arc: 0.5, str: 0.5 },
  mid: { inf: 0.95, cav: 1.0, arc: 0.8, str: 0.8 },
  rear: { inf: 0.8, cav: 0.85, arc: 1.0, str: 1.0 },
};

/* ------------------------------------------------------------------ *
 * ③ 태세 (§4.7)
 * ------------------------------------------------------------------ */

export interface StanceSpec {
  name: string;
  /** 이 계열에 붙는 공격 보정 */
  attack: Partial<Record<Troop, number>>;
  /** 전군 방어 보정 */
  defense: number;
  /** 받는 피해 보정 */
  taken: number;
  /** 틱당 피로 증감 */
  fatigue: number;
  /** 틱당 사기 회복 */
  moraleRecover: number;
  desc: string;
}

export const STANCE: Record<Stance, StanceSpec> = {
  charge: {
    name: '돌격',
    attack: { cav: 1.4, inf: 1.15 },
    defense: 0.8,
    taken: 1.0,
    fatigue: 0.010,
    moraleRecover: 0,
    desc: '기병 위력이 오르지만 아군 방어가 얇아지고 빨리 지친다',
  },
  hold: {
    name: '견고',
    attack: { inf: 1.05 },
    defense: 1.35,
    taken: 0.75,
    fatigue: 0.0005,
    moraleRecover: 0.004,
    desc: '전열이 단단해지고 피해가 줄지만 적을 밀어내지 못한다',
  },
  shoot: {
    name: '사격',
    attack: { arc: 1.4 },
    defense: 1.0,
    taken: 0.85,
    fatigue: 0.002,
    moraleRecover: 0.002,
    desc: '궁병 위력이 오르고 근접 피해를 덜 받는다',
  },
  wait: {
    name: '대기',
    attack: {},
    defense: 1.0,
    taken: 1.0,
    fatigue: -0.02,
    moraleRecover: 0.012,
    desc: '진형을 지키며 사기와 체력을 되돌린다',
  },
};

/* ------------------------------------------------------------------ *
 * ④ 지형 (§5.1)
 * ------------------------------------------------------------------ */

export interface TerrainSpec {
  name: string;
  /** 이동 배율. 0 이면 통행 불가 */
  move: number;
  defense: number;
  /** 근접 공격 배율 */
  melee: number;
  /** 궁병 배율 */
  arc: number;
  /** 기병 배율 */
  cav: number;
  /** 병량·피로 배율 */
  toll: number;
  /** 수군만 다닐 수 있는 물인가 */
  water?: boolean;
}

/**
 * 산악이 「방어 +50%, 궁병 +30%」이면서 「근접 -15%, 기병 -50%, 소모 1.4배」인
 * 것은 계산 착오가 아니다.
 *
 *   산에 올라가면 지지는 않지만 이기지도 못한다.
 *   공격하려면 내려와야 하고, 내려오면 이점을 잃는다.
 *
 * 공격력까지 올려 주면 "무조건 산을 차지한다"는 단일 최적해가 되어 전술이
 * 사라진다. **고지는 수비의 땅이어야 한다** (§5.2).
 * 이 규칙이 공성전의 「포위」와 맞물려 안시성을 정면으로 못 깨게 만든다.
 */
export const TERRAIN: Record<TerrainCode, TerrainSpec> = {
  '.': { name: '평지', move: 1.0, defense: 1.0, melee: 1.0, arc: 1.0, cav: 1.25, toll: 1.0 },
  f: { name: '숲', move: 0.6, defense: 1.2, melee: 0.9, arc: 0.75, cav: 0.7, toll: 1.0 },
  h: { name: '구릉', move: 0.7, defense: 1.25, melee: 1.0, arc: 1.15, cav: 0.85, toll: 1.15 },
  m: { name: '산악', move: 0.45, defense: 1.5, melee: 0.85, arc: 1.3, cav: 0.5, toll: 1.4 },
  X: { name: '험지', move: 0, defense: 1.0, melee: 1.0, arc: 1.0, cav: 1.0, toll: 1.0 },
  M: { name: '늪', move: 0.5, defense: 0.9, melee: 0.85, arc: 0.9, cav: 0.6, toll: 1.2 },
  '=': { name: '여울', move: 0.4, defense: 0.8, melee: 1.0, arc: 1.0, cav: 0.7, toll: 1.0 },
  // 강 — 뗏목으로 건넌다. move 는 쓰지 않는다(WATER_SPEED 가 절대값으로 정한다)
  '~': { name: '강', move: 1, defense: 0.7, melee: 1.0, arc: 1.0, cav: 1.0, toll: 1.3, water: true },
  // 바다 — 수군만. 뗏목으로 외해를 건너지는 못한다
  s: { name: '바다', move: 0, defense: 1.0, melee: 0.4, arc: 1.0, cav: 1.0, toll: 1.2, water: true },
  W: { name: '성벽', move: 0, defense: 1.5, melee: 1.0, arc: 1.15, cav: 1.0, toll: 1.0 },
  G: { name: '성문', move: 0.8, defense: 1.3, melee: 1.0, arc: 1.0, cav: 0.9, toll: 1.0 },
  P: { name: '항구', move: 0.9, defense: 1.0, melee: 1.0, arc: 1.0, cav: 0.9, toll: 1.0 },
  // §7.1 — 성곽 규격이 더한 셋. 치·옹성벽은 성벽과 같이 못 지나간다
  T: { name: '치', move: 0, defense: 1.6, melee: 1.0, arc: 1.25, cav: 1.0, toll: 1.0 },
  O: { name: '옹성벽', move: 0, defense: 1.45, melee: 1.0, arc: 1.15, cav: 1.0, toll: 1.0 },
  // 해자는 건널 수 있다. 다만 그 안에 있는 동안 방어가 무너진다 (§7.7 MOAT_DEF_PENALTY)
  D: { name: '해자', move: 0.35, defense: 0.7, melee: 0.9, arc: 0.95, cav: 0.5, toll: 1.1 },
  r: { name: '길', move: 1.3, defense: 0.95, melee: 1.0, arc: 1.0, cav: 1.2, toll: 0.9 },
};

/**
 * 여울에서 피격당하면 피해가 두 배 — 살수대첩 재현 장치 (§5.1).
 * 물을 건너는 중에는 대열이 없다.
 */
export const FORD_AMBUSH = 2.0;

/* ------------------------------------------------------------------ *
 * ④-b 물 — 누구나 건너되, 물 위에서는 수군만 싸운다
 *
 * 처음에는 갈라진 전장에 **다리를 놓아** 풀었다. 그런데 6세기에 7km 전장을
 * 가로지르는 다리를 놓는 것은 무리이고, 무엇보다 그러면 수군이 할 일이 없다.
 *
 * 대신 이렇게 한다: **어느 병종이든 뗏목을 지어 하천을 건널 수 있다.**
 * 다만 물 위에서는
 *   · 느리다 — 수군 > 책략 > 보병 > 기병 순. 말을 배에 태우는 것이 제일 힘들다
 *   · 거의 못 싸운다 — 수군만 제 위력을 낸다
 *
 * 그래서 도하는 언제나 도박이 되고, 수군을 가진 쪽이 강을 지배한다.
 * 실측으로도 하천만 열면 갈라져 있던 8개 전장이 전부 이어진다 —
 * **먼바다는 열지 않는다.** 뗏목으로 외해를 건너지는 못한다.
 * ------------------------------------------------------------------ */

/** 물 위 이동 속도(m/초). 육상 속도와 무관한 절대값이다 */
export const WATER_SPEED: Record<Troop | 'navy', number> = {
  navy: 1.9, // 제일 빠르다. 배가 본업이다
  str: 0.75, // 약간 빠르다 — 뗏목을 엮는 것도 재주다
  inf: 0.65, // 기본
  arc: 0.6,
  cav: 0.42, // 제일 느리다. 말을 태워야 한다
};

/** 물 위 공격 배율. 수군이 아니면 거의 못 싸운다 */
export const WATER_ATTACK: Record<Troop | 'navy', number> = {
  navy: 1.0,
  inf: 0.2,
  str: 0.18,
  arc: 0.22, // 배 위에서도 활은 쏜다
  cav: 0.12,
};

/** 물 위 방어 배율. 도하 중에 맞으면 크게 다친다 */
export const WATER_DEFENSE: Record<Troop | 'navy', number> = {
  navy: 1.0,
  inf: 0.28,
  str: 0.22,
  arc: 0.24,
  cav: 0.18,
};

/* ------------------------------------------------------------------ *
 * ⑤ 나머지 계수
 * ------------------------------------------------------------------ */

export const F = {
  /**
   * 피해 나눗수. 전투 길이를 정하는 손잡이다.
   *
   * §4.2 가 정한 목표: 조우전 약 2시간 · 야전 약 6시간 (전장 내 시간).
   * 값은 npm run tune:field 로 실제 돌려 보며 맞췄다 — 조우전 2.1시간,
   * 야전 8부대 4.7시간, 12부대 5.2시간. 눈대중으로 고치지 말 것.
   * 고치면 모든 유형의 길이와 손실률이 한꺼번에 움직인다.
   */
  damageDivisor: 1000,

  /** 병력 1,000명을 1 로 본 위력 기준 */
  troopScale: 1000,

  /**
   * 부대 간 밀어내기 거리(m). 없으면 12개 부대가 한 덩어리로 뭉쳐
   * 전선이 사라진다 (프로토타입에서 확인된 것).
   *
   * **같은 편끼리만 민다.** 적까지 밀어내면 근접 부대가 영영 못 붙는다 —
   * 처음에 그렇게 두었더니 보병이 333m 앞에서 평형을 이루고 서로 쳐다보기만
   * 했다. 이 힘은 아군이 한 덩어리가 되는 것을 막으려고 있는 것이지
   * 전선을 떼어 놓으려고 있는 것이 아니다.
   */
  separation: 300,
  separationPush: 0.08,

  /** 접촉하면 멈춰 전선을 유지한다. 기병만 계속 기동한다 (프로토타입) */
  holdLineAfterContact: true,

  /** 사기 */
  moraleStart: 100,
  /** 농민병(1단계)은 낮게 시작한다. 급조한 군대는 쉽게 무너진다 (§4.11) */
  moraleStartTier1: 70,
  /** 아군 부대가 깨지면 전군이 이만큼 잃는다 */
  moraleOnAllyLost: 11,
  /** 이 아래면 무너져 물러난다 */
  moraleRout: 15,
  /**
   * 받은 피해가 사기를 깎는 비율.
   *
   * 62 로 두었더니 사기 100 → 15 에 병력의 137% 를 잃어야 해서, 부대가
   * **궤멸할 때까지 물러서지 않았다.** 조우전 한 번에 양쪽이 전멸하면
   * 전략맵으로 돌아갈 군대가 없다. 군대는 전멸하기 전에 무너진다.
   *
   * 150 이면 병력의 절반쯤에서 사기가 바닥난다. 아군 부대가 깨질 때마다
   * 붙는 11 까지 더하면 대개 40~50% 손실에서 전선이 무너진다.
   */
  moraleFromDamage: 150,

  /**
   * 피로 (§4.11). 사기가 「무너지는가」라면 피로는 「버틸 수 있는가」다.
   *
   * 값이 작아 보이지만 틱은 전장 1초다 — 여섯 시간이면 21,600틱이다.
   * 처음에 교전 0.006 으로 두었더니 부대가 두 시간이면 100 에 닿아
   * **싸우지도 못하고 지쳐 쓰러졌다**(실측). 긴 전투에서 압박이 되되
   * 전투를 끝내 버리지는 않는 크기여야 한다.
   */
  fatigueEngaged: 0.0025,
  fatigueMarch: 0.001,
  /**
   * 붙어 있지도 걷지도 않는 동안 도로 빠지는 피로.
   *
   * 이것이 없으면 피로는 **쌓이기만 하는 값**이 되어, 하루가 넘는 공성전에서
   * 한 번도 싸우지 않은 부대가 제풀에 무너진다(실측 — 공격군 열 부대가 성문
   * 앞에 서 있다가 전멸했다). 행군 소모(0.001)보다 조금 작게 두어, 쉬는 것이
   * 이득이되 서 있는 것만으로 원기가 회복되지는 않게 한다.
   */
  fatigueRest: 0.0008,
  /** 이 위부터 위력·이동이 처진다 */
  fatigueSoft: 70,
  /** 여기 닿으면 전투 불능 */
  fatigueMax: 100,
  /** 피로가 100 일 때 남는 위력 */
  fatigueFloor: 0.55,

  /** 측면·후방에서 맞으면 (§4.11 사기 하락 요인) */
  flankBonus: 1.25,
  /** 매복에 걸린 동안 받는 피해 (orders.ts 의 계략) */
  ambushBonus: 1.5,

  /** 한쪽 병력이 이 비율 아래로 떨어지면 승패가 갈린 것으로 본다 */
  breakRatio: 0.25,
  /** 전장 내 최대 시간(초). 이 안에 안 끝나면 무승부로 접는다 */
  maxSeconds: 60 * 60 * 30,
} as const;

/** 계절 보정 (§5.5) */
export const SEASON = {
  /** 여름 — 장마. 수계가 세진다 */
  floodBonus: [1.0, 1.5, 1.0, 1.0],
  /** 가을 — 건조. 화계가 세진다 */
  fireBonus: [1.0, 1.0, 1.5, 1.0],
  /** 겨울 — 강이 얼어 여울 페널티가 사라지고 소모가 늘어난다 */
  winterToll: 1.35,
} as const;

/** 어느 계열이 어느 열에 서야 하는지 — 편성 화면의 안내에 쓴다 */
export const ROW_LABEL: Record<Row, string> = {
  front: '전열',
  mid: '중열',
  rear: '후열',
};
