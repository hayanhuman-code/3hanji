/**
 * turn.ts — 턴 엔진. 모든 모듈의 지휘자 (시스템 상세계획 §3.1)
 *
 * 1턴(1계절) 처리 순서
 *   ① 플레이어 명령 입력 수집   — UI 가 명령을 즉시 적용하므로 여기서는 생략
 *   ② AI 세력 명령 생성
 *   ③ 명령 일괄 해석 — 이동 충돌 → 전투 발생 판정
 *   ④ 전투 처리 (수동이면 화면 진입, 위임이면 자동 계산)
 *   ⑤ 이벤트 트리거 검사
 *   ⑥ 결산: 수입, 병량 소모, 민심·지지도 변동, 인물 사망/등장
 *   ⑦ 상태 저장 → 다음 턴
 *
 * ④·⑤ 는 UI 상호작용이 끼어들 수 있으므로, 턴 처리는 "재개 가능한" 형태로 나뉘어 있다.
 * UI 는 resolveTurn() 이 'battle' / 'event' 를 돌려주면 화면을 띄우고,
 * 처리 후 completeBattle() / completeEvent() 를 호출한 뒤 다시 resolveTurn() 을 부른다.
 */

import { runFactionAI } from './ai';
import {
  castleDef,
  castleName,
  eventDef,
  factionName,
  officerDef,
  officerName,
  officerWindow,
  scenarioDef,
} from './data';
import { driftRelations } from './diplomacy';
import { checkEvents, pickAIChoice, resolveEventChoice } from './events';
import { B, castleIncome, fieldUpkeep, garrisonUpkeep, hasSkill } from './formulas';
import {
  applyBattleResult,
  buildBattleSetup,
  captureCastle,
  disbandArmy,
  resolveAutoBattle,
  resolveMovement,
  resolveSieges,
  tickTruces,
} from './military';
import { RngCursor } from './rng';
import {
  addChronicle,
  addLog,
  armyTroops,
  capitalCastle,
  defaultComposition,
  factionArmies,
  factionCastles,
  factionOfficers,
  factionTraits,
  getRelation,
} from './state';
import { removeOfficerFromWorld } from './effects';
import { checkVictory } from './victory';
import type { BattleResult, BattleSetup } from './battle/battleState';
import type {
  BattleSummary,
  FactionId,
  GameState,
  PendingBattle,
  PendingEvent,
  Season,
  TurnReport,
} from './types';
import { clamp } from './util';

export type TurnStep =
  | { kind: 'battle'; pending: PendingBattle; setup: BattleSetup }
  | { kind: 'event'; pending: PendingEvent; def: ReturnType<typeof eventDef> }
  | { kind: 'done' }
  | { kind: 'gameover' };

/** 이번 턴에 벌어진 전투 요약 (결산에 싣기 위해 임시로 모은다) */
const battleLedger = new WeakMap<GameState, BattleSummary[]>();

function ledger(state: GameState): BattleSummary[] {
  let l = battleLedger.get(state);
  if (!l) {
    l = [];
    battleLedger.set(state, l);
  }
  return l;
}

function rngOf(state: GameState): RngCursor {
  return new RngCursor(state.rng);
}
function commit(state: GameState, rng: RngCursor): void {
  state.rng = rng.seed;
}

/**
 * 턴 처리를 진행하거나 재개한다.
 * UI 상호작용이 필요한 지점에서 멈추고 무엇이 필요한지 알려준다.
 */
export function resolveTurn(state: GameState): TurnStep {
  if (state.result) {
    state.phase = 'gameover';
    return { kind: 'gameover' };
  }

  // ②③ — 아직 명령 단계였다면 AI 를 돌리고 이동을 해석한다.
  if (state.phase === 'command') {
    const rng = rngOf(state);
    ledger(state).length = 0;

    for (const f of Object.values(state.factions)) {
      if (!f.alive || !f.isAI) continue;
      runFactionAI(state, f.id, rng);
    }
    resolveMovement(state, rng);
    resolveSieges(state, rng);
    commit(state, rng);
    state.phase = 'battles';
  }

  // ④ — 전투
  if (state.phase === 'battles') {
    while (state.pendingBattles.length > 0) {
      const pending = state.pendingBattles[0];
      if (!isBattleStillValid(state, pending)) {
        state.pendingBattles.shift();
        continue;
      }
      if (pending.manual) {
        return { kind: 'battle', pending, setup: buildBattleSetup(state, pending) };
      }
      const rng = rngOf(state);
      const result = resolveAutoBattle(state, pending);
      ledger(state).push(applyBattleResult(state, pending, result, rng));
      commit(state, rng);
      state.pendingBattles.shift();
    }
    // 전투가 끝나면 이벤트 트리거를 검사한다.
    const rng = rngOf(state);
    checkEvents(state, rng);
    commit(state, rng);
    state.phase = 'events';
  }

  // ⑤ — 이벤트
  if (state.phase === 'events') {
    while (state.pendingEvents.length > 0) {
      const pending = state.pendingEvents[0];
      if (!state.factions[pending.faction]?.alive) {
        state.pendingEvents.shift();
        continue;
      }
      if (pending.faction === state.playerFaction) {
        return { kind: 'event', pending, def: eventDef(pending.eventId) };
      }
      const rng = rngOf(state);
      resolveEventChoice(state, pending, pickAIChoice(state, pending, rng), rng);
      commit(state, rng);
      state.pendingEvents.shift();
    }
    // ⑥⑦
    settle(state);
    state.phase = state.result ? 'gameover' : 'report';
  }

  return state.result ? { kind: 'gameover' } : { kind: 'done' };
}

function isBattleStillValid(state: GameState, p: PendingBattle): boolean {
  const attackerAlive = p.attackerArmies.some((id) => state.armies[id]);
  if (!attackerAlive) return false;
  const castle = state.castles[p.castle];
  if (p.siege && castle.owner !== p.defender) return false;
  const defenderPresent =
    p.defenderArmies.some((id) => state.armies[id]) || (p.siege && castle.owner === p.defender);
  if (!defenderPresent) {
    // 수비가 사라졌으면 싸움 없이 성이 넘어간다.
    if (p.siege) {
      const rng = rngOf(state);
      captureCastle(state, p.castle, p.attacker, rng);
      commit(state, rng);
      addLog(state, null, 'battle', `${castleName(p.castle)}이(가) 싸움 없이 넘어갔다.`);
    }
    return false;
  }
  return true;
}

/** 수동 전투가 끝났을 때 UI 가 호출한다. */
export function completeBattle(state: GameState, result: BattleResult): void {
  const pending = state.pendingBattles[0];
  if (!pending) return;
  const rng = rngOf(state);
  ledger(state).push(applyBattleResult(state, pending, result, rng));
  commit(state, rng);
  state.pendingBattles.shift();
}

/** 플레이어가 이벤트 선택지를 골랐을 때 UI 가 호출한다. */
export function completeEvent(state: GameState, choiceIndex: number): void {
  const pending = state.pendingEvents[0];
  if (!pending) return;
  const rng = rngOf(state);
  resolveEventChoice(state, pending, choiceIndex, rng);
  commit(state, rng);
  state.pendingEvents.shift();
}

/** 결산 화면을 닫고 다음 턴으로 넘어간다. */
export function beginNextTurn(state: GameState): void {
  if (state.result) {
    state.phase = 'gameover';
    return;
  }
  state.phase = 'command';
  for (const o of Object.values(state.officers)) o.acted = false;
}

/* ================================================================== *
 * ⑥ 결산
 * ================================================================== */

function settle(state: GameState): void {
  const rng = rngOf(state);
  state.reports = [];

  for (const f of Object.values(state.factions)) {
    if (!f.alive) continue;
    state.reports.push(settleFaction(state, f.id, rng));
  }

  driftRelations(state);
  tickTruces(state);
  advanceCalendar(state, rng);
  checkVictory(state);
  commit(state, rng);
}

function settleFaction(state: GameState, faction: FactionId, rng: RngCursor): TurnReport {
  const f = state.factions[faction];
  const castles = factionCastles(state, faction);
  const armies = factionArmies(state, faction);

  const income = { grain: 0, gold: 0, iron: 0 };
  const traits = factionTraits(state, faction);
  const taxBonus = f.institutions.includes('yullyeong') ? 0.18 : 0;
  const commerceBonus = f.institutions.includes('baksa') ? 0.08 : 0;

  for (const castle of castles) {
    const def = castleDef(castle.id);
    const tradeOfficer = castle.officers.some((id) => hasSkill(officerDef(id), 'trade'));
    const inc = castleIncome(castle, def, state.season, {
      tradeOfficer,
      taxBonus: taxBonus + commerceBonus,
      traits,
    });
    // 포위된 성에서는 세금도 곡식도 거두지 못한다.
    if (castle.besiegedBy) continue;
    income.grain += inc.grain;
    income.gold += inc.gold;
    income.iron += inc.iron;

    // 수확분의 일부는 자동으로 성 창고에 쌓인다.
    const cap = castle.dev.agri * B.stockPerAgri;
    const fill = Math.min(cap - castle.stock, Math.round(inc.grain * B.stockFillRatio));
    if (fill > 0) {
      castle.stock += fill;
      income.grain -= fill;
    }
  }

  const garrison = castles.reduce((s, c) => s + garrisonUpkeep(c.troops, state.season), 0);
  const field = armies.reduce((s, a) => s + fieldUpkeep(armyTroops(a), state.season), 0);
  const upkeep = { grain: garrison + field };

  f.resources.grain += income.grain;
  f.resources.gold += income.gold;
  f.resources.iron += income.iron;
  f.resources.grain -= upkeep.grain;

  const highlights: string[] = [];

  /* --- 조공 --- */
  for (const other of Object.values(state.factions)) {
    if (!other.alive || other.id === faction) continue;
    const rel = getRelation(state, faction, other.id);
    if (rel.status !== 'tribute' || rel.overlord !== other.id) continue;
    const paid = Math.round(income.gold * B.vassalTributeRatio);
    if (paid <= 0) continue;
    f.resources.gold = Math.max(0, f.resources.gold - paid);
    other.resources.gold += paid;
    highlights.push(`${factionName(other.id)}에 조공 ${paid.toLocaleString()}을(를) 바쳤다.`);
  }

  /* --- 병량 부족 --- */
  if (f.resources.grain < 0) {
    const deficit = -f.resources.grain;
    f.resources.grain = 0;
    const totalTroops = castles.reduce((s, c) => s + c.troops, 0);
    const lossRatio = clamp(deficit / Math.max(1, upkeep.grain), 0, 1) * 0.12;
    let lost = 0;
    for (const c of castles) {
      const l = Math.round(c.troops * lossRatio);
      c.troops = Math.max(0, c.troops - l);
      c.composition = defaultComposition(faction, c.troops);
      c.loyalty = clamp(c.loyalty - 5, 0, 100);
      lost += l;
    }
    if (lost > 0) {
      highlights.push(`병량이 모자라 ${lost.toLocaleString()}명이 흩어졌다. (총병력 ${totalTroops.toLocaleString()})`);
      addLog(state, faction, 'system', `창고가 비어 군사 ${lost.toLocaleString()}명을 잃었다.`);
    }
  }

  /* --- 민심·특기 --- */
  for (const castle of castles) {
    let drift = (B.loyaltyDriftToward - castle.loyalty) * B.loyaltyDriftRate;
    for (const oid of castle.officers) {
      const def = officerDef(oid);
      if (hasSkill(def, 'buddhism')) drift += 2;
      if (hasSkill(def, 'culture')) drift += 3;
      if (hasSkill(def, 'autocrat')) drift -= 3;
    }
    if (f.institutions.includes('bulgyo')) drift += 1;
    if (castle.besiegedBy) drift -= 4;
    castle.loyalty = clamp(castle.loyalty + drift, 0, 100);
  }

  /* --- 귀족회의 --- */
  const autocrat = factionOfficers(state, faction).some((o) =>
    hasSkill(officerDef(o.id), 'autocrat')
  );
  const target = autocrat ? 35 : 55;
  f.councilSupport = clamp(
    f.councilSupport + Math.sign(target - f.councilSupport) * B.councilDriftPerTurn,
    0,
    100
  );
  if (f.councilSupport < B.coupThreshold && !autocrat && rng.chance(B.coupChancePerTurn)) {
    const coup = triggerCoup(state, faction, rng);
    if (coup) highlights.push(coup);
  }

  /* --- 인물 충성·이탈 --- */
  for (const o of factionOfficers(state, faction)) {
    const def = officerDef(o.id);
    // 충의형은 흔들리지 않는다. 야심형·용병형은 조정이 흔들릴 때 마음이 떠난다.
    // 단, 실권을 쥔 독재자 본인은 오히려 자리가 굳는다.
    let drift: number;
    if (def.loyalty_type === 'loyal') drift = 1;
    else if (hasSkill(def, 'autocrat')) drift = 1;
    else drift = f.councilSupport >= 40 ? 0.5 : -0.8;
    o.loyalty = clamp(o.loyalty + drift, 0, 100);
    if (o.loyalty < B.defectThreshold && def.loyalty_type !== 'loyal' && rng.chance(0.08)) {
      removeOfficerFromWorld(state, o.id);
      o.faction = null;
      o.status = 'free';
      o.hidden = true;
      highlights.push(`${def.name}이(가) 조정을 등지고 떠났다.`);
      addLog(state, faction, 'system', `${def.name}이(가) 이탈했다.`);
    }
  }

  /* --- 전투 요약 --- */
  const battles = ledger(state).filter(
    (b) => b.attacker === faction || b.defender === faction
  );
  for (const b of battles) {
    highlights.push(
      `${b.castleName}: ${factionName(b.winner)} 승리` + (b.captured ? ' — 성이 넘어갔다' : '')
    );
  }

  return {
    turn: state.turn,
    year: state.year,
    season: state.season,
    faction,
    income,
    upkeep,
    net: {
      grain: income.grain - upkeep.grain,
      gold: income.gold,
      iron: income.iron,
    },
    battles,
    highlights,
  };
}

/** 지지도가 바닥나면 정변이 일어난다 (연개소문 쿠데타 등) */
function triggerCoup(state: GameState, faction: FactionId, rng: RngCursor): string | null {
  const ambitious = factionOfficers(state, faction).filter(
    (o) => officerDef(o.id).loyalty_type === 'ambitious'
  );
  const leader = rng.pick(ambitious);
  const f = state.factions[faction];
  const cap = capitalCastle(state, faction);
  if (!leader || !cap) return null;

  f.councilSupport = clamp(f.councilSupport + 25, 0, 100);
  f.resources.gold = Math.round(f.resources.gold * 0.7);
  cap.loyalty = clamp(cap.loyalty - 15, 0, 100);
  // 정변을 일으킨 자가 실권을 쥔다 — 충성도는 오르지만 명분이 깎인다.
  leader.loyalty = 95;
  f.resources.cause = clamp(f.resources.cause - 15, 0, 100);
  if (!f.flags.includes('coup')) f.flags.push('coup');

  const text = `${officerName(leader.id)}이(가) 정변을 일으켜 조정을 장악했다.`;
  addLog(state, faction, 'event', text);
  addChronicle(state, `${factionName(faction)}: ${text}`);
  return text;
}

/* ================================================================== *
 * ⑦ 달력
 * ================================================================== */

function advanceCalendar(state: GameState, rng: RngCursor): void {
  state.turn += 1;
  const next = state.season + 1;
  if (next > 3) {
    state.season = 0;
    state.year += 1;
    onNewYear(state, rng);
  } else {
    state.season = next as Season;
  }

  // 포위 표시 초기화 — 다음 턴 이동 단계에서 다시 세운다.
  for (const c of Object.values(state.castles)) {
    if (c.besiegedBy) {
      const stillThere = Object.values(state.armies).some(
        (a) => a.location === c.id && a.faction === c.besiegedBy
      );
      if (!stillThere) {
        c.besiegedBy = null;
        c.siegeTurns = 0;
      }
    }
  }

  // 병력이 0 인 부대 정리
  for (const army of Object.values(state.armies)) {
    if (armyTroops(army) <= 0) disbandArmy(state, army, null);
  }
}

/** 해가 바뀌면 인물이 등장하고 죽는다. */
function onNewYear(state: GameState, rng: RngCursor): void {
  const scenario = scenarioDef(state.scenarioId);
  for (const o of Object.values(state.officers)) {
    const def = officerDef(o.id);
    const win = officerWindow(def, scenario);
    if (!win) continue; // 이 시나리오의 명부에 없는 인물

    // 사망
    if (o.status !== 'dead' && state.year > win.retire) {
      const wasActive = o.status === 'active';
      const faction = o.faction;
      removeOfficerFromWorld(state, o.id);
      o.status = 'dead';
      if (wasActive) {
        addLog(state, faction, 'system', `${def.name}이(가) 세상을 떠났다.`);
        addChronicle(state, `${def.name} 졸(卒).`);
      }
      continue;
    }

    // 등장 — 성인이 되는 해에 세상에 나온다.
    if (o.status === 'free' && o.hidden && win.appear === state.year && win.retire >= state.year) {
      if (def.faction && state.factions[def.faction]?.alive) {
        // 시나리오가 정해 둔 자리가 아직 자기 세력 땅이면 거기로, 아니면 도성으로 간다.
        const planned = scenarioDef(state.scenarioId).placement?.[o.id];
        const spot =
          planned && state.castles[planned]?.owner === def.faction
            ? state.castles[planned]
            : capitalCastle(state, def.faction);
        if (spot) {
          o.status = 'active';
          o.faction = def.faction;
          o.hidden = false;
          o.location = spot.id;
          o.loyalty = def.loyalty_type === 'loyal' ? 85 : 70;
          spot.officers.push(o.id);
          addLog(state, def.faction, 'system', `${def.name}이(가) ${spot.id === planned ? castleName(spot.id) + '에서 ' : ''}출사했다.`);
        }
      } else if (def.home && state.castles[def.home]) {
        o.location = def.home;
      }
    }
  }
  void rng;
}
