/**
 * battleState.ts — 전술 전투의 상태와 맵 생성.
 *
 * 전투 모듈은 전략 모듈 없이 단독으로 돌아가야 한다(시스템 상세계획 §1.1).
 * 그러므로 여기서는 GameState 를 import 하지 않고, 필요한 값만 BattleSetup 으로 받는다.
 */

import { unitDef } from '../data';
import { B, wallHp } from '../formulas';
import { RngCursor, seedFromString } from '../rng';
import type { CastleId, FactionId, HexTerrain, OfficerId, Season, UnitTypeId } from '../types';
import { axialToOffset, hexKey, offsetToAxial, type Axial } from './hex';

export type Side = 'attacker' | 'defender';

/**
 * 전투가 아는 장수 정보의 전부.
 * 전략 모듈의 OfficerState/OfficerDef 를 참조하지 않으므로 전투만 따로 띄울 수 있다.
 */
export interface BattleOfficer {
  id: OfficerId;
  name: string;
  stats: { lead: number; war: number; int: number; pol: number; chr: number };
  skills: string[];
}

export interface BattleUnit {
  id: string;
  side: Side;
  unitType: UnitTypeId;
  /** 이 부대를 이끄는 장수 (없을 수 있다) */
  officer: BattleOfficer | null;
  count: number;
  initialCount: number;
  morale: number;
  training: number;
  q: number;
  r: number;
  /** 이번 턴에 남은 이동력 */
  movesLeft: number;
  acted: boolean;
  /** 사기 붕괴로 이탈 */
  routed: boolean;
}

export interface BattleHex {
  q: number;
  r: number;
  terrain: HexTerrain;
  /** 성벽·성문 헥스의 내구도 */
  wallHp?: number;
  maxWallHp?: number;
}

export interface BattleResult {
  winner: Side;
  reason: 'annihilation' | 'rout' | 'keep_taken' | 'timeout' | 'withdraw';
  attackerLoss: number;
  defenderLoss: number;
  /** 생존 부대 (전략맵으로 되돌린다) */
  survivors: Array<{ side: Side; unitType: UnitTypeId; count: number; morale: number }>;
  capturedOfficers: OfficerId[];
  deadOfficers: OfficerId[];
}

export interface BattleState {
  id: string;
  castle: CastleId;
  castleName: string;
  siege: boolean;
  season: Season;
  cols: number;
  rows: number;
  hexes: Record<string, BattleHex>;
  units: Record<string, BattleUnit>;
  order: string[];
  turn: number;
  maxTurns: number;
  activeSide: Side;
  attackerFaction: FactionId;
  defenderFaction: FactionId;
  /** 산성 보정을 받는 전투인가 */
  mountainFortress: boolean;
  /** 플레이어가 조작하는 진영 (null = 관전) */
  playerSide: Side | null;
  log: string[];
  finished: boolean;
  result: BattleResult | null;
  rng: number;
  nextUnitId: number;
}

export interface BattleForceStack {
  unitType: UnitTypeId;
  count: number;
  officer?: BattleOfficer | null;
  morale?: number;
  training?: number;
}

export interface BattleSetup {
  castle: CastleId;
  castleName: string;
  siege: boolean;
  season: Season;
  /** 전략맵 지형 — 전투맵 생성 규칙을 정한다 */
  terrain: 'plain' | 'mountain' | 'river' | 'coast';
  /** 산성 여부 */
  mountainFortress: boolean;
  /** 성곽 개발도 (성벽 HP 산출) */
  wallDev: number;
  attackerFaction: FactionId;
  defenderFaction: FactionId;
  attacker: BattleForceStack[];
  defender: BattleForceStack[];
  attackerMorale: number;
  defenderMorale: number;
  attackerTraining: number;
  defenderTraining: number;
  playerSide: Side | null;
  seed?: number;
}

/** 한 스택이 담을 수 있는 최대 병력. 넘으면 여러 부대로 쪼갠다. */
export const MAX_STACK = 4000;

export const DEFAULT_COLS = 13;
export const DEFAULT_ROWS = 9;

/* ------------------------------------------------------------------ *
 * 맵 생성
 * ------------------------------------------------------------------ */

function generateTerrain(
  cols: number,
  rows: number,
  setup: BattleSetup,
  rng: RngCursor
): Record<string, BattleHex> {
  const hexes: Record<string, BattleHex> = {};
  const wallCol = cols - 5;
  const keepCol = cols - 2;
  const midRow = Math.floor(rows / 2);
  const maxWall = wallHp(setup.wallDev);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = offsetToAxial(col, row);
      let terrain: HexTerrain = 'plain';

      // --- 기본 지형 (전략맵 지형에 따라) ---
      switch (setup.terrain) {
        case 'mountain':
          terrain = rng.chance(0.3) ? 'mountain' : rng.chance(0.45) ? 'hill' : 'plain';
          break;
        case 'river':
          // 세로로 강이 흐른다. 도하 지점이 승부처가 된다.
          terrain = col === Math.floor(cols * 0.42) ? 'river' : rng.chance(0.2) ? 'forest' : 'plain';
          break;
        case 'coast':
          terrain = col < 3 ? (rng.chance(0.5) ? 'mudflat' : 'plain') : rng.chance(0.15) ? 'forest' : 'plain';
          break;
        default:
          terrain = rng.chance(0.18) ? 'forest' : rng.chance(0.12) ? 'hill' : 'plain';
      }

      // --- 공성 지형 덮어쓰기 ---
      if (setup.siege) {
        if (col === wallCol) {
          terrain = row === midRow ? 'gate' : 'wall';
        } else if (col === keepCol && row === midRow) {
          terrain = 'keep';
        } else if (col > wallCol) {
          terrain = 'plain'; // 성 안쪽은 평지
        }
      }

      const hex: BattleHex = { q: a.q, r: a.r, terrain };
      if (terrain === 'wall' || terrain === 'gate') {
        hex.maxWallHp = terrain === 'gate' ? Math.round(maxWall * 0.7) : maxWall;
        hex.wallHp = hex.maxWallHp;
      }
      hexes[hexKey(a.q, a.r)] = hex;
    }
  }
  return hexes;
}

/* ------------------------------------------------------------------ *
 * 부대 배치
 * ------------------------------------------------------------------ */

function splitStacks(stacks: BattleForceStack[]): BattleForceStack[] {
  const out: BattleForceStack[] = [];
  for (const s of stacks) {
    let remaining = s.count;
    let first = true;
    while (remaining > 0) {
      const take = Math.min(MAX_STACK, remaining);
      out.push({ ...s, count: take, officer: first ? s.officer ?? null : null });
      remaining -= take;
      first = false;
    }
  }
  return out.filter((s) => s.count > 0);
}

function deployColumns(side: Side, cols: number, siege: boolean): number[] {
  if (side === 'attacker') return [0, 1, 2];
  if (siege) {
    // 수비는 성벽 뒤에 선다.
    const wallCol = cols - 5;
    return [wallCol, wallCol + 1, wallCol + 2];
  }
  return [cols - 1, cols - 2, cols - 3];
}

function placeSide(
  state: BattleState,
  side: Side,
  stacks: BattleForceStack[],
  morale: number,
  training: number,
  rng: RngCursor
): void {
  const columns = deployColumns(side, state.cols, state.siege);
  const rows = Array.from({ length: state.rows }, (_, i) => i);
  // 가운데 줄부터 채운다.
  const mid = Math.floor(state.rows / 2);
  rows.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));

  const slots: Axial[] = [];
  for (const col of columns) {
    for (const row of rows) {
      const a = offsetToAxial(col, row);
      const hex = state.hexes[hexKey(a.q, a.r)];
      if (!hex) continue;
      // 수비 측은 성벽 위에도 설 수 있다.
      if (hex.terrain === 'river') continue;
      if (hex.terrain === 'keep') continue;
      if ((hex.terrain === 'wall' || hex.terrain === 'gate') && side !== 'defender') continue;
      slots.push(a);
    }
  }

  const list = splitStacks(stacks);
  list.forEach((s, i) => {
    const spot = slots[i % Math.max(1, slots.length)];
    if (!spot) return;
    const id = `u${state.nextUnitId++}`;
    state.units[id] = {
      id,
      side,
      unitType: s.unitType,
      officer: s.officer ?? null,
      count: s.count,
      initialCount: s.count,
      morale: Math.round((s.morale ?? morale) * rng.jitter(0.04)),
      training: s.training ?? training,
      q: spot.q,
      r: spot.r,
      movesLeft: 0,
      acted: false,
      routed: false,
    };
  });

  // 같은 칸에 겹친 부대를 인접 빈 칸으로 흩는다.
  spreadOverlaps(state);
}

function spreadOverlaps(state: BattleState): void {
  const occupied = new Set<string>();
  for (const u of Object.values(state.units)) {
    let key = hexKey(u.q, u.r);
    if (!occupied.has(key)) {
      occupied.add(key);
      continue;
    }
    // 빈 칸을 찾아 옮긴다.
    const found = Object.values(state.hexes).find((h) => {
      const k = hexKey(h.q, h.r);
      if (occupied.has(k)) return false;
      if (h.terrain === 'river' || h.terrain === 'keep') return false;
      if ((h.terrain === 'wall' || h.terrain === 'gate') && u.side !== 'defender') return false;
      return true;
    });
    if (found) {
      u.q = found.q;
      u.r = found.r;
      key = hexKey(u.q, u.r);
    }
    occupied.add(key);
  }
}

/* ------------------------------------------------------------------ *
 * 생성
 * ------------------------------------------------------------------ */

export function createBattle(setup: BattleSetup): BattleState {
  const seed = setup.seed ?? seedFromString(`${setup.castle}:${setup.attackerFaction}`);
  const rng = new RngCursor(seed);

  const state: BattleState = {
    id: `b_${setup.castle}_${Math.abs(seed) % 100000}`,
    castle: setup.castle,
    castleName: setup.castleName,
    siege: setup.siege,
    season: setup.season,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    hexes: {},
    units: {},
    order: [],
    turn: 1,
    maxTurns: B.maxBattleTurns,
    activeSide: 'attacker',
    attackerFaction: setup.attackerFaction,
    defenderFaction: setup.defenderFaction,
    mountainFortress: setup.mountainFortress,
    playerSide: setup.playerSide,
    log: [],
    finished: false,
    result: null,
    rng: rng.seed,
    nextUnitId: 1,
  };

  state.hexes = generateTerrain(state.cols, state.rows, setup, rng);
  placeSide(state, 'attacker', setup.attacker, setup.attackerMorale, setup.attackerTraining, rng);
  placeSide(state, 'defender', setup.defender, setup.defenderMorale, setup.defenderTraining, rng);
  state.rng = rng.seed;

  state.log.push(
    setup.siege
      ? `${setup.castleName} 공방전이 시작되었다.`
      : `${setup.castleName} 앞 들에서 양군이 마주쳤다.`
  );
  beginTurn(state, 'attacker');
  return state;
}

/* ------------------------------------------------------------------ *
 * 조회
 * ------------------------------------------------------------------ */

export function hexAt(state: BattleState, q: number, r: number): BattleHex | undefined {
  return state.hexes[hexKey(q, r)];
}

/** 성벽이 서 있는 열 */
export function fortressColumn(state: BattleState): number {
  return state.cols - 5;
}

/** 이 칸이 성벽선 안쪽(수비 측 진지)인가 */
export function isInsideFortress(state: BattleState, q: number, r: number): boolean {
  return axialToOffset({ q, r }).col >= fortressColumn(state);
}

export function unitAt(state: BattleState, q: number, r: number): BattleUnit | undefined {
  return Object.values(state.units).find((u) => u.q === q && u.r === r && !u.routed && u.count > 0);
}

export function livingUnits(state: BattleState, side?: Side): BattleUnit[] {
  return Object.values(state.units).filter(
    (u) => !u.routed && u.count > 0 && (side === undefined || u.side === side)
  );
}

export function sideTroops(state: BattleState, side: Side): number {
  return livingUnits(state, side).reduce((s, u) => s + u.count, 0);
}

/** 이동 비용. 통과 불가면 null. */
export function moveCost(
  state: BattleState,
  unit: BattleUnit,
  hex: BattleHex | undefined
): number | null {
  if (!hex) return null;
  const def = unitDef(unit.unitType);
  switch (hex.terrain) {
    case 'plain':
      return 1;
    case 'forest':
      return 2;
    case 'hill':
      return 2;
    case 'mountain':
      return def.class === 'cavalry' || def.class === 'siege' ? null : 3;
    case 'river':
      if (def.naval) return 1;
      return state.season === 3 ? 1 : 3; // 겨울 결빙
    case 'mudflat':
      return def.naval ? 1 : 2;
    case 'wall':
    case 'gate':
      // 수비는 성벽 위에 설 수 있고, 공격은 무너진 뒤에만 넘어간다.
      if (unit.side === 'defender') return 2;
      return (hex.wallHp ?? 0) <= 0 ? 2 : null;
    case 'keep':
      return 1;
    default:
      return 1;
  }
}

/** 해당 진영의 턴을 시작한다 (이동력·행동 초기화). */
export function beginTurn(state: BattleState, side: Side): void {
  state.activeSide = side;
  for (const u of Object.values(state.units)) {
    if (u.side !== side) continue;
    const def = unitDef(u.unitType);
    u.movesLeft = def.move;
    u.acted = false;
  }
  state.order = livingUnits(state, side).map((u) => u.id);
}
