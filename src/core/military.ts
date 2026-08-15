/**
 * military.ts — 전략맵의 군사 처리.
 *
 * 출진 명령 → 행군 → 조우 판정 → 전술 전투(또는 자동 전투) → 결과 반영 까지,
 * "전략 레이어와 전투 레이어를 잇는 이음매"가 이 파일이다.
 */

import { castleDef, castleName, factionName, officerDef, officerName, unitDef } from './data';
import { B, fieldUpkeep, hasSkill, stackPower } from './formulas';
import { RngCursor } from './rng';
import {
  addChronicle,
  addLog,
  armyTroops,
  atWar,
  defaultComposition,
  factionArmies,
  factionTraits,
  getRelation,
  nextId,
} from './state';
import { removeOfficerFromWorld, transferCastle } from './effects';
import { createBattle, type BattleForceStack, type BattleOfficer, type BattleSetup, type BattleResult, type BattleState } from './battle/battleState';
import { runBattleToEnd } from './battle/battleEngine';
import type {
  Army,
  BattleSummary,
  CastleId,
  FactionId,
  GameState,
  MarchCommand,
  PendingBattle,
  UnitStack,
} from './types';
import { clamp, findPath, sum } from './util';

/* ------------------------------------------------------------------ *
 * 출진
 * ------------------------------------------------------------------ */

export function validateMarch(state: GameState, cmd: MarchCommand): string | null {
  const from = state.castles[cmd.from];
  const to = state.castles[cmd.target];
  if (!from || from.owner !== cmd.faction) return '아군 거점이 아닙니다.';
  if (!to) return '없는 목적지입니다.';
  if (cmd.from === cmd.target) return '같은 거점입니다.';

  const total = sum(cmd.units.map((u) => u.count));
  if (total <= 0) return '출진할 병력이 없습니다.';
  if (total > from.troops) return '주둔 병력보다 많이 낼 수 없습니다.';
  // 성을 완전히 비우면 무주공산이 된다 — 최소 병력을 남긴다.
  if (from.troops - total < 500) return '수비를 위해 최소 500명은 남겨야 합니다.';

  for (const stack of cmd.units) {
    const have = from.composition.find((s) => s.unitType === stack.unitType)?.count ?? 0;
    if (stack.count > have) return `${unitDef(stack.unitType).name}이(가) 모자랍니다.`;
  }

  const commander = state.officers[cmd.commander];
  if (!commander || commander.faction !== cmd.faction || commander.status !== 'active')
    return '지휘관을 정해야 합니다.';
  if (commander.location !== cmd.from) return '지휘관이 그 거점에 없습니다.';
  if (commander.acted) return '지휘관이 이번 계절에 이미 움직였습니다.';

  if (to.owner && to.owner !== cmd.faction && !atWar(state, cmd.faction, to.owner)) {
    return `${factionName(to.owner)}와(과) 전쟁 상태가 아닙니다. 먼저 선전포고가 필요합니다.`;
  }

  const path = findMarchPath(state, cmd.faction, cmd.from, cmd.target);
  if (!path) return '길이 이어지지 않습니다.';

  const f = state.factions[cmd.faction];
  if (f.resources.grain < cmd.grain) return '창고의 곡물이 부족합니다.';
  return null;
}

/**
 * 행군 경로. 중간 거점은 아군·중립·적 어디든 지날 수 있지만
 * 적 거점을 지나면 그 자리에서 전투가 벌어진다(멈춤 판정은 이동 단계에서).
 */
export function findMarchPath(
  state: GameState,
  faction: FactionId,
  from: CastleId,
  to: CastleId
): CastleId[] | null {
  return findPath(
    from,
    to,
    (id) => castleDef(id).neighbors,
    // 적 거점은 통과 노드로 쓰지 않는다 (거기서 멈추게 되므로).
    (id) => {
      const c = state.castles[id];
      return !c.owner || c.owner === faction || !atWar(state, faction, c.owner);
    }
  );
}

export function applyMarch(state: GameState, cmd: MarchCommand): string | null {
  if (validateMarch(state, cmd)) return null;
  const from = state.castles[cmd.from];
  const f = state.factions[cmd.faction];
  const path = findMarchPath(state, cmd.faction, cmd.from, cmd.target)!;

  // 주둔군에서 병력을 뗀다.
  for (const stack of cmd.units) {
    const s = from.composition.find((x) => x.unitType === stack.unitType);
    if (s) s.count -= stack.count;
  }
  from.composition = from.composition.filter((s) => s.count > 0);
  const total = sum(cmd.units.map((u) => u.count));
  from.troops -= total;

  f.resources.grain -= cmd.grain;

  const officers = [cmd.commander, ...cmd.officers.filter((o) => o !== cmd.commander)];
  const id = nextId(state, 'army');
  const army: Army = {
    id,
    faction: cmd.faction,
    commander: cmd.commander,
    officers,
    units: cmd.units.map((u) => ({ ...u })),
    location: cmd.from,
    path,
    target: cmd.target,
    grain: cmd.grain,
    morale: 70,
    training: from.training,
    siegeMode: cmd.siegeMode,
  };
  state.armies[id] = army;

  for (const oid of officers) {
    const o = state.officers[oid];
    if (!o) continue;
    const c = state.castles[o.location ?? ''];
    if (c) c.officers = c.officers.filter((x) => x !== oid);
    o.location = null;
    o.armyId = id;
    o.acted = true;
  }

  return `${officerName(cmd.commander)}이(가) ${castleName(cmd.from)}에서 ${total.toLocaleString()}명을 이끌고 ${castleName(cmd.target)}로 향했다.`;
}

/** 이 부대가 한 턴에 나아갈 수 있는 거점 수 */
export function marchSpeed(state: GameState, army: Army): number {
  const cmd = state.officers[army.commander];
  if (cmd && hasSkill(officerDef(army.commander), 'forced_march')) return 2;
  // 공성병기를 끌면 느리다.
  if (army.units.some((u) => unitDef(u.unitType).siege)) return 1;
  return 1;
}

/* ------------------------------------------------------------------ *
 * 행군 처리 (턴 엔진 ③단계)
 * ------------------------------------------------------------------ */

export function resolveMovement(state: GameState, rng: RngCursor): void {
  for (const army of Object.values(state.armies)) {
    if (armyTroops(army) <= 0) {
      disbandArmy(state, army, null);
      continue;
    }
    let steps = marchSpeed(state, army);
    while (steps > 0 && army.path.length > 0) {
      const next = army.path[0];
      const castle = state.castles[next];
      const hostileCastle = castle.owner && atWar(state, army.faction, castle.owner);
      const hostileArmy = Object.values(state.armies).some(
        (a) => a.id !== army.id && a.location === next && atWar(state, army.faction, a.faction)
      );

      army.path.shift();
      army.location = next;
      steps -= 1;

      if (hostileCastle || hostileArmy) break; // 적을 만나면 멈춘다
      if (!castle.owner) {
        // 무주공산은 그냥 접수한다.
        transferCastle(state, next, army.faction);
        addLog(state, army.faction, 'military', `무주공산이던 ${castleName(next)}에 입성했다.`);
        break;
      }
    }

    // 보급 — 아군 거점에 닿아 있으면 창고에서 병량을 받는다.
    // 보급선이 끊기면 받지 못하고 굶는다(살수대첩의 수군이 그랬다).
    resupply(state, army);

    // 병량 소모
    const upkeep = fieldUpkeep(armyTroops(army), state.season);
    army.grain -= upkeep;
    if (army.grain < 0) {
      const shortfall = -army.grain;
      army.grain = 0;
      // 굶으면 사기가 무너지고 병력이 흩어진다 — 살수 이후 수군(隋軍)의 최후.
      const lossRatio = clamp(shortfall / Math.max(1, upkeep), 0, 1) * 0.15;
      const lost = Math.round(armyTroops(army) * lossRatio);
      reduceArmy(army, lost);
      army.morale = clamp(army.morale - 15, 0, 100);
      addLog(
        state,
        army.faction,
        'military',
        `${officerName(army.commander)}의 군이 병량이 끊겨 ${lost.toLocaleString()}명이 흩어졌다.`
      );
      if (armyTroops(army) <= 0) {
        disbandArmy(state, army, null);
        continue;
      }
    } else {
      army.morale = clamp(army.morale + 2, 0, 100);
    }

    // 목적지에 닿았는데 싸울 상대가 없으면 부대를 풀어 주둔군으로 되돌린다.
    // (이걸 하지 않으면 원정군이 빈 성 앞에 영원히 서서 병량만 축낸다.)
    if (army.path.length === 0) {
      const here = state.castles[army.location];
      const hostileHere =
        (here?.owner && atWar(state, army.faction, here.owner)) ||
        Object.values(state.armies).some(
          (a) => a.id !== army.id && a.location === army.location && atWar(state, army.faction, a.faction)
        );
      if (!hostileHere) {
        if (here?.owner === army.faction) {
          disbandArmy(state, army, army.location);
        } else {
          // 적지도 아군 땅도 아닌 곳에 발이 묶였다면 가까운 아군 성으로 돌아간다.
          const home = nearestFriendlyCastle(state, army.faction, army.location);
          if (!home) disbandArmy(state, army, null);
          else if (home === army.location) disbandArmy(state, army, home);
          else {
            const back = findMarchPath(state, army.faction, army.location, home);
            army.path = back ?? [];
            army.target = home;
            if (army.path.length === 0) disbandArmy(state, army, null);
          }
        }
      }
    }
  }

  detectBattles(state, rng);
}

/** 보급선이 이어져 있으면 세력 창고에서 병량을 끌어온다. */
function resupply(state: GameState, army: Army): void {
  const f = state.factions[army.faction];
  const need = fieldUpkeep(armyTroops(army), state.season) * B.aiReserveGrainTurns;
  if (army.grain >= need) return;

  const here = state.castles[army.location];
  const connected =
    here?.owner === army.faction ||
    castleDef(army.location).neighbors.some((n) => state.castles[n]?.owner === army.faction);
  if (!connected) return;

  const take = Math.min(need - army.grain, f.resources.grain);
  if (take <= 0) return;
  f.resources.grain -= take;
  army.grain += take;
}

/** 같은 노드에 적대 세력이 모였는지 검사해 전투 대기열을 만든다. */
function detectBattles(state: GameState, _rng: RngCursor): void {
  const byNode = new Map<CastleId, Army[]>();
  for (const army of Object.values(state.armies)) {
    const list = byNode.get(army.location) ?? [];
    list.push(army);
    byNode.set(army.location, list);
  }

  for (const [castleId, armies] of byNode) {
    const castle = state.castles[castleId];
    if (!castle) continue;

    // 1) 야전 — 같은 노드의 적대 부대끼리
    const factionsHere = Array.from(new Set(armies.map((a) => a.faction)));
    for (let i = 0; i < factionsHere.length; i++) {
      for (let j = i + 1; j < factionsHere.length; j++) {
        const a = factionsHere[i];
        const b = factionsHere[j];
        if (!atWar(state, a, b)) continue;
        // 성 주인이 낀 쪽을 수비로 본다.
        const attacker = castle.owner === a ? b : a;
        const defender = attacker === a ? b : a;
        state.pendingBattles.push({
          id: nextId(state, 'btl'),
          castle: castleId,
          attacker,
          defender,
          attackerArmies: armies.filter((x) => x.faction === attacker).map((x) => x.id),
          defenderArmies: armies.filter((x) => x.faction === defender).map((x) => x.id),
          siege: false,
          manual: shouldBeManual(state, attacker, defender),
        });
      }
    }

    // 2) 공성 — 성 주인과 전쟁 중인 부대가 성 앞에 도달
    if (!castle.owner) continue;
    const besiegers = armies.filter((a) => atWar(state, a.faction, castle.owner));
    if (besiegers.length === 0) {
      castle.besiegedBy = null;
      castle.siegeTurns = 0;
      continue;
    }
    const attacker = besiegers[0].faction;
    const assault = besiegers.some((a) => a.siegeMode === 'assault');
    castle.besiegedBy = attacker;
    castle.siegeTurns = (castle.siegeTurns ?? 0) + 1;

    if (assault) {
      state.pendingBattles.push({
        id: nextId(state, 'btl'),
        castle: castleId,
        attacker,
        defender: castle.owner,
        attackerArmies: besiegers.filter((a) => a.faction === attacker).map((a) => a.id),
        defenderArmies: armies.filter((a) => a.faction === castle.owner).map((a) => a.id),
        siege: true,
        manual: shouldBeManual(state, attacker, castle.owner),
      });
    }
  }
}

function shouldBeManual(state: GameState, a: FactionId, b: FactionId): boolean {
  if (state.options.autoBattle) return false;
  return a === state.playerFaction || b === state.playerFaction;
}

/* ------------------------------------------------------------------ *
 * 포위전 (강공하지 않고 병량을 말린다)
 * ------------------------------------------------------------------ */

export function resolveSieges(state: GameState, rng: RngCursor): void {
  for (const castle of Object.values(state.castles)) {
    if (!castle.besiegedBy || !castle.owner) continue;

    // 포위군이 수비군보다 한참 약하면 성문이 열리고 기습이 나온다.
    // (약한 병력으로 큰 성을 무한정 둘러싸고 있을 수는 없다.)
    const defense = castleDefensePower(state, castle.id);
    const besiegers = Object.values(state.armies).filter(
      (a) => a.location === castle.id && a.faction === castle.besiegedBy
    );
    const besiegePower = besiegers.reduce((s, a) => s + armyPower(state, a), 0);
    if (besiegePower > 0 && besiegePower < defense * 0.45) {
      for (const army of besiegers) {
        const lost = Math.round(armyTroops(army) * rng.float(0.06, 0.14));
        reduceArmy(army, lost);
        army.morale = clamp(army.morale - 10, 0, 100);
        addLog(
          state,
          army.faction,
          'military',
          `${castleName(castle.id)}의 수비군이 성문을 열고 기습해 ${officerName(army.commander)}의 군이 ${lost.toLocaleString()}명을 잃었다.`
        );
        if (armyTroops(army) <= 0) disbandArmy(state, army, null);
        else if (army.morale < 25) retreatArmy(state, army);
      }
      continue;
    }

    // 포위 중이면 성 밖 수확을 못 하므로 비축분만 먹는다.
    const need = Math.round(castle.troops * B.grainPerTroop * B.siegeStockDrain);
    castle.stock -= need;
    if (castle.stock >= 0) continue;

    castle.stock = 0;
    const lost = Math.round(castle.troops * B.starvationTroopLoss);
    castle.troops = Math.max(0, castle.troops - lost);
    castle.composition = defaultComposition(castle.owner, castle.troops);
    castle.loyalty = clamp(castle.loyalty - B.starvationMoraleLoss * 0.5, 0, 100);
    addLog(
      state,
      castle.owner,
      'military',
      `${castleName(castle.id)}이(가) 포위 속에 굶주려 ${lost.toLocaleString()}명을 잃었다.`
    );

    // 굶주림이 길어지면 성문이 열린다.
    if (castle.troops <= 0 || ((castle.siegeTurns ?? 0) >= 4 && rng.chance(0.35))) {
      const besieger = castle.besiegedBy;
      addChronicle(
        state,
        `${castleName(castle.id)}, 병량이 다해 ${factionName(besieger)}에게 항복하다.`
      );
      captureCastle(state, castle.id, besieger, rng);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 전투 준비·결과 반영
 * ------------------------------------------------------------------ */

function toBattleOfficer(state: GameState, id: string): BattleOfficer {
  const def = officerDef(id);
  const growth = state.officers[id]?.growth ?? {};
  return {
    id,
    name: def.name,
    stats: {
      lead: clamp(def.stats.lead + (growth.lead ?? 0), 1, 100),
      war: clamp(def.stats.war + (growth.war ?? 0), 1, 100),
      int: clamp(def.stats.int + (growth.int ?? 0), 1, 100),
      pol: clamp(def.stats.pol + (growth.pol ?? 0), 1, 100),
      chr: clamp(def.stats.chr + (growth.chr ?? 0), 1, 100),
    },
    skills: def.skills,
  };
}

/** 전투 대기열 항목을 전술 전투 설정으로 바꾼다. */
export function buildBattleSetup(state: GameState, pending: PendingBattle): BattleSetup {
  const castle = state.castles[pending.castle];
  const def = castleDef(pending.castle);

  const attackerStacks: BattleForceStack[] = [];
  let attackerMoraleSum = 0;
  let attackerTroops = 0;
  let attackerTraining = 60;
  for (const aid of pending.attackerArmies) {
    const army = state.armies[aid];
    if (!army) continue;
    const troops = armyTroops(army);
    attackerTroops += troops;
    attackerMoraleSum += army.morale * troops;
    attackerTraining = army.training;
    army.units.forEach((u, idx) => {
      attackerStacks.push({
        unitType: u.unitType,
        count: u.count,
        officer: idx === 0 ? toBattleOfficer(state, army.commander) : null,
      });
    });
    // 부장들을 남은 스택에 배분한다.
    const extras = army.officers.filter((o) => o !== army.commander);
    let ei = 0;
    for (const s of attackerStacks) {
      if (s.officer || ei >= extras.length) continue;
      s.officer = toBattleOfficer(state, extras[ei++]);
    }
  }

  const defenderStacks: BattleForceStack[] = [];
  let defenderTroops = 0;
  let defenderMoraleSum = 0;
  for (const did of pending.defenderArmies) {
    const army = state.armies[did];
    if (!army) continue;
    const troops = armyTroops(army);
    defenderTroops += troops;
    defenderMoraleSum += army.morale * troops;
    army.units.forEach((u, idx) => {
      defenderStacks.push({
        unitType: u.unitType,
        count: u.count,
        officer: idx === 0 ? toBattleOfficer(state, army.commander) : null,
      });
    });
  }
  if (pending.siege && castle.owner === pending.defender) {
    const garrisonOfficers = castle.officers.slice();
    castle.composition.forEach((u, idx) => {
      defenderStacks.push({
        unitType: u.unitType,
        count: u.count,
        officer: garrisonOfficers[idx] ? toBattleOfficer(state, garrisonOfficers[idx]) : null,
      });
    });
    defenderTroops += castle.troops;
    // 농성 사기는 민심과 성벽에 기댄다.
    defenderMoraleSum += (50 + castle.loyalty * 0.4) * castle.troops;
  }

  return {
    castle: pending.castle,
    castleName: def.name,
    siege: pending.siege,
    season: state.season,
    terrain: def.terrain,
    mountainFortress: pending.siege && def.special === 'siege_defense_bonus',
    wallDev: castle.dev.wall,
    attackerFaction: pending.attacker,
    defenderFaction: pending.defender,
    attacker: attackerStacks,
    defender: defenderStacks,
    attackerMorale: attackerTroops > 0 ? Math.round(attackerMoraleSum / attackerTroops) : 60,
    defenderMorale: defenderTroops > 0 ? Math.round(defenderMoraleSum / defenderTroops) : 60,
    attackerTraining,
    defenderTraining: castle.training,
    playerSide:
      pending.attacker === state.playerFaction
        ? 'attacker'
        : pending.defender === state.playerFaction
          ? 'defender'
          : null,
    seed: state.rng ^ pending.castle.length,
  };
}

/** 자동 전투 — 전술 화면 없이 AI 끼리 끝까지 돌린다. */
export function resolveAutoBattle(state: GameState, pending: PendingBattle): BattleResult {
  const setup = buildBattleSetup(state, pending);
  setup.playerSide = null;
  const battle: BattleState = createBattle(setup);
  return runBattleToEnd(battle);
}

/** 전투 결과를 전략 상태에 반영한다. */
export function applyBattleResult(
  state: GameState,
  pending: PendingBattle,
  result: BattleResult,
  rng: RngCursor
): BattleSummary {
  const castle = state.castles[pending.castle];
  const attackerWon = result.winner === 'attacker';

  // --- 생존 병력을 진영별로 모은다 ---
  const survivorsBySide: Record<'attacker' | 'defender', UnitStack[]> = {
    attacker: [],
    defender: [],
  };
  let moraleBySide: Record<'attacker' | 'defender', number[]> = { attacker: [], defender: [] };
  for (const s of result.survivors) {
    const list = survivorsBySide[s.side];
    const hit = list.find((x) => x.unitType === s.unitType);
    if (hit) hit.count += s.count;
    else list.push({ unitType: s.unitType, count: s.count });
    moraleBySide[s.side].push(s.morale);
  }
  const avgMorale = (side: 'attacker' | 'defender'): number => {
    const arr = moraleBySide[side];
    return arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 40;
  };

  // --- 공격 측 부대 갱신 ---
  redistribute(state, pending.attackerArmies, survivorsBySide.attacker, avgMorale('attacker'));
  // --- 수비 측 부대 갱신 ---
  redistribute(state, pending.defenderArmies, survivorsBySide.defender, avgMorale('defender'));

  // 공성이면 수비 잔존 병력은 성 주둔군으로 되돌린다.
  if (pending.siege && castle.owner === pending.defender) {
    const fieldDefenders = pending.defenderArmies
      .map((id) => state.armies[id])
      .filter(Boolean)
      .flatMap((a) => a.units);
    const garrison = survivorsBySide.defender.filter(
      (s) => !fieldDefenders.some((f) => f.unitType === s.unitType && f.count === s.count)
    );
    castle.troops = sum(garrison.map((g) => g.count));
    castle.composition = garrison.filter((g) => g.count > 0);
    if (castle.troops === 0 && castle.composition.length === 0 && !attackerWon) {
      // 수비가 이겼는데 주둔군이 0이면 최소한의 잔병은 남긴다.
      castle.troops = Math.max(0, Math.round(result.defenderLoss * 0.02));
      castle.composition = defaultComposition(pending.defender, castle.troops);
    }
  }

  // --- 인물 처리 ---
  for (const oid of result.deadOfficers) {
    const o = state.officers[oid];
    if (!o || o.status === 'dead') continue;
    removeOfficerFromWorld(state, oid);
    o.status = 'dead';
    addChronicle(state, `${officerName(oid)}, ${castleName(pending.castle)}에서 전사하다.`);
  }
  const captor = attackerWon ? pending.attacker : pending.defender;
  const captured: string[] = [];
  for (const oid of result.capturedOfficers) {
    const o = state.officers[oid];
    if (!o || o.status === 'dead' || o.status === 'captured') continue;
    removeOfficerFromWorld(state, oid);
    o.status = 'captured';
    o.captor = captor;
    o.faction = null;
    captured.push(oid);
  }

  // --- 성의 향방 ---
  let capturedCastle = false;
  if (pending.siege && attackerWon) {
    captureCastle(state, pending.castle, pending.attacker, rng);
    capturedCastle = true;
  } else if (!attackerWon) {
    // 패한 공격군은 물러난다.
    for (const id of pending.attackerArmies) {
      const army = state.armies[id];
      if (!army) continue;
      if (armyTroops(army) <= 0) disbandArmy(state, army, null);
      else retreatArmy(state, army);
    }
  }

  // 야전에서 진 수비군도 물러난다.
  if (!pending.siege) {
    const losers = attackerWon ? pending.defenderArmies : pending.attackerArmies;
    for (const id of losers) {
      const army = state.armies[id];
      if (!army) continue;
      if (armyTroops(army) <= 0) disbandArmy(state, army, null);
      else retreatArmy(state, army);
    }
  }

  const summary: BattleSummary = {
    castle: pending.castle,
    castleName: castleName(pending.castle),
    attacker: pending.attacker,
    defender: pending.defender,
    winner: attackerWon ? pending.attacker : pending.defender,
    attackerLoss: result.attackerLoss,
    defenderLoss: result.defenderLoss,
    captured: capturedCastle,
    siege: pending.siege,
    capturedOfficers: captured,
  };

  addLog(
    state,
    null,
    'battle',
    `${castleName(pending.castle)} — ${factionName(pending.attacker)} vs ${factionName(pending.defender)}: ` +
      `${factionName(summary.winner)} 승리 (피해 ${result.attackerLoss.toLocaleString()} : ${result.defenderLoss.toLocaleString()})` +
      (capturedCastle ? `, ${castleName(pending.castle)} 함락` : '')
  );
  if (capturedCastle) {
    addChronicle(
      state,
      `${factionName(pending.attacker)}, ${castleName(pending.castle)}를 함락하다.`
    );
  }
  return summary;
}

/** 전투 생존 병력을 부대들에 되돌린다. */
function redistribute(
  state: GameState,
  armyIds: string[],
  survivors: UnitStack[],
  morale: number
): void {
  const armies = armyIds.map((id) => state.armies[id]).filter(Boolean);
  if (armies.length === 0) return;
  const pool = survivors.map((s) => ({ ...s }));

  for (const army of armies) {
    const newUnits: UnitStack[] = [];
    for (const u of army.units) {
      const avail = pool.find((p) => p.unitType === u.unitType);
      if (!avail) continue;
      const take = Math.min(u.count, avail.count);
      avail.count -= take;
      if (take > 0) newUnits.push({ unitType: u.unitType, count: take });
    }
    army.units = newUnits;
    army.morale = morale;
  }
  for (const army of [...armies]) {
    if (armyTroops(army) <= 0) disbandArmy(state, army, null);
  }
}

/** 부대를 해산한다. castleId 가 있으면 그 성의 주둔군에 합류시킨다. */
export function disbandArmy(state: GameState, army: Army, castleId: CastleId | null): void {
  const castle = castleId ? state.castles[castleId] : null;
  if (castle && castle.owner === army.faction) {
    for (const u of army.units) {
      const s = castle.composition.find((x) => x.unitType === u.unitType);
      if (s) s.count += u.count;
      else castle.composition.push({ ...u });
    }
    castle.troops += armyTroops(army);
    castle.stock += army.grain;
  } else if (castle === null && army.grain > 0) {
    state.factions[army.faction].resources.grain += Math.round(army.grain * 0.5);
  }

  for (const oid of army.officers) {
    const o = state.officers[oid];
    if (!o) continue;
    o.armyId = null;
    if (o.status !== 'active') continue;
    if (castle && castle.owner === army.faction) {
      o.location = castleId;
      castle.officers.push(oid);
    } else {
      // 갈 곳이 없으면 가장 가까운 아군 거점으로 돌아간다.
      const home = nearestFriendlyCastle(state, army.faction, army.location);
      o.location = home;
      if (home) state.castles[home].officers.push(oid);
      else {
        o.status = 'free';
        o.faction = null;
        o.hidden = true;
      }
    }
  }
  delete state.armies[army.id];
}

/** 패주 — 가장 가까운 아군 거점으로 물러난다. */
export function retreatArmy(state: GameState, army: Army): void {
  const home = nearestFriendlyCastle(state, army.faction, army.location);
  if (!home) {
    disbandArmy(state, army, null);
    return;
  }
  army.location = home;
  army.path = [];
  army.target = home;
  army.morale = clamp(army.morale - 15, 0, 100);
  disbandArmy(state, army, home);
}

export function nearestFriendlyCastle(
  state: GameState,
  faction: FactionId,
  from: CastleId
): CastleId | null {
  if (state.castles[from]?.owner === faction) return from;
  const seen = new Set([from]);
  const queue: CastleId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of castleDef(cur).neighbors) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      if (state.castles[nb]?.owner === faction) return nb;
      queue.push(nb);
    }
  }
  return null;
}

/** 성 함락 처리 — 점령군이 그대로 주둔군이 된다. */
export function captureCastle(
  state: GameState,
  castleId: CastleId,
  to: FactionId,
  rng: RngCursor
): void {
  const { captured } = transferCastle(state, castleId, to);
  const castle = state.castles[castleId];
  castle.loyalty = B.conqueredLoyalty;

  // 포로 처리
  for (const oid of captured) {
    const o = state.officers[oid];
    if (!o) continue;
    o.status = 'captured';
    o.captor = to;
    // 충의형은 도망치거나 죽는 쪽을 택하기도 한다.
    if (officerDef(oid).loyalty_type === 'loyal' && rng.chance(0.25)) {
      o.status = 'dead';
      o.captor = null;
      addChronicle(state, `${officerName(oid)}, 항복을 거부하고 죽다.`);
    }
  }

  // 성 앞의 아군 부대를 입성시킨다.
  for (const army of factionArmies(state, to)) {
    if (army.location !== castleId) continue;
    if (army.target === castleId || army.path.length === 0) {
      disbandArmy(state, army, castleId);
    }
  }
  if (castle.troops === 0) {
    // 아무도 들어가지 않았다면 최소 수비대를 남긴다.
    castle.troops = 1000;
    castle.composition = defaultComposition(to, 1000);
  }
  castle.besiegedBy = null;
  castle.siegeTurns = 0;
}

function reduceArmy(army: Army, lost: number): void {
  let remaining = lost;
  for (const u of army.units) {
    const take = Math.min(u.count, Math.ceil(remaining * (u.count / Math.max(1, armyTroops(army)))));
    u.count -= take;
    remaining -= take;
  }
  army.units = army.units.filter((u) => u.count > 0);
}

/* ------------------------------------------------------------------ *
 * AI·UI 공용 전력 평가
 * ------------------------------------------------------------------ */

export function armyPower(state: GameState, army: Army): number {
  const cmd = toBattleOfficer(state, army.commander);
  return army.units.reduce(
    (s, u) => s + stackPower(u.count, unitDef(u.unitType), army.morale, army.training, cmd),
    0
  );
}

/**
 * 아직 편성되지 않은 병력 묶음의 전투력.
 * AI 가 "이 병력으로 저 성을 칠 수 있는가"를 castleDefensePower 와 같은 척도로 재기 위한 함수.
 */
export function compositionPower(
  state: GameState,
  units: UnitStack[],
  morale: number,
  training: number,
  commander?: string
): number {
  const cmd = commander ? toBattleOfficer(state, commander) : undefined;
  return units.reduce(
    (s, u) => s + stackPower(u.count, unitDef(u.unitType), morale, training, cmd),
    0
  );
}

export function castleDefensePower(state: GameState, castleId: CastleId): number {
  const castle = state.castles[castleId];
  const def = castleDef(castleId);
  if (!castle.owner) return 0;
  const best = castle.officers[0] ? toBattleOfficer(state, castle.officers[0]) : undefined;
  const base = castle.composition.reduce(
    (s, u) => s + stackPower(u.count, unitDef(u.unitType), 50 + castle.loyalty * 0.4, castle.training, best),
    0
  );
  let wallBonus = 1 + castle.dev.wall / 120;
  const terrainBonus = def.special === 'siege_defense_bonus' ? B.mountainFortressBonus : 1;
  const traits = factionTraits(state, castle.owner);
  // 도성 방어(신라) — 금성은 좀처럼 떨어지지 않는다.
  const capitalBonus = def.type === 'capital' && traits.includes('capital_defense') ? 1.25 : 1;
  // 변경 방어(고구려) — 산성 등급 거점의 성벽이 더 두껍다.
  if (def.type === 'fort' && traits.includes('frontier_defense')) wallBonus *= 1.1;
  return base * wallBonus * terrainBonus * capitalBonus;
}

/** 정전 턴 감소 등 매 턴 외교 시계 갱신 */
export function tickTruces(state: GameState): void {
  for (const key of Object.keys(state.relations)) {
    const [a, b] = key.split('|');
    const rel = getRelation(state, a, b);
    if (rel.truceTurns > 0) rel.truceTurns -= 1;
  }
}
