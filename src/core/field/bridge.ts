/**
 * field/bridge.ts — 전략맵과 전장 사이.
 *
 * 두 층의 말이 다르다. 전략맵은 「군대가 몇 명」으로 말하고 전장은
 * 「누가 몇을 이끄는 부대」로 말한다. 그 통역이 여기 전부 모여 있다.
 * 전장 코어(sim·setup·orders)는 GameState 를 모르고, 전략 코어는
 * FieldState 를 모른다 — 어느 한쪽을 고쳐도 다른 쪽이 흔들리지 않는다.
 *
 * 통역의 요점 하나: **병종은 장수를 따른다** (§1.2). 전략맵에서 무엇을
 * 징병했든, 전장에 서는 부대의 계열은 그 부대를 이끄는 장수의 것이다.
 * 나라가 올린 병종 단계가 그 위에 곱해진다.
 */

import { officerDef } from '../data';
import { seedFromString } from '../rng';
import { armyTroops } from '../state';
import type { FactionId, GameState, OfficerId, PendingBattle, Tier, Troop } from '../types';
import { battlefield } from './battlefield';
import type { FieldEntry, FieldResult, FieldSetup, Row, Side } from './types';
import { MAX_UNITS } from './types';

/** 계열이 제자리로 삼는 열 (§4.5) */
const HOME_ROW: Record<Troop, Row> = { inf: 'front', cav: 'mid', arc: 'rear', str: 'rear' };

/** 이 인물의 성장분까지 반영한 능력치 — 전장이 부를 조회 함수 */
export function fieldStats(state: GameState) {
  return (id: string) => {
    const def = officerDef(id);
    const g = state.officers[id]?.growth ?? {};
    return {
      lead: def.stats.lead + (g.lead ?? 0),
      war: def.stats.war + (g.war ?? 0),
      int: def.stats.int + (g.int ?? 0),
    };
  };
}

function tiersOf(state: GameState, faction: FactionId): Record<Troop, Tier> {
  // 세이브가 예전 것이면 없을 수 있다 — 그때는 1단계로 본다
  return state.factions[faction]?.troopTiers ?? { inf: 1, cav: 1, arc: 1, str: 1 };
}

/**
 * 한 덩이의 병력을 장수들에게 나눈다.
 *
 * 고르게 나누지 않는다. **대장이 본대를 쥔다** — 그래야 대장을 잃으면
 * 전선이 크게 무너지고, 부장을 몇 붙이는 것과 명장 하나를 내는 것이
 * 다른 선택이 된다.
 */
function splitTroops(total: number, officers: OfficerId[], commander?: OfficerId): number[] {
  const n = officers.length;
  if (n === 0) return [];
  const weights = officers.map((id) => (id === commander ? 1.8 : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  // 나머지는 대장에게 — 총합이 어긋나면 전략맵으로 돌아갈 병력이 안 맞는다
  out[0] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

/** 좋은 순으로 12명까지. 대장은 무조건 남는다 */
function pickOfficers(state: GameState, ids: OfficerId[], commander?: OfficerId): OfficerId[] {
  const uniq = [...new Set(ids)].filter((id) => state.officers[id]?.status === 'active');
  if (uniq.length <= MAX_UNITS) return uniq;
  const rest = uniq
    .filter((id) => id !== commander)
    .sort((a, b) => {
      const x = officerDef(a).stats;
      const y = officerDef(b).stats;
      return y.lead + y.war - (x.lead + x.war);
    });
  const head = commander && uniq.includes(commander) ? [commander] : [];
  return [...head, ...rest].slice(0, MAX_UNITS);
}

function entriesFor(
  state: GameState,
  officers: OfficerId[],
  total: number,
  commander?: OfficerId
): FieldEntry[] {
  const chosen = pickOfficers(state, officers, commander);
  if (!chosen.length) return [];
  const shares = splitTroops(total, chosen, commander);
  return chosen.map((id, i) => {
    const def = officerDef(id);
    return {
      officer: id,
      troops: Math.max(1, shares[i]),
      row: HOME_ROW[def.troop],
      reserve: false,
      navy: false,
    };
  });
}

/**
 * 여섯 부대가 넘으면 뒤쪽 둘을 예비대로 돌린다.
 *
 * 전부 전선에 세우면 개입할 여지가 없어져 관전이 된다. 예비대가 있어야
 * 「지금 넣을 것인가」라는 물음이 생긴다 (§4.7).
 */
function markReserve(entries: FieldEntry[]): FieldEntry[] {
  if (entries.length < 6) return entries;
  const n = entries.length;
  return entries.map((e, i) => (i >= n - 2 ? { ...e, reserve: true } : e));
}

/**
 * 전투 대기열 항목 → 전장 편성.
 *
 * 거점 id 와 전장 id 는 1:1 이다(battlemaps.json 을 castles.json 에서 냈다).
 * 그래서 어디서 싸우든 그 땅의 실제 지형 위에서 싸운다.
 */
export function buildFieldSetup(state: GameState, pending: PendingBattle): FieldSetup {
  const castle = state.castles[pending.castle];

  /* --- 공격 측 --- */
  let attackerTroops = 0;
  let attackerOfficers: OfficerId[] = [];
  let commander: OfficerId | undefined;
  for (const aid of pending.attackerArmies) {
    const army = state.armies[aid];
    if (!army) continue;
    attackerTroops += armyTroops(army);
    attackerOfficers.push(...army.officers);
    commander ??= army.commander;
  }

  /* --- 수비 측 --- */
  let defenderTroops = 0;
  const defenderOfficers: OfficerId[] = [];
  let defCommander: OfficerId | undefined;
  for (const did of pending.defenderArmies) {
    const army = state.armies[did];
    if (!army) continue;
    defenderTroops += armyTroops(army);
    defenderOfficers.push(...army.officers);
    defCommander ??= army.commander;
  }
  if (pending.siege && castle.owner === pending.defender) {
    defenderTroops += castle.troops;
    defenderOfficers.push(...castle.officers);
  }

  return {
    fieldId: pending.castle,
    // 같은 판을 다시 돌리면 같은 결과가 나와야 한다 — 시각이 아니라 판에서 낸다
    seed: seedFromString(`${pending.id}:${state.turn}:${state.rng}`),
    season: state.season as 0 | 1 | 2 | 3,
    siege: pending.siege,
    playerSide:
      pending.attacker === state.playerFaction
        ? 'attacker'
        : pending.defender === state.playerFaction
          ? 'defender'
          : null,
    attackerFaction: pending.attacker,
    defenderFaction: pending.defender,
    tiers: {
      attacker: tiersOf(state, pending.attacker),
      defender: tiersOf(state, pending.defender),
    },
    attacker: markReserve(entriesFor(state, attackerOfficers, attackerTroops, commander)),
    defender: markReserve(entriesFor(state, defenderOfficers, defenderTroops, defCommander)),
  };
}

/**
 * 전투가 성립하는가.
 *
 * 한쪽에 이끌 사람이 아무도 없으면 전장을 열 수 없다 — 부대는 장수를 통해서만
 * 존재한다. 그런 경우는 전략맵에서 「싸움 없이」 처리해야 한다.
 */
export function fieldPossible(setup: FieldSetup): boolean {
  return setup.attacker.length > 0 && setup.defender.length > 0;
}

/** 전장이 실제로 있는가 (거점 id 로 찾는다) */
export function hasBattlefield(castleId: string): boolean {
  try {
    battlefield(castleId);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 돌아오는 길
 * ------------------------------------------------------------------ */

/** 한 세력이 이 전투에서 잃은 병력의 비율 — 전략맵의 군대를 줄이는 데 쓴다 */
export function survivalRatio(result: FieldResult, side: Side): number {
  const before =
    side === 'attacker'
      ? result.attackerLoss + sideTroops(result, 'attacker')
      : result.defenderLoss + sideTroops(result, 'defender');
  if (before <= 0) return 0;
  return Math.max(0, Math.min(1, sideTroops(result, side) / before));
}

function sideTroops(result: FieldResult, side: Side): number {
  return result.survivors.filter((s) => s.side === side).reduce((a, s) => a + s.troops, 0);
}
