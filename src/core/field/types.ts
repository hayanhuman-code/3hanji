/**
 * field/types.ts — 전장(戰場)의 타입.
 *
 * 전투 v2 (docs/battle-system.md). 격자 SRPG 를 버리고 온 자리다.
 *
 * 세 가지가 v1 과 다르다.
 *   1. **부대는 칸이 아니라 연속 좌표 위에 있다.** 지형은 밟고 있는 타일로 판정한다.
 *   2. **플레이어는 부대를 옮기지 않는다.** 태세와 목표를 주고, 부대는 계열
 *      규칙에 따라 스스로 움직인다 (§4.3 "옮기는 것이 아니라 지휘하는 것").
 *   3. **강해지는 것은 나라다.** 장수 능력치는 거의 고정이고 국가 병종 단계가
 *      위력을 정한다 (§1.2).
 *
 * 좌표계는 **미터**다. 전장은 7000×5000m 이고 타일 하나가 약 146×156m 다.
 * 픽셀이 아니라 미터로 다루는 이유: 행군 속도를 실제 값(보병 4km/h)으로 쓰면
 * "7km 전장을 가로지르는 데 두 시간"이 저절로 나오고, 그래야 §4.2 의
 * 전투 길이가 계산이 아니라 결과가 된다.
 */

import type { FactionId, OfficerId, Tier, Troop } from '../types';
import type { SiegeContext, SiegeMethod, SiegeState, SiegeTrait } from './siege';

/* ------------------------------------------------------------------ *
 * 전장
 * ------------------------------------------------------------------ */

/** battlemaps.json 의 타일 기호 (legend) */
export type TerrainCode =
  | '.' // 평지
  | 'f' // 숲
  | 'h' // 구릉
  | 'm' // 산악
  | 'X' // 험지 — 통행 불가
  | '~' // 강 — 수군만
  | '=' // 여울
  | 's' // 바다 — 수군만
  | 'M' // 늪
  | 'W' // 성벽
  | 'G' // 성문
  | 'P' // 항구
  | 'r' // 길
  | 'T' // 치(雉) — 성벽 돌출부. 성벽 취급 (§7.1)
  | 'O' // 옹성벽 — 성문 바깥 이중문. HP 는 성벽의 0.6배
  | 'D'; // 해자 — 지날 수는 있으나 그 라운드 방어가 깎인다

/** 전장에 들어오는 방향. 전략맵에서 실제로 이어진 길이다 (§5.4) */
export interface Approach {
  /** 어느 거점에서 오는가 */
  from: string;
  /** 방위각(도) */
  bearing: number;
  /** 전장의 어느 변인가 */
  edge: 'N' | 'E' | 'S' | 'W';
  sea: boolean;
  /** 물로 막혀 있어 도하·상륙이 필요한가 */
  needsWater: boolean;
}

export interface Battlefield {
  id: string;
  name: string;
  type: string;
  /** 타일 수 — 48×32 */
  w: number;
  h: number;
  /** 실제 크기(km) — 7×5 */
  kmW: number;
  kmH: number;
  /** 산악 비율 (0~1). 험지 생성 여부를 가른다 */
  mountainous: number;
  hasSea: boolean;
  hasRiver: boolean;
  ridgeKm: number;
  /** h 줄 × w 글자. 각 글자가 TerrainCode */
  tiles: string[];
  approaches: Approach[];
}

/* ------------------------------------------------------------------ *
 * 부대
 * ------------------------------------------------------------------ */

export type Side = 'attacker' | 'defender';

/** 3열 진형 (§4.5). 부적합 배치에는 페널티가 붙는다 */
export type Row = 'front' | 'mid' | 'rear';

/** 태세 (§4.7) */
export type Stance = 'charge' | 'hold' | 'shoot' | 'wait';

/** 국가 병종 단계 1~4 (§2.1). 세력 상태에 저장되므로 정의는 core/types 에 있다 */
export type { Tier } from '../types';

/**
 * 전장 위의 한 부대.
 *
 * 병력(troops)이 곧 체력이다. 별도의 hp 를 두지 않는 이유: 화면에 블록으로
 * 그릴 때 "병력이 줄면 블록이 작아진다"가 그대로 성립해야 하고(§4.12),
 * 전투가 끝난 뒤 남은 병력이 전략맵으로 돌아가야 한다.
 */
export interface FieldUnit {
  id: string;
  side: Side;
  /** 지휘관. 능력치와 계열의 출처 */
  officer: OfficerId;
  name: string;
  /** 계열은 장수를 따른다. 전직이 없으므로 전투 중에도 바뀌지 않는다 */
  troop: Troop;
  /** 수군으로 편성되었는가. 그러면 물 위를 다니고 육상 상성 밖에 선다 */
  navy: boolean;
  /**
   * 지휘관이 이 부대의 계열이 아니다 (§3.5 지휘 적성 페널티).
   * 무력 반영이 절반으로 줄고 계열 특기가 안 붙는다. 통솔·지력은 그대로다.
   */
  offClass: boolean;
  /** 국가 병종 단계 — 이 부대의 위력을 정하는 가장 큰 값 */
  tier: Tier;
  faction: FactionId;

  troops: number;
  maxTroops: number;
  /** 0 이면 부대가 이탈한다 (§4.11) */
  morale: number;
  /** 70 을 넘으면 처지고 100 이면 전투 불능 (§4.11) */
  fatigue: number;

  /** 전장 좌표(m) */
  x: number;
  y: number;
  row: Row;
  /** 예비대는 전선에 서지 않는다. 투입 명령을 받아야 움직인다 (§4.7) */
  reserve: boolean;
  stance: Stance;
  /** 플레이어가 찍어 준 목표. 없으면 계열 규칙이 알아서 고른다 */
  orderTarget: string | null;
  /** 플레이어가 찍어 준 지점(m). 고지 선점·여울 차단 */
  orderPoint: { x: number; y: number } | null;

  /** 지금 붙어 있는 상대 */
  target: string | null;
  /**
   * 지형을 피해 돌아가는 경로. 앞이 트여 있으면 비어 있다.
   * 강·험지를 만났을 때만 채워진다 — 매 틱 길찾기를 돌릴 이유가 없다.
   */
  path: Array<{ x: number; y: number }>;
  /** 그 경로를 언제 냈는가. 오래되면 다시 낸다 */
  pathAt: number;
  /** 그때의 목표. 목표가 크게 움직이지 않았으면 다시 낼 이유가 없다 */
  pathGoal: { x: number; y: number } | null;
  /** 무너진 적을 쫓는 중인가 (§4.7-1 추격 국면) */
  pursuing: boolean;
  /** 마지막으로 계략을 쓴 시각(틱). 재사용 대기에 쓴다 */
  schemeAt: number | null;
  /** 매복에 걸려 있는 동안 — 이 틱까지는 받는 피해가 커진다 */
  exposedUntil: number | null;
  /** 무너져 물러나는 중 */
  routed: boolean;
  dead: boolean;
  /** 전장에 들어온 시각(틱). 원군은 늦게 들어온다 (§4.7-2) */
  arriveTick: number;
}

/* ------------------------------------------------------------------ *
 * 판
 * ------------------------------------------------------------------ */

/** 전투의 국면 (§4.7-1) */
export type Phase = 'march' | 'clash' | 'waver' | 'pursuit' | 'done';

export interface FieldLogEntry {
  tick: number;
  text: string;
  /** 굵게 — 부대 궤멸·국면 전환처럼 판이 바뀌는 사건 */
  big?: boolean;
}

export interface FieldResult {
  winner: Side | null;
  attackerLoss: number;
  defenderLoss: number;
  /** 살아남아 전략맵으로 돌아갈 부대 */
  survivors: Array<{ officer: OfficerId; side: Side; troops: number }>;
  /** 사로잡힌 장수 */
  captured: OfficerId[];
  ticks: number;
  /** 공성전이면 어떻게 함락됐는가 (§6.3). 재측정에서 분포를 본다 */
  siegeMethod: SiegeMethod | null;
}

export interface FieldState {
  field: Battlefield;
  /**
   * 공격측 → 수비측 방향의 단위벡터.
   *
   * 진입 변이 전장마다 다르므로(N·E·S·W) "뒤쪽"과 "측면"을 x축으로 가정하면
   * 남북으로 붙는 전장에서 후퇴 방향과 측면 판정이 통째로 뒤집힌다.
   */
  axis: { dx: number; dy: number };
  /** 결정론을 위한 시드. 같은 시드면 언제 몇 번을 돌려도 같은 결과다 */
  seed: number;
  rngCursor: number;
  tick: number;
  phase: Phase;
  season: 0 | 1 | 2 | 3;
  /** 공성전인가. 성벽·성문 타일이 뜻을 갖는다 */
  siege: boolean;
  /**
   * 공성전의 판 (§6). 야전이면 null.
   *
   * 성벽·성문 HP 와 병량이 여기 있다. 이 값이 있는 동안 전투는 「누가 더
   * 센가」가 아니라 「어떻게 들어갈 것인가」의 문제가 된다.
   */
  siegeState: SiegeState | null;
  /** 성 밖에서 온 값들 (수비 총대장·지형). 공성 AI 가 읽는다 */
  siegeCtx: SiegeContext;
  /**
   * 성문 자리를 한 번만 찾아 둔다 (undefined = 아직 안 찾음).
   * 매 틱 전장을 훑던 것이 시뮬레이션 시간의 대부분을 먹었다.
   */
  gateAt?: { x: number; y: number } | null;
  attackerFaction: FactionId;
  defenderFaction: FactionId;
  /** 플레이어가 맡은 쪽. null 이면 관전 */
  playerSide: Side | null;
  units: FieldUnit[];
  log: FieldLogEntry[];
  result: FieldResult | null;
}

/* ------------------------------------------------------------------ *
 * 편성
 * ------------------------------------------------------------------ */

/** 한 부대의 편성 지시 */
export interface FieldEntry {
  officer: OfficerId;
  troops: number;
  row: Row;
  reserve: boolean;
  /** 수군으로 낼 것인가. 장수가 naval 이어야 한다 */
  navy?: boolean;
  /**
   * 계열을 지정한다 — **주둔 수비대 전용** (§3.5).
   *
   * 출진 부대의 계열은 장수를 따르지만, 주둔군은 장수의 사병이 아니라
   * 국가의 병력이므로 거점 구성표가 정한다. 비워 두면 장수를 따른다.
   */
  troop?: Troop;
  /** 이름을 따로 준다 — 지휘관 없는 수비대(「城兵」) */
  name?: string;
}

/** 지휘관 없는 부대의 officer 자리. 통솔 40 상당으로 자동 운용된다 (§3.5) */
export const NO_OFFICER = '';

export interface FieldSetup {
  fieldId: string;
  seed: number;
  season: 0 | 1 | 2 | 3;
  siege: boolean;
  playerSide: Side | null;
  attackerFaction: FactionId;
  defenderFaction: FactionId;
  /** 세력별 병종 단계 */
  tiers: Record<Side, Record<Troop, Tier>>;
  /** 공성전일 때 — 성곽 개발도와 성 안의 병량 (§6.2) */
  wallDev?: number;
  grain?: number;
  /** 수비 총대장의 매력·성향. 내응 성공률에 쓴다 (§6.3-④) */
  wardenChr?: number;
  wardenTrait?: SiegeTrait;
  attacker: FieldEntry[];
  defender: FieldEntry[];
}

/** 한쪽이 낼 수 있는 부대 수 (§4.2 — 초안의 6에서 올렸다) */
export const MAX_UNITS = 12;

/** 초당 틱. 1틱 = 전장 1초 */
export const TICKS_PER_SEC = 10;
