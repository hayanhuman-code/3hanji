/**
 * battleEngine.ts — 전술 전투의 규칙.
 *
 * 순수 함수는 아니지만(성능상 BattleState 를 제자리에서 고친다),
 * 외부 상태를 전혀 건드리지 않으므로 전투만 따로 시뮬레이션할 수 있다.
 */

import { unitDef } from '../data';
import { B, computeDamage, hasSkill, moraleLoss, stackPower, wallDamage } from '../formulas';
import { RngCursor } from '../rng';
import { clamp } from '../util';
import {
  beginTurn,
  hexAt,
  isInsideFortress,
  livingUnits,
  moveCost,
  sideTroops,
  unitAt,
  type BattleResult,
  type BattleState,
  type BattleUnit,
  type Side,
} from './battleState';
import { hexDistance, hexKey, hexNeighbors, parseKey, type Axial } from './hex';

export function otherSide(side: Side): Side {
  return side === 'attacker' ? 'defender' : 'attacker';
}

function rngOf(state: BattleState): RngCursor {
  return new RngCursor(state.rng);
}

function commitRng(state: BattleState, rng: RngCursor): void {
  state.rng = rng.seed;
}

/* ------------------------------------------------------------------ *
 * 이동
 * ------------------------------------------------------------------ */

/** 이 부대가 이번 턴에 갈 수 있는 칸과 그 비용 (다익스트라) */
export function reachable(state: BattleState, unit: BattleUnit): Map<string, number> {
  const dist = new Map<string, number>();
  const start = hexKey(unit.q, unit.r);
  dist.set(start, 0);
  const frontier: Array<{ key: string; cost: number }> = [{ key: start, cost: 0 }];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift()!;
    if (cur.cost > (dist.get(cur.key) ?? Infinity)) continue;
    const pos = parseKey(cur.key);
    for (const nb of hexNeighbors(pos)) {
      const hex = hexAt(state, nb.q, nb.r);
      const cost = moveCost(state, unit, hex);
      if (cost === null) continue;
      const occupant = unitAt(state, nb.q, nb.r);
      if (occupant && occupant.id !== unit.id) continue; // 부대는 겹칠 수 없다
      const total = cur.cost + cost;
      if (total > unit.movesLeft) continue;
      const key = hexKey(nb.q, nb.r);
      if (total < (dist.get(key) ?? Infinity)) {
        dist.set(key, total);
        frontier.push({ key, cost: total });
      }
    }
  }
  dist.delete(start);
  return dist;
}

/** 부대를 옮긴다. 성공하면 true. */
export function moveUnit(state: BattleState, unitId: string, to: Axial): boolean {
  const u = state.units[unitId];
  if (!u || u.routed || u.side !== state.activeSide || u.acted) return false;
  const reach = reachable(state, u);
  const cost = reach.get(hexKey(to.q, to.r));
  if (cost === undefined) return false;
  u.q = to.q;
  u.r = to.r;
  u.movesLeft -= cost;
  checkKeepCapture(state);
  return true;
}

/* ------------------------------------------------------------------ *
 * 공격
 * ------------------------------------------------------------------ */

function effectiveRange(u: BattleUnit): number {
  const def = unitDef(u.unitType);
  return def.range + (hasSkill(u.officer ?? undefined, 'archery') && def.class === 'archer' ? 1 : 0);
}

/** 이 부대가 지금 칠 수 있는 적 부대 */
export function attackableUnits(state: BattleState, unit: BattleUnit): BattleUnit[] {
  if (unit.acted || unit.routed) return [];
  const range = effectiveRange(unit);
  return livingUnits(state, otherSide(unit.side)).filter(
    (e) => hexDistance(unit, e) <= range
  );
}

/** 이 부대가 지금 칠 수 있는 성벽 칸 */
export function attackableWalls(state: BattleState, unit: BattleUnit): Axial[] {
  if (unit.acted || unit.routed || unit.side !== 'attacker') return [];
  const range = effectiveRange(unit);
  const out: Axial[] = [];
  for (const hex of Object.values(state.hexes)) {
    if ((hex.terrain !== 'wall' && hex.terrain !== 'gate') || (hex.wallHp ?? 0) <= 0) continue;
    if (hexDistance(unit, hex) <= range) out.push({ q: hex.q, r: hex.r });
  }
  return out;
}

/** 부대가 서 있는 칸이 도하 중(강)인가 */
function isCrossingRiver(state: BattleState, u: BattleUnit): boolean {
  const hex = hexAt(state, u.q, u.r);
  return hex?.terrain === 'river' && state.season !== 3;
}

function terrainOf(state: BattleState, u: BattleUnit) {
  return hexAt(state, u.q, u.r)?.terrain ?? 'plain';
}

/** 부대 공격. 반환값은 로그 문자열. */
export function attackUnit(state: BattleState, attackerId: string, targetId: string): string | null {
  const a = state.units[attackerId];
  const d = state.units[targetId];
  if (!a || !d || a.acted || a.routed || d.routed) return null;
  if (a.side !== state.activeSide) return null;
  if (hexDistance(a, d) > effectiveRange(a)) return null;

  const rng = rngOf(state);
  const aDef = unitDef(a.unitType);
  const dDef = unitDef(d.unitType);
  const onWall = ['wall', 'gate'].includes(terrainOf(state, d));

  const attackerTotal = sideTroops(state, a.side);
  const defenderTotal = sideTroops(state, d.side);

  const dmg = computeDamage({
    attackerCount: a.count,
    attackerUnit: aDef,
    attackerMorale: a.morale,
    attackerTraining: a.training,
    attackerOfficer: a.officer ?? undefined,
    attackerTerrain: terrainOf(state, a),
    defenderCount: d.count,
    defenderUnit: dDef,
    defenderMorale: d.morale,
    defenderTraining: d.training,
    defenderOfficer: d.officer ?? undefined,
    defenderTerrain: terrainOf(state, d),
    season: state.season,
    onWall,
    mountainFortress: state.mountainFortress && d.side === 'defender',
    defenderCrossingRiver: isCrossingRiver(state, d),
    attackerForceRatio: attackerTotal / Math.max(1, defenderTotal),
    jitter: rng.float(0.85, 1.15),
  });

  const before = d.count;
  d.count = Math.max(0, d.count - dmg);
  d.morale -= moraleLoss(dmg, before, hasSkill(a.officer ?? undefined, 'intimidate'));

  let text = `${label(a)}이(가) ${label(d)}을(를) 쳐 ${dmg.toLocaleString()}명을 잃게 했다.`;
  if (isCrossingRiver(state, d) && !dDef.naval) {
    text += ' 물을 건너던 대열이 무너졌다!';
  }

  // 반격 — 근접전이고 방어 측이 살아 있으면
  if (d.count > 0 && !d.routed && hexDistance(a, d) <= effectiveRange(d)) {
    const counter = Math.round(
      computeDamage({
        attackerCount: d.count,
        attackerUnit: dDef,
        attackerMorale: d.morale,
        attackerTraining: d.training,
        attackerOfficer: d.officer ?? undefined,
        attackerTerrain: terrainOf(state, d),
        defenderCount: a.count,
        defenderUnit: aDef,
        defenderMorale: a.morale,
        defenderTraining: a.training,
        defenderOfficer: a.officer ?? undefined,
        defenderTerrain: terrainOf(state, a),
        season: state.season,
        onWall: false,
        mountainFortress: false,
        defenderCrossingRiver: isCrossingRiver(state, a),
        attackerForceRatio: defenderTotal / Math.max(1, attackerTotal),
        jitter: rng.float(0.85, 1.15),
      }) * 0.6
    );
    const aBefore = a.count;
    a.count = Math.max(0, a.count - counter);
    a.morale -= moraleLoss(counter, aBefore, hasSkill(d.officer ?? undefined, 'intimidate'));
    text += ` 반격으로 ${counter.toLocaleString()}명을 잃었다.`;
  }

  a.acted = true;
  a.movesLeft = 0;
  finalizeUnit(state, a);
  finalizeUnit(state, d);
  commitRng(state, rng);
  state.log.push(text);
  checkEnd(state);
  return text;
}

/** 성벽 공격 */
export function attackWall(state: BattleState, attackerId: string, target: Axial): string | null {
  const a = state.units[attackerId];
  const hex = hexAt(state, target.q, target.r);
  if (!a || !hex || a.acted || a.routed || a.side !== state.activeSide) return null;
  if (!['wall', 'gate'].includes(hex.terrain) || (hex.wallHp ?? 0) <= 0) return null;
  if (hexDistance(a, hex) > effectiveRange(a)) return null;

  const dmg = wallDamage(a.count, unitDef(a.unitType), a.officer ?? undefined);
  hex.wallHp = Math.max(0, (hex.wallHp ?? 0) - dmg);
  a.acted = true;
  a.movesLeft = 0;

  const text =
    hex.wallHp <= 0
      ? `${label(a)}의 공격으로 ${hex.terrain === 'gate' ? '성문' : '성벽'}이 무너졌다!`
      : `${label(a)}이(가) ${hex.terrain === 'gate' ? '성문' : '성벽'}을 쳤다. (내구 ${hex.wallHp}/${hex.maxWallHp})`;
  state.log.push(text);
  return text;
}

function label(u: BattleUnit): string {
  const name = unitDef(u.unitType).name;
  return u.officer ? `${u.officer.name}의 ${name}` : name;
}

/** 사기·병력 상태에 따라 붕괴 여부를 갱신한다. */
function finalizeUnit(state: BattleState, u: BattleUnit): void {
  u.morale = clamp(u.morale, 0, 100);
  if (u.count <= 0) {
    u.count = 0;
    u.routed = true;
    state.log.push(`${label(u)}이(가) 전멸했다.`);
    return;
  }
  if (u.morale <= B.routMorale) {
    u.routed = true;
    state.log.push(`${label(u)}이(가) 사기를 잃고 무너졌다.`);
  }
}

/* ------------------------------------------------------------------ *
 * 턴 진행·종료
 * ------------------------------------------------------------------ */

/** 공격 측이 천수(天守)를 밟으면 즉시 함락 */
function checkKeepCapture(state: BattleState): void {
  if (!state.siege || state.finished) return;
  const keep = Object.values(state.hexes).find((h) => h.terrain === 'keep');
  if (!keep) return;
  const occ = unitAt(state, keep.q, keep.r);
  if (occ && occ.side === 'attacker') {
    finish(state, 'attacker', 'keep_taken');
  }
}

export function endSideTurn(state: BattleState): void {
  if (state.finished) return;
  const next = otherSide(state.activeSide);
  if (next === 'attacker') {
    state.turn += 1;
    applyTurnUpkeep(state);
    if (state.turn > state.maxTurns) {
      // 시간 초과 — 공성이면 공격 실패
      finish(state, 'defender', 'timeout');
      return;
    }
  }
  beginTurn(state, next);
  checkEnd(state);
}

/** 라운드마다 사기가 조금씩 회복되고, 통합 특기가 아군을 북돋운다. */
function applyTurnUpkeep(state: BattleState): void {
  const unifySides = new Set<Side>();
  for (const u of livingUnits(state)) {
    if (hasSkill(u.officer ?? undefined, 'unify')) unifySides.add(u.side);
  }
  for (const u of livingUnits(state)) {
    u.morale = clamp(u.morale + (unifySides.has(u.side) ? 3 : 1), 0, 100);
  }
}

export function checkEnd(state: BattleState): boolean {
  if (state.finished) return true;
  const atk = livingUnits(state, 'attacker');
  const def = livingUnits(state, 'defender');
  if (atk.length === 0 && def.length === 0) {
    finish(state, 'defender', 'annihilation');
    return true;
  }
  if (atk.length === 0) {
    finish(state, 'defender', 'annihilation');
    return true;
  }
  if (def.length === 0) {
    finish(state, 'attacker', 'annihilation');
    return true;
  }
  return false;
}

/** 퇴각 선언 */
export function withdraw(state: BattleState, side: Side): void {
  if (state.finished) return;
  state.log.push(`${side === 'attacker' ? '공격' : '수비'} 측이 물러났다.`);
  finish(state, otherSide(side), 'withdraw');
}

function finish(state: BattleState, winner: Side, reason: BattleResult['reason']): void {
  if (state.finished) return;
  const rng = rngOf(state);
  state.finished = true;

  let attackerLoss = 0;
  let defenderLoss = 0;
  const survivors: BattleResult['survivors'] = [];
  const capturedOfficers: string[] = [];
  const deadOfficers: string[] = [];

  for (const u of Object.values(state.units)) {
    const lost = u.initialCount - u.count;
    if (u.side === 'attacker') attackerLoss += lost;
    else defenderLoss += lost;

    const lostSide = u.side !== winner;
    if (u.routed || u.count <= 0) {
      // 무너진 부대는 절반쯤만 수습된다.
      const salvage = lostSide ? 0 : Math.round(u.count * 0.5);
      if (salvage > 0) {
        survivors.push({ side: u.side, unitType: u.unitType, count: salvage, morale: 30 });
      }
      if (u.side === 'attacker') attackerLoss += u.count - salvage;
      else defenderLoss += u.count - salvage;

      if (u.officer) {
        // 지휘관의 운명: 전사 / 사로잡힘 / 도주
        const roll = rng.next();
        if (roll < 0.12) deadOfficers.push(u.officer.id);
        else if (roll < 0.4 && lostSide) capturedOfficers.push(u.officer.id);
      }
    } else if (u.count > 0) {
      survivors.push({ side: u.side, unitType: u.unitType, count: u.count, morale: u.morale });
    }
  }

  state.result = {
    winner,
    reason,
    attackerLoss,
    defenderLoss,
    survivors,
    capturedOfficers,
    deadOfficers,
  };
  const reasonText: Record<BattleResult['reason'], string> = {
    annihilation: '적을 모두 흩었다',
    rout: '적이 무너졌다',
    keep_taken: '성이 떨어졌다',
    timeout: '해가 저물도록 성은 열리지 않았다',
    withdraw: '적이 물러났다',
  };
  state.log.push(
    `전투 종료 — ${winner === 'attacker' ? '공격' : '수비'} 측 승리. ${reasonText[reason]}.`
  );
  commitRng(state, rng);
}

/* ------------------------------------------------------------------ *
 * 전투 AI
 * ------------------------------------------------------------------ */

function unitValue(u: BattleUnit): number {
  return stackPower(u.count, unitDef(u.unitType), u.morale, u.training, u.officer ?? undefined);
}

/** 한 부대의 AI 행동 */
function actUnit(state: BattleState, unit: BattleUnit): void {
  if (unit.acted || unit.routed || state.finished) return;

  // 1) 지금 칠 수 있는 적 중 가장 이득이 큰 대상을 친다.
  const best = pickBestTarget(state, unit);
  if (best) {
    attackUnit(state, unit.id, best.id);
    return;
  }

  // 2) 공성병기라면 성벽을 노린다.
  const def = unitDef(unit.unitType);
  if (unit.side === 'attacker' && state.siege) {
    const walls = attackableWalls(state, unit);
    if (walls.length > 0 && (def.siege || livingUnits(state, 'defender').length === 0)) {
      const gate = walls.find((w) => hexAt(state, w.q, w.r)?.terrain === 'gate') ?? walls[0];
      attackWall(state, unit.id, gate);
      return;
    }
  }

  // 3) 이동 — 적(또는 성문/천수)에 다가간다.
  const goal = pickGoal(state, unit);
  if (goal) {
    const reach = reachable(state, unit);
    let bestKey: string | null = null;
    let bestScore = Infinity;
    const holdFortress = state.siege && unit.side === 'defender';
    for (const [key] of reach) {
      const pos = parseKey(key);
      const hex = hexAt(state, pos.q, pos.r);
      if (!hex) continue;
      // 농성 중인 수비는 성벽선 밖으로 나가지 않는다. 나가는 순간 성곽 보정을 버리는 셈이다.
      if (holdFortress && !isInsideFortress(state, pos.q, pos.r)) continue;
      // 강 한복판에서 턴을 마치는 것은 자살행위다(도하 중 피격 배율).
      const riverPenalty = hex.terrain === 'river' && state.season !== 3 && !def.naval ? 6 : 0;
      // 성벽 위는 방어 보정을 받으므로 수비는 되도록 성벽에 붙는다.
      const wallBonus =
        holdFortress && (hex.terrain === 'wall' || hex.terrain === 'gate') ? -2 : 0;
      const score = hexDistance(pos, goal) + riverPenalty + wallBonus;
      if (score < bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    if (bestKey) moveUnit(state, unit.id, parseKey(bestKey));
  }

  // 4) 이동 후 다시 공격을 시도한다.
  const after = pickBestTarget(state, unit);
  if (after) attackUnit(state, unit.id, after.id);
  else if (unit.side === 'attacker' && state.siege) {
    const walls = attackableWalls(state, unit);
    if (walls.length > 0) {
      const gate = walls.find((w) => hexAt(state, w.q, w.r)?.terrain === 'gate') ?? walls[0];
      attackWall(state, unit.id, gate);
    }
  }
  unit.acted = true;
}

function pickBestTarget(state: BattleState, unit: BattleUnit): BattleUnit | null {
  const targets = attackableUnits(state, unit);
  if (targets.length === 0) return null;
  const aDef = unitDef(unit.unitType);
  let best: BattleUnit | null = null;
  let bestScore = -Infinity;
  for (const t of targets) {
    const tDef = unitDef(t.unitType);
    const counter = aDef.counters[tDef.class] ?? 1;
    const onWall = ['wall', 'gate'].includes(hexAt(state, t.q, t.r)?.terrain ?? 'plain');
    // 상성이 좋고, 약해져 있고, 성벽 위가 아닌 적을 노린다.
    const score =
      counter * 100 - (t.count / Math.max(1, t.initialCount)) * 40 - (onWall ? 45 : 0) + (100 - t.morale) * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function pickGoal(state: BattleState, unit: BattleUnit): Axial | null {
  const enemies = livingUnits(state, otherSide(unit.side));
  const def = unitDef(unit.unitType);

  if (unit.side === 'attacker' && state.siege) {
    // 성문이 열렸으면 천수로 밀고 들어간다.
    const gate = Object.values(state.hexes).find((h) => h.terrain === 'gate');
    const keep = Object.values(state.hexes).find((h) => h.terrain === 'keep');
    if (gate && (gate.wallHp ?? 0) <= 0 && keep) return { q: keep.q, r: keep.r };
    if (def.siege && gate) return { q: gate.q, r: gate.r };
  }

  if (enemies.length === 0) {
    const keep = Object.values(state.hexes).find((h) => h.terrain === 'keep');
    return keep ? { q: keep.q, r: keep.r } : null;
  }

  // 가장 가까우면서 값어치 있는 적
  let best: BattleUnit | null = null;
  let bestScore = -Infinity;
  for (const e of enemies) {
    const score = unitValue(e) / Math.max(1, hexDistance(unit, e));
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

/** 현재 진영의 AI 턴을 전부 실행한다. */
export function runAITurn(state: BattleState): void {
  if (state.finished) return;
  const side = state.activeSide;
  // 사기가 높은(=믿음직한) 부대부터 움직인다.
  const units = livingUnits(state, side).sort((a, b) => b.morale - a.morale);
  for (const u of units) {
    if (state.finished) break;
    actUnit(state, state.units[u.id]);
  }
  if (!state.finished) endSideTurn(state);
}

/**
 * 전투가 끝날 때까지 AI 끼리 돌린다 (자동 전투·헤드리스 시뮬레이션용).
 * @returns 전투 결과
 */
export function runBattleToEnd(state: BattleState, maxIterations = 200): BattleResult {
  let guard = 0;
  while (!state.finished && guard++ < maxIterations) {
    runAITurn(state);
  }
  if (!state.finished) finish(state, 'defender', 'timeout');
  return state.result!;
}
