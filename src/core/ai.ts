/**
 * ai.ts — 규칙 기반 AI (시스템 상세계획 §3.4)
 *
 * 3단계 우선순위 휴리스틱:
 *   1순위 생존 — 침공받는 중이면 방어·원군
 *   2순위 성장 — 최저 개발 거점에 투자, 병력 열세면 징병
 *   3순위 확장 — 인접 거점 중 (방어력/거리/외교관계) 점수가 가장 낮은 곳을 친다
 *
 * 세력 성향(공격성·확장욕·외교선호)은 factions.json 의 personality 로 조절한다.
 */

import { INSTITUTIONS, availableUnits, castleDef, officerDef } from './data';
import { applyDomesticCommand, validateCommand } from './domestic';
import { applyDiplomacy, validateDiplomacy } from './diplomacy';
import { B, conscriptCost, maxTroops } from './formulas';
import { applyMarch, castleDefensePower, compositionPower, validateMarch } from './military';
import type { RngCursor } from './rng';
import {
  addLog,
  atWar,
  availableOfficersAt,
  factionArmies,
  factionCastles,
  factionOfficers,
  factionTraits,
  getRelation,
  isAllied,
} from './state';
import type {
  CastleId,
  CastleState,
  Command,
  DevKey,
  FactionId,
  GameState,
  OfficerState,
  UnitStack,
} from './types';
import { TROOPS } from './types';
import { TIER_CAP } from './field/balance';
import { sum } from './util';

const DEV_ORDER: DevKey[] = ['agri', 'commerce', 'barracks', 'wall'];

/**
 * 이 거점이 지금 위협받고 있는가.
 *
 * "국경을 맞대고 있다"는 것만으로 위협으로 치면 전선의 모든 성이 늘 위협 상태가 되어
 * AI 가 영원히 수비만 하다 판이 굳는다. 실제로 적 병력이 다가와 있을 때만 위협으로 본다.
 */
export function isThreatened(state: GameState, castle: CastleState): boolean {
  if (!castle.owner) return false;
  if (castle.besiegedBy) return true;
  const near = [castle.id, ...castleDef(castle.id).neighbors];
  return Object.values(state.armies).some(
    (a) => near.includes(a.location) && atWar(state, castle.owner, a.faction)
  );
}

/** 국경을 맞대고 있는 적 거점이 우리보다 훨씬 강한가 (수비 투자 판단용) */
function isOutmatched(state: GameState, castle: CastleState): boolean {
  return castleDef(castle.id).neighbors.some((nb) => {
    const n = state.castles[nb];
    return !!n?.owner && atWar(state, castle.owner, n.owner) && n.troops > castle.troops * 1.4;
  });
}

/** 이 세력의 한 턴을 통째로 실행한다. */
export function runFactionAI(state: GameState, faction: FactionId, rng: RngCursor): void {
  const f = state.factions[faction];
  if (!f?.alive) return;
  const castles = factionCastles(state, faction);
  if (castles.length === 0) return;

  aiDiplomacy(state, faction, rng);

  // 출진을 내정보다 먼저 정한다.
  // (내정이 먼저 돌면 모든 장수가 명령을 써 버려 군을 이끌 사람이 남지 않는다.)
  aiOffensive(state, faction, f.personality, rng);

  // 위협받는 거점부터 손을 쓴다.
  const ordered = castles
    .slice()
    .sort((a, b) => Number(isThreatened(state, b)) - Number(isThreatened(state, a)));

  for (const castle of ordered) {
    aiCastleOrders(state, faction, castle, rng);
  }

  aiInstitutions(state, faction, rng);
  aiArmament(state, faction, rng);
}

/* ------------------------------------------------------------------ *
 * 1·2순위 — 거점별 내정·징병
 * ------------------------------------------------------------------ */

function aiCastleOrders(
  state: GameState,
  faction: FactionId,
  castle: CastleState,
  rng: RngCursor
): void {
  const threatened = isThreatened(state, castle) || isOutmatched(state, castle);
  const f = state.factions[faction];

  for (const officer of availableOfficersAt(state, castle.id)) {
    const cmd = pickCastleCommand(state, faction, castle, officer, threatened, rng);
    if (!cmd) continue;
    if (validateCommand(state, cmd)) continue;
    const text = applyDomesticCommand(state, cmd, rng);
    if (text) addLog(state, faction, 'domestic', text);
  }

  // 위협받는 성은 병량을 채워 농성에 대비한다.
  if (threatened && f.resources.grain > 4000 && castle.stock < castle.dev.agri * B.stockPerAgri * 0.6) {
    const spare = availableOfficersAt(state, castle.id)[0];
    if (spare) {
      const cmd: Command = {
        kind: 'stockpile',
        faction,
        officer: spare.id,
        castle: castle.id,
        grain: Math.min(3000, Math.round(f.resources.grain * 0.25)),
      };
      if (!validateCommand(state, cmd)) {
        const text = applyDomesticCommand(state, cmd, rng);
        if (text) addLog(state, faction, 'domestic', text);
      }
    }
  }
}

function pickCastleCommand(
  state: GameState,
  faction: FactionId,
  castle: CastleState,
  officer: OfficerState,
  threatened: boolean,
  rng: RngCursor
): Command | null {
  const f = state.factions[faction];
  const def = castleDef(castle.id);
  const stats = officerDef(officer.id).stats;

  // --- 1순위: 위협받는 거점의 방어 준비 ---
  if (threatened) {
    const room = maxTroops(castle) - castle.troops;
    if (room > 1500 && f.resources.gold > 1200 && canFeedMore(state, faction)) {
      const unit = pickUnit(state, faction, 'defense');
      const amount = affordableAmount(state, faction, unit, Math.min(room, 5000));
      if (amount >= 1000) {
        return { kind: 'conscript', faction, officer: officer.id, castle: castle.id, amount, unitType: unit };
      }
    }
    if (castle.training < 75 && f.resources.gold > B.trainCost * 3) {
      return { kind: 'train', faction, officer: officer.id, castle: castle.id };
    }
    if (castle.dev.wall < def.maxDev.wall && f.resources.gold > B.developCost * 3) {
      return { kind: 'develop', faction, officer: officer.id, castle: castle.id, target: 'wall' };
    }
  }

  // --- 민심이 나쁘면 순찰이 먼저다 ---
  if (castle.loyalty < 45 && f.resources.gold > B.patrolCost * 2) {
    return { kind: 'patrol', faction, officer: officer.id, castle: castle.id };
  }

  // --- 2순위: 성장 — 정치가 높은 자는 개발, 통솔이 높은 자는 훈련 ---
  const devTarget = lowestDev(castle, def);
  const canDevelop = devTarget && f.resources.gold > B.developCost * 4;

  if (canDevelop && stats.pol >= stats.lead) {
    return { kind: 'develop', faction, officer: officer.id, castle: castle.id, target: devTarget };
  }
  if (castle.training < 70 && f.resources.gold > B.trainCost * 4 && stats.lead >= 60) {
    return { kind: 'train', faction, officer: officer.id, castle: castle.id };
  }
  if (canDevelop) {
    return { kind: 'develop', faction, officer: officer.id, castle: castle.id, target: devTarget };
  }

  // --- 인재 확보 ---
  const hiddenHere = Object.values(state.officers).some(
    (o) => o.status === 'free' && o.location === castle.id
  );
  if (hiddenHere && f.resources.gold > B.searchCost * 3) {
    const revealed = Object.values(state.officers).find(
      (o) => o.status === 'free' && !o.hidden && o.location === castle.id
    );
    if (revealed) {
      return {
        kind: 'recruit',
        faction,
        officer: officer.id,
        castle: castle.id,
        targetOfficer: revealed.id,
      };
    }
    return { kind: 'search', faction, officer: officer.id, castle: castle.id };
  }

  // --- 여력이 있으면 병력을 불린다 (먹일 수 있을 만큼만) ---
  const room = maxTroops(castle) - castle.troops;
  if (room > 2000 && f.resources.gold > 3000 && canFeedMore(state, faction)) {
    const unit = pickUnit(state, faction, 'attack');
    const amount = affordableAmount(state, faction, unit, Math.min(room, 4000));
    if (amount >= 1000) {
      return { kind: 'conscript', faction, officer: officer.id, castle: castle.id, amount, unitType: unit };
    }
  }

  if (castle.loyalty < 80 && f.resources.gold > B.patrolCost * 2 && rng.chance(0.5)) {
    return { kind: 'patrol', faction, officer: officer.id, castle: castle.id };
  }
  return null;
}

/**
 * 병력을 더 늘려도 먹일 수 있는가.
 * 창고에 최소 몇 턴치 병량이 남아 있을 때만 징병한다 —
 * 이 제동이 없으면 AI 가 병영 한계까지 징집한 뒤 매 턴 굶어 죽는다.
 */
function canFeedMore(state: GameState, faction: FactionId): boolean {
  const f = state.factions[faction];
  const troops = factionCastles(state, faction).reduce((s, c) => s + c.troops, 0);
  const perTurn = Math.max(1, troops * B.grainPerTroop);
  return f.resources.grain > perTurn * B.aiReserveGrainTurns;
}

function lowestDev(castle: CastleState, def: ReturnType<typeof castleDef>): DevKey | null {
  let best: DevKey | null = null;
  let bestRatio = Infinity;
  for (const key of DEV_ORDER) {
    if (castle.dev[key] >= def.maxDev[key]) continue;
    const ratio = castle.dev[key] / Math.max(1, def.maxDev[key]);
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = key;
    }
  }
  return best;
}

function pickUnit(state: GameState, faction: FactionId, role: 'attack' | 'defense'): string {
  const f = state.factions[faction];
  const units = availableUnits(faction, f.institutions);
  const affordable = units.filter((u) => {
    const c = conscriptCost(u, 1000, factionTraits(state, faction));
    return f.resources.gold >= c.gold * 2 && f.resources.iron >= c.iron * 2;
  });
  const pool = affordable.length > 0 ? affordable : units;
  const scored = pool
    .filter((u) => !u.siege)
    .map((u) => {
      const raw = role === 'attack' ? u.attack * 1.4 + u.defense : u.defense * 1.4 + u.attack;
      // 전투 대부분은 뭍에서 벌어진다. 물에서만 강한 병종을 과대평가하지 않는다.
      const land =
        ((u.terrain.plain ?? 1) + (u.terrain.hill ?? 1) + (u.terrain.forest ?? 1)) / 3;
      return { u, score: raw * land };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.u.id ?? 'infantry';
}

function affordableAmount(
  state: GameState,
  faction: FactionId,
  unitType: string,
  wanted: number
): number {
  const f = state.factions[faction];
  const unit = availableUnits(faction, f.institutions).find((u) => u.id === unitType);
  if (!unit) return 0;
  // 재화의 절반, 철의 절반까지만 쓴다.
  const byGold = (f.resources.gold * 0.5 * 1000) / Math.max(1, unit.cost.gold);
  const byIron = unit.cost.iron > 0 ? (f.resources.iron * 0.5 * 1000) / unit.cost.iron : Infinity;
  return Math.floor(Math.min(wanted, byGold, byIron, B.conscriptMax) / 500) * 500;
}

/* ------------------------------------------------------------------ *
 * 3순위 — 확장
 * ------------------------------------------------------------------ */

function aiOffensive(
  state: GameState,
  faction: FactionId,
  personality: { aggression: number; expansion: number; diplomacy: number },
  rng: RngCursor
): void {
  const f = state.factions[faction];
  // 영토가 넓을수록 여러 전선을 동시에 굴릴 수 있다.
  const maxArmies = Math.max(2, Math.floor(factionCastles(state, faction).length / 2));
  if (factionArmies(state, faction).length >= maxArmies) return;
  if (rng.next() > personality.aggression) return;

  interface Candidate {
    from: CastleId;
    to: CastleId;
    score: number;
    units: UnitStack[];
    commander: string;
    mode: 'assault' | 'encircle';
  }
  const targets: Candidate[] = [];

  for (const castle of factionCastles(state, faction)) {
    if (castle.besiegedBy) continue;
    if (castle.troops < 4000) continue;
    const commander = pickCommander(state, faction, castle.id);
    if (!commander) continue;

    // 적이 코앞이면 수비 병력을 더 남긴다.
    const reserve = isThreatened(state, castle) || isOutmatched(state, castle) ? 5000 : 1500;
    if (castle.troops <= reserve + 1500) continue;
    const send = Math.round((castle.troops - reserve) * 0.85);
    const units = takeUnits(castle.composition, send);
    const sending = sum(units.map((u) => u.count));
    if (sending < 1500) continue;

    // 방어력과 같은 척도로 공격력을 잰다 — 병력 "수"끼리 비교하면 성벽 보정을 이길 수 없다.
    const attack = compositionPower(state, units, 70, castle.training, commander.id);

    for (const nb of castleDef(castle.id).neighbors) {
      const target = state.castles[nb];
      if (!target) continue;
      if (target.owner === faction) continue;
      if (target.owner && !atWar(state, faction, target.owner)) continue;

      const defense = target.owner ? castleDefensePower(state, nb) : 0;
      const ratio = attack / Math.max(1, defense);

      // 강공이 무리면 포위로 병량을 말린다 (기획서 §6.3 의 공격 측 선택지).
      let mode: 'assault' | 'encircle';
      if (!target.owner || ratio >= B.aiMinAttackRatio) mode = 'assault';
      else if (ratio >= B.aiMinSiegeRatio) mode = 'encircle';
      else continue;

      const def = castleDef(nb);
      // 기울어진 상대를 끝내는 편이 새 전선을 여는 것보다 낫다.
      const weakness = target.owner
        ? 1 + Math.max(0, (5 - factionCastles(state, target.owner).length) / 5) * 1.6
        : 2.2;
      const value =
        (def.type === 'capital' ? 1.5 : 1) *
        (1 + def.maxDev.agri / 200) *
        (def.special === 'iron_mine' ? 1.15 : 1) *
        weakness *
        personality.expansion;
      targets.push({
        from: castle.id,
        to: nb,
        score: ratio * value * (mode === 'assault' ? 1 : 0.7),
        units,
        commander: commander.id,
        mode,
      });
    }
  }
  if (targets.length === 0) return;
  targets.sort((a, b) => b.score - a.score);

  // 여러 전선을 동시에 열 수 있게, 출발지가 겹치지 않는 후보를 차례로 내보낸다.
  const used = new Set<CastleId>();
  for (const chosen of targets) {
    if (factionArmies(state, faction).length >= maxArmies) break;
    if (used.has(chosen.from)) continue;

    const escorts = availableOfficersAt(state, chosen.from)
      .filter((o) => o.id !== chosen.commander)
      .slice(0, 2)
      .map((o) => o.id);

    const sending = sum(chosen.units.map((u) => u.count));
    const grain = Math.min(
      Math.round(f.resources.grain * 0.35),
      marchGrain(sending)
    );

    const cmd: Command = {
      kind: 'march',
      faction,
      from: chosen.from,
      target: chosen.to,
      commander: chosen.commander,
      officers: escorts,
      units: chosen.units,
      grain,
      siegeMode: chosen.mode,
    };
    if (validateMarch(state, cmd)) continue;
    const text = applyMarch(state, cmd);
    if (text) {
      used.add(chosen.from);
      addLog(
        state,
        faction,
        'military',
        text + (chosen.mode === 'encircle' ? ' (강공 대신 포위로 병량을 말린다)' : '')
      );
    }
  }
}

/** 원정에 들려 보낼 병량 (약 5턴치) */
function marchGrain(troops: number): number {
  return Math.round(troops * B.grainPerTroop * B.fieldUpkeepMultiplier * 5);
}

function pickCommander(state: GameState, faction: FactionId, castle: CastleId) {
  const list = availableOfficersAt(state, castle).filter((o) => o.faction === faction);
  if (list.length === 0) return undefined;
  return list.reduce((best, o) =>
    officerDef(o.id).stats.lead > officerDef(best.id).stats.lead ? o : best
  );
}

/** 주둔 편성에서 병력을 비율대로 떼어 낸다. */
function takeUnits(composition: UnitStack[], amount: number): UnitStack[] {
  const total = sum(composition.map((u) => u.count));
  if (total <= 0) return [];
  const ratio = Math.min(1, amount / total);
  return composition
    .map((u) => ({ unitType: u.unitType, count: Math.floor(u.count * ratio) }))
    .filter((u) => u.count > 0);
}

/* ------------------------------------------------------------------ *
 * 외교·제도
 * ------------------------------------------------------------------ */

function aiDiplomacy(state: GameState, faction: FactionId, rng: RngCursor): void {
  const f = state.factions[faction];
  const personality = state.factions[faction].personality;
  const envoy = bestEnvoy(state, faction);
  if (!envoy) return;

  const others = Object.values(state.factions).filter((o) => o.alive && o.id !== faction);
  const myCastles = factionCastles(state, faction).length;


  // 전선이 둘 이상이면 약한 쪽과 화평을 시도한다.
  // 상대를 짓밟아 놓았다면 마지막 성까지 치는 대신 신속을 받아낸다 (기획서 §3 패권 승리).
  for (const o of others) {
    const theirs = factionCastles(state, o.id).length;
    if (theirs === 0 || myCastles < theirs * 2.5) continue;
    const cmd: Command = {
      kind: 'diplomacy',
      faction,
      officer: envoy.id,
      to: o.id,
      action: 'demand_tribute',
    };
    if (validateDiplomacy(state, cmd)) continue;
    const text = applyDiplomacy(state, cmd, rng);
    if (text) addLog(state, faction, 'diplomacy', text);
    return;
  }

  const wars = others.filter((o) => atWar(state, faction, o.id));
  // 이미 기울어진 상대와는 화평하지 않는다. 판을 끝낼 수 있을 때는 끝낸다.
  const worthPeace = wars.filter((o) => factionCastles(state, o.id).length >= myCastles * 0.5);

  // 주의: "한 전선이라도 벅차면 화평을 청한다"는 규칙을 넣어 보았으나,
  // 약한 쪽이 웅크리는 동안 강한 쪽이 무저항으로 커져 오히려 판이 더 기울었다.
  // (642년 백제 22%→14%, 551년 고구려 52%→82%) — 넣지 않는다.
  if (worthPeace.length >= 2 && rng.chance(0.6 + personality.diplomacy * 0.3)) {
    const weakest = worthPeace
      .slice()
      .sort(
        (a, b) =>
          factionCastles(state, a.id).length - factionCastles(state, b.id).length
      )[0];
    const cmd: Command = {
      kind: 'diplomacy',
      faction,
      officer: envoy.id,
      to: weakest.id,
      action: 'peace',
    };
    if (!validateDiplomacy(state, cmd)) {
      const text = applyDiplomacy(state, cmd, rng);
      if (text) addLog(state, faction, 'diplomacy', text);
      return;
    }
  }

  // 최약체는 최강자를 견제하려 동맹을 구한다.
  const strongest = others
    .slice()
    .sort((a, b) => factionCastles(state, b.id).length - factionCastles(state, a.id).length)[0];
  if (
    strongest &&
    factionCastles(state, strongest.id).length > myCastles + 1 &&
    rng.chance(personality.diplomacy * 0.5)
  ) {
    const partner = others.find(
      (o) => o.id !== strongest.id && !isAllied(state, faction, o.id) && !atWar(state, faction, o.id)
    );
    if (partner) {
      const cmd: Command = {
        kind: 'diplomacy',
        faction,
        officer: envoy.id,
        to: partner.id,
        action: 'alliance',
      };
      if (!validateDiplomacy(state, cmd)) {
        const text = applyDiplomacy(state, cmd, rng);
        if (text) addLog(state, faction, 'diplomacy', text);
        return;
      }
    }
  }

  // 명분이 쌓이고 공격성이 높으면 약한 이웃에게 선전포고한다.
  if (f.resources.cause >= B.declareCauseCost + 10 && rng.chance(personality.aggression * 0.35)) {
    const prey = others
      .filter((o) => !atWar(state, faction, o.id) && !isAllied(state, faction, o.id))
      .filter((o) => getRelation(state, faction, o.id).truceTurns === 0)
      .filter((o) => neighborsOf(state, faction).has(o.id))
      .sort((a, b) => factionCastles(state, a.id).length - factionCastles(state, b.id).length)[0];
    if (prey) {
      const cmd: Command = {
        kind: 'diplomacy',
        faction,
        officer: envoy.id,
        to: prey.id,
        action: 'declare',
      };
      if (!validateDiplomacy(state, cmd)) {
        const text = applyDiplomacy(state, cmd, rng);
        if (text) addLog(state, faction, 'diplomacy', text);
        return;
      }
    }
  }

  // 여유가 있으면 조공으로 명분을 산다.
  if (f.resources.gold > B.tributeGoldCost * 4 && f.resources.cause < 40 && rng.chance(0.4)) {
    const cmd: Command = {
      kind: 'diplomacy',
      faction,
      officer: envoy.id,
      to: 'china',
      action: 'tribute',
    };
    if (!validateDiplomacy(state, cmd)) {
      const text = applyDiplomacy(state, cmd, rng);
      if (text) addLog(state, faction, 'diplomacy', text);
    }
  }
}

/** 국경을 맞대고 있는 세력들 */
function neighborsOf(state: GameState, faction: FactionId): Set<FactionId> {
  const out = new Set<FactionId>();
  for (const c of factionCastles(state, faction)) {
    for (const nb of castleDef(c.id).neighbors) {
      const owner = state.castles[nb]?.owner;
      if (owner && owner !== faction) out.add(owner);
    }
  }
  return out;
}

function bestEnvoy(state: GameState, faction: FactionId): OfficerState | undefined {
  const list = factionOfficers(state, faction).filter((o) => !o.acted && !o.armyId);
  if (list.length === 0) return undefined;
  return list.reduce((best, o) => {
    const a = officerDef(o.id).stats;
    const b = officerDef(best.id).stats;
    return a.pol + a.chr > b.pol + b.chr ? o : best;
  });
}

/**
 * 병종 개발 — AI 도 나라를 키운다 (§2.1).
 *
 * 아무 계열이나 올리지 않는다. **제 나라가 잘하는 것부터** 올린다.
 * 그래야 고구려는 기병으로, 백제는 수군과 궁병으로 싸우는 나라가 되어
 * 판마다 상대의 색이 달라진다. TIER_CAP 이 그 성향을 이미 담고 있으므로
 * 상한이 높은 계열을 먼저 고르면 된다.
 */
function aiArmament(state: GameState, faction: FactionId, rng: RngCursor): void {
  const f = state.factions[faction];
  // 병력을 먹여 살릴 돈이 먼저다. 개발은 여유가 있을 때만
  if (f.resources.gold < 2500 || f.resources.iron < 200) return;
  if (!rng.chance(0.4)) return;

  const caps = TIER_CAP[faction];
  const order = [...TROOPS].sort((a, b) => {
    const room = caps[b] - f.troopTiers[b] - (caps[a] - f.troopTiers[a]);
    return room !== 0 ? room : caps[b] - caps[a];
  });
  for (const troop of order) {
    const cmd: Command = { kind: 'armament', faction, troop };
    if (validateCommand(state, cmd)) continue;
    const text = applyDomesticCommand(state, cmd, rng);
    if (text) addLog(state, faction, 'domestic', text);
    return;
  }
}

function aiInstitutions(state: GameState, faction: FactionId, rng: RngCursor): void {
  const f = state.factions[faction];
  if (f.resources.gold < 4000) return;
  if (!rng.chance(0.35)) return;
  for (const def of INSTITUTIONS) {
    if (f.institutions.includes(def.id)) continue;
    const cmd: Command = { kind: 'institution', faction, institution: def.id };
    if (validateCommand(state, cmd)) continue;
    const text = applyDomesticCommand(state, cmd, rng);
    if (text) addLog(state, faction, 'domestic', text);
    return;
  }
}
