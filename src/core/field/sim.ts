/**
 * field/sim.ts — 틱 시뮬레이션.
 *
 * 1틱 = 전장 1초. 배속은 **틱을 더 많이 돌리는 것**이고 렌더링과는 무관하다
 * (§4.9). 그래서 8배속에서도 결과가 1배속과 한 톨도 다르지 않고,
 * 즉시결판은 그냥 「렌더 없이 끝까지 돌리기」다 (§4.8).
 *
 * **난수는 전부 시드에서 나온다.** Math.random 을 부르는 순간 리플레이와
 * 즉시결판 일치가 깨진다 — 그것이 이 파일의 유일한 절대 규칙이다.
 */

import { RngCursor } from '../rng';
import type { Troop } from '../types';
import {
  CLASS,
  COUNTER,
  F,
  FACTION_AFFINITY,
  FORD_AMBUSH,
  NAVY_SPEC,
  ROW_FIT,
  SEASON,
  STANCE,
  TIER_NAME,
  TIER_POWER,
} from './balance';
import { passable, specAt, terrainAt } from './battlefield';
import { findFieldPath, lineOfMarch } from './pathfind';
import type { FieldState, FieldUnit, Side } from './types';

/** 경로를 다시 내는 주기(틱). 목표가 움직이므로 가끔 고쳐야 한다 */
const PATH_REFRESH = 240;

/* ------------------------------------------------------------------ *
 * 위력
 * ------------------------------------------------------------------ */

const spec = (u: FieldUnit) => (u.navy ? NAVY_SPEC : CLASS[u.troop]);

/**
 * 장수가 부대에 보태는 몫.
 * 책략계만 지력을 본다 — 계략으로 싸우는 사람에게 무력을 묻지 않는다.
 */
function officerAttack(stats: { lead: number; war: number; int: number }, troop: Troop): number {
  if (troop === 'str') return (stats.int * 0.7) / 100;
  return (stats.war * 0.6 + stats.lead * 0.4) / 100;
}

function officerDefense(stats: { lead: number; war: number }): number {
  return (stats.lead * 0.6 + stats.war * 0.4) / 100;
}

/** 세력 계수 — 고구려 기병은 1단계부터 고구려 기병이다 (balance.ts 주석 참조) */
function affinity(u: FieldUnit): number {
  const row = FACTION_AFFINITY[u.faction];
  if (!row) return 1;
  return u.navy ? row.navy : row[u.troop];
}

/** 피로가 쌓이면 처진다. 70 을 넘어서야 듣기 시작한다 (§4.11) */
function fatigueFactor(u: FieldUnit): number {
  if (u.fatigue <= F.fatigueSoft) return 1;
  const over = (u.fatigue - F.fatigueSoft) / (F.fatigueMax - F.fatigueSoft);
  return 1 - over * (1 - F.fatigueFloor);
}

export function unitPower(u: FieldUnit, stats: { lead: number; war: number; int: number }): number {
  const s = spec(u);
  return (
    (u.troops / F.troopScale) *
    s.attack *
    TIER_POWER[u.tier] *
    affinity(u) *
    officerAttack(stats, u.troop) *
    ROW_FIT[u.row][u.troop]! *
    fatigueFactor(u)
  );
}

export function unitDefense(u: FieldUnit, stats: { lead: number; war: number }): number {
  const s = spec(u);
  return (
    Math.max(0.15, u.troops / F.troopScale) *
    s.defense *
    TIER_POWER[u.tier] *
    affinity(u) *
    officerDefense(stats) *
    fatigueFactor(u)
  );
}

/** 화면에도 쓰는 이름 — 「고구려 개마무사」 */
export function unitTitle(u: FieldUnit): string {
  return u.navy ? '수군' : TIER_NAME[u.troop][u.tier];
}

/* ------------------------------------------------------------------ *
 * 한 틱
 * ------------------------------------------------------------------ */

export interface StatsLookup {
  (officer: string): { lead: number; war: number; int: number };
}

const alive = (st: FieldState, side: Side) =>
  st.units.filter((u) => u.side === side && !u.dead && u.arriveTick <= st.tick);

const troopsOf = (st: FieldState, side: Side) =>
  st.units.filter((u) => u.side === side && !u.dead).reduce((s, u) => s + u.troops, 0);

function log(st: FieldState, text: string, big = false) {
  st.log.push({ tick: st.tick, text, big });
  // 로그가 무한정 자라면 긴 전투에서 메모리를 먹는다. 최근 것만 남긴다.
  if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
}

/**
 * 적을 고른다.
 *
 * 기본은 가장 가까운 적이되, **상성이 불리한 상대는 피한다** (§10 리스크).
 * 뻔히 지는 싸움에 부대가 달려들면 플레이어가 화를 낸다. 다만 태세가
 * 「돌격」이면 무시하고 달려든다 — 그래야 개입에 뜻이 생긴다.
 */
function pickTarget(st: FieldState, u: FieldUnit): FieldUnit | null {
  if (u.orderTarget) {
    const forced = st.units.find((v) => v.id === u.orderTarget && !v.dead);
    if (forced) return forced;
  }
  const foes = st.units.filter(
    (v) => v.side !== u.side && !v.dead && !v.routed && v.arriveTick <= st.tick
  );
  if (!foes.length) return null;

  let best: FieldUnit | null = null;
  let bestScore = -Infinity;
  for (const v of foes) {
    const d = Math.hypot(v.x - u.x, v.y - u.y);
    const iCounter = COUNTER[u.troop]?.[v.troop] ?? 1;
    const theyCounter = COUNTER[v.troop]?.[u.troop] ?? 1;
    // 가까울수록·내가 유리할수록 높은 점수
    let score = 6000 / (d + 400) + (iCounter - 1) * 2.2;
    if (u.stance !== 'charge') score -= (theyCounter - 1) * 2.6;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

/** 계열별 자율 행동이 원하는 자리 (§4.6) */
function desiredPoint(st: FieldState, u: FieldUnit, tgt: FieldUnit | null): { x: number; y: number } | null {
  if (u.orderPoint) return u.orderPoint;
  if (u.routed) {
    // 무너진 부대는 제가 들어온 쪽으로 물러난다 (진입 변은 전장마다 다르다)
    const back = u.side === 'attacker' ? -1 : 1;
    return { x: u.x + st.axis.dx * back * 1000, y: u.y + st.axis.dy * back * 1000 };
  }
  if (!tgt) return null;
  const s = spec(u);
  const d = Math.hypot(tgt.x - u.x, tgt.y - u.y);

  if (u.troop === 'arc' || u.troop === 'str') {
    // 사거리를 유지한다. 적이 붙으면 물러난다
    if (d < s.range * 0.75) {
      const ux = (u.x - tgt.x) / (d || 1);
      const uy = (u.y - tgt.y) / (d || 1);
      return { x: u.x + ux * 300, y: u.y + uy * 300 };
    }
    if (d > s.range * 0.95) return { x: tgt.x, y: tgt.y };
    return null;
  }

  if (u.troop === 'cav' && !u.navy) {
    // 기병은 붙어서 밀지 않는다. 옆으로 돌아 측면을 친다
    const ux = (tgt.x - u.x) / (d || 1);
    const uy = (tgt.y - u.y) / (d || 1);
    const flank = d > 500 ? 0.75 : 0.15;
    return { x: tgt.x - ux * 60 + -uy * 900 * flank, y: tgt.y - uy * 60 + ux * 900 * flank };
  }

  return { x: tgt.x, y: tgt.y };
}

/**
 * 측면·후방에서 맞았는가.
 * v 가 바라보는 쪽은 제 적 진영이다. 그 뒤에서 오면 측후방이다.
 */
function isFlanking(st: FieldState, u: FieldUnit, v: FieldUnit): boolean {
  const facing = v.side === 'attacker' ? 1 : -1;
  const along = (u.x - v.x) * st.axis.dx + (u.y - v.y) * st.axis.dy;
  return along * facing < -80;
}

function applyDamage(
  st: FieldState,
  u: FieldUnit,
  v: FieldUnit,
  statsOf: StatsLookup,
  rng: RngCursor
) {
  const atk = unitPower(u, statsOf(u.officer));
  const def = unitDefense(v, statsOf(v.officer));
  const counter = COUNTER[u.troop]?.[v.troop] ?? 1;

  const uGround = specAt(st.field, u.x, u.y);
  const vGround = specAt(st.field, v.x, v.y);
  const terrainAtk = u.troop === 'arc' ? uGround.arc : u.troop === 'cav' ? uGround.cav : uGround.melee;
  const terrainDef = vGround.defense;

  const stanceAtk = STANCE[u.stance].attack[u.troop] ?? 1;
  // 견고는 방어를 올리는 동시에 받는 피해 자체를 깎는다 — 두 갈래로 듣는다
  const vTaken = STANCE[v.stance].taken;
  const vDefStance = STANCE[v.stance].defense;

  const moraleF = 0.55 + (u.morale / 100) * 0.45;
  const flank = isFlanking(st, u, v) ? F.flankBonus : 1;
  // 여울에서 맞으면 두 배 — 살수대첩이 규칙으로 성립하는 자리다 (§5.1)
  const vTile = terrainAt(st.field, v.x, v.y);
  const ford = vTile === '=' || vTile === 'B' ? FORD_AMBUSH : 1;

  const raw =
    (atk * counter * terrainAtk * stanceAtk * moraleF * flank * ford * vTaken) /
    Math.max(0.05, def * terrainDef * vDefStance) /
    F.damageDivisor;

  // 아주 작은 흔들림만 준다. 결과가 시드에 갇혀 있어야 리플레이가 성립한다
  const loss = raw * F.troopScale * rng.float(0.94, 1.06);
  if (loss <= 0) return;

  v.troops = Math.max(0, v.troops - loss);
  v.morale -= (loss / Math.max(1, v.maxTroops)) * F.moraleFromDamage;

  if (counter > 1 && rng.chance(0.0008)) {
    log(
      st,
      `${u.name}(${unitTitle(u)})이(가) ${v.name}(${unitTitle(v)})을(를) 쳤다 — 상성 유리 ${counter}배`
    );
  }
  if (ford > 1 && rng.chance(0.0015)) {
    log(st, `${v.name} 부대가 ${vTile === 'B' ? '다리 위' : '여울'}에서 발이 묶인 채 화살을 맞고 있다.`);
  }

  if (v.troops <= v.maxTroops * 0.04) {
    v.dead = true;
    v.troops = 0;
    log(st, `${v.name} 부대 궤멸.`, true);
    for (const a of st.units) if (a.side === v.side && !a.dead) a.morale -= F.moraleOnAllyLost;
  }
}

/**
 * 아군끼리 한 덩어리로 뭉치지 않게 밀어낸다 (프로토타입에서 검증된 처리).
 *
 * **적은 밀지 않는다.** 적까지 밀어내면 근접 부대가 영영 못 붙는다 —
 * 처음에 그렇게 두었더니 보병이 서로 333m 앞에서 평형을 이루고 여섯 시간을
 * 쳐다보기만 하다 지쳐 쓰러졌다(balance.ts 의 separation 주석 참조).
 */
function separate(st: FieldState) {
  const us = st.units.filter((u) => !u.dead && u.arriveTick <= st.tick);
  for (let i = 0; i < us.length; i++) {
    for (let j = i + 1; j < us.length; j++) {
      const a = us[i];
      const b = us[j];
      if (a.side !== b.side) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d >= F.separation) continue;
      const push = ((F.separation - d) / 2) * F.separationPush;
      const ux = dx / d;
      const uy = dy / d;
      const ax = a.x - ux * push;
      const ay = a.y - uy * push;
      const bx = b.x + ux * push;
      const by = b.y + uy * push;
      if (passable(st.field, ax, ay, a.navy)) {
        a.x = ax;
        a.y = ay;
      }
      if (passable(st.field, bx, by, b.navy)) {
        b.x = bx;
        b.y = by;
      }
    }
  }
}

function updatePhase(st: FieldState) {
  const a = troopsOf(st, 'attacker');
  const d = troopsOf(st, 'defender');
  const a0 = st.units.filter((u) => u.side === 'attacker').reduce((s, u) => s + u.maxTroops, 0);
  const d0 = st.units.filter((u) => u.side === 'defender').reduce((s, u) => s + u.maxTroops, 0);
  const engaged = st.units.some(
    (u) => !u.dead && u.target && Math.hypot(u.x - 0, u.y - 0) >= 0 && u.arriveTick <= st.tick
  );
  const anyContact = st.units.some((u) => {
    if (u.dead || u.arriveTick > st.tick) return false;
    return st.units.some(
      (v) => v.side !== u.side && !v.dead && Math.hypot(v.x - u.x, v.y - u.y) <= spec(u).range
    );
  });
  const routed = st.units.filter((u) => u.routed && !u.dead).length;

  const prev = st.phase;
  if (!anyContact && !engaged && st.phase === 'march') return;
  if (a / a0 < F.breakRatio || d / d0 < F.breakRatio) st.phase = 'pursuit';
  else if (routed > 0) st.phase = 'waver';
  else if (anyContact) st.phase = 'clash';

  if (prev !== st.phase) {
    const names: Record<string, string> = {
      march: '행군',
      clash: '접전',
      waver: '동요',
      pursuit: '추격·퇴각',
    };
    if (names[st.phase]) log(st, `── ${names[st.phase]} ──`, true);
  }
}

function finish(st: FieldState, winner: Side | null) {
  const a0 = st.units.filter((u) => u.side === 'attacker').reduce((s, u) => s + u.maxTroops, 0);
  const d0 = st.units.filter((u) => u.side === 'defender').reduce((s, u) => s + u.maxTroops, 0);
  st.phase = 'done';
  st.result = {
    winner,
    attackerLoss: Math.round(a0 - troopsOf(st, 'attacker')),
    defenderLoss: Math.round(d0 - troopsOf(st, 'defender')),
    survivors: st.units
      .filter((u) => !u.dead)
      .map((u) => ({ officer: u.officer, side: u.side, troops: Math.round(u.troops) })),
    // 무너진 채 남은 쪽의 장수는 사로잡힌다
    captured: st.units.filter((u) => u.dead && u.side !== winner).map((u) => u.officer),
    ticks: st.tick,
  };
  log(
    st,
    winner === null
      ? '해가 저물어 양군이 물러났다.'
      : `${winner === 'attacker' ? '공격 측' : '수비 측'} 승리.`,
    true
  );
}

/**
 * 한 틱 진행. 판을 **제자리에서** 고친다.
 * (전략 코어와 같은 방침이다 — README 「계획과 달라진 점」 참조)
 */
export function step(st: FieldState, statsOf: StatsLookup): void {
  if (st.phase === 'done') return;
  const rng = new RngCursor(st.rngCursor);
  st.tick++;

  const winterToll = st.season === 3 ? SEASON.winterToll : 1;

  for (const u of st.units) {
    if (u.dead || u.arriveTick > st.tick) continue;
    if (u.reserve) continue; // 예비대는 투입 명령을 받아야 움직인다

    const tgt = pickTarget(st, u);
    u.target = tgt?.id ?? null;

    const s = spec(u);
    const ground = specAt(st.field, u.x, u.y);
    const want = desiredPoint(st, u, tgt);

    // ── 이동 ──
    let moved = false;
    if (want) {
      const contact = tgt ? Math.hypot(tgt.x - u.x, tgt.y - u.y) <= s.range : false;
      // 접촉하면 멈춰 전선을 유지한다. 기병만 계속 기동한다 (프로토타입)
      const stay = F.holdLineAfterContact && contact && u.troop !== 'cav' && !u.routed;

      if (!stay) {
        /*
         * 앞이 트여 있으면 그냥 간다. 막혀 있을 때만 길을 찾는다.
         * 강·험지를 만나면 여기서 여울과 고갯길로 돌아가게 된다 — 이것이 없어
         * 양군이 한강을 사이에 두고 아홉 시간을 마주 보기만 한 적이 있다.
         */
        const direct = lineOfMarch(st.field, u, want, u.navy);
        if (direct) {
          u.path = [];
          u.pathGoal = null;
        } else {
          /*
           * 길찾기는 이 판에서 가장 비싼 계산(회당 0.67ms)이다. **시간으로만**
           * 다시 낸다. 「경로가 비었으면 다시 낸다」로 두었더니, 길이 아예
           * 없거나 웨이포인트를 다 쓴 부대가 매 틱 길찾기를 돌려 시뮬레이션이
           * 스무 배 느려졌다.
           */
          const stale = st.tick - u.pathAt > PATH_REFRESH;
          const goalMoved =
            !u.pathGoal || Math.hypot(u.pathGoal.x - want.x, u.pathGoal.y - want.y) > 400;
          if (stale && goalMoved) {
            u.path = findFieldPath(st.field, u, want, u.navy);
            u.pathAt = st.tick;
            u.pathGoal = { x: want.x, y: want.y };
          }
        }

        const goal = u.path.length ? u.path[0] : want;
        const dx = goal.x - u.x;
        const dy = goal.y - u.y;
        const d = Math.hypot(dx, dy);
        if (u.path.length && d < 90) {
          u.path.shift();
        } else if (d > 20) {
          const stepLen = s.speed * ground.move * fatigueFactor(u);
          const nx = u.x + (dx / d) * stepLen;
          const ny = u.y + (dy / d) * stepLen;
          if (passable(st.field, nx, ny, u.navy)) {
            u.x = nx;
            u.y = ny;
            moved = true;
          } else {
            /*
             * 앞이 막혔다. 우선 옆으로 비껴 본다 — 고갯길 어귀에서 부대가
             * 서로 밀릴 때 이 한 걸음이면 풀린다.
             *
             * 여기서 길찾기를 다시 부르면 안 된다. 지형에 붙어 버린 부대가
             * **매 틱** 다시 부르게 되어, 2,500틱에 4,173번이 돌아 시뮬레이션
             * 시간의 99%를 먹었다(실측). 다음 정기 갱신 때 고쳐지게 둔다.
             */
            for (const sign of [1, -1]) {
              const ax = u.x + (-dy / d) * stepLen * sign;
              const ay = u.y + (dx / d) * stepLen * sign;
              if (passable(st.field, ax, ay, u.navy)) {
                u.x = ax;
                u.y = ay;
                moved = true;
                break;
              }
            }
            if (!moved) u.path = [];
          }
        }
      }
    }

    // ── 교전 ──
    if (tgt && !u.routed) {
      const d = Math.hypot(tgt.x - u.x, tgt.y - u.y);
      if (d <= s.range) applyDamage(st, u, tgt, statsOf, rng);
    }

    // ── 사기와 피로 ──
    const stance = STANCE[u.stance];
    const engaged = !!tgt && Math.hypot(tgt.x - u.x, tgt.y - u.y) <= s.range;
    const toll = ground.toll * winterToll;
    u.fatigue += ((engaged ? F.fatigueEngaged : moved ? F.fatigueMarch : 0) + stance.fatigue) * toll;
    u.fatigue = Math.max(0, Math.min(F.fatigueMax, u.fatigue));
    if (!engaged) u.morale = Math.min(100, u.morale + stance.moraleRecover);

    // 사기가 바닥나거나 지쳐 쓰러지면 물러난다
    if (!u.routed && (u.morale <= F.moraleRout || u.fatigue >= F.fatigueMax)) {
      u.routed = true;
      log(st, `${u.name} 부대가 무너져 물러난다.`, true);
    }
    if (u.routed) u.morale = Math.min(100, u.morale + 0.02);
  }

  separate(st);
  updatePhase(st);
  st.rngCursor = rng.seed;

  // ── 끝났는가 ──
  const a = alive(st, 'attacker');
  const d = alive(st, 'defender');
  const aStand = a.filter((u) => !u.routed);
  const dStand = d.filter((u) => !u.routed);
  if (!aStand.length && !dStand.length) finish(st, null);
  else if (!aStand.length) finish(st, 'defender');
  else if (!dStand.length) finish(st, 'attacker');
  else if (st.tick >= F.maxSeconds) finish(st, null);
}

/**
 * 즉시결판 — **같은 시뮬레이션을 렌더링 없이 끝까지 돌린다** (§4.8).
 *
 * 별도의 자동전투 공식을 두지 않는 것이 요점이다. 공식이 하나뿐이므로
 * 관전 결과와 어긋날 수 없고 밸런싱도 한 번만 하면 된다.
 */
export function runToEnd(st: FieldState, statsOf: StatsLookup, limit = F.maxSeconds): FieldState {
  while (st.phase !== 'done' && st.tick < limit) step(st, statsOf);
  if (!st.result) finish(st, null);
  return st;
}
