/**
 * domestic.ts — 내정 명령의 검증과 적용 (시스템 상세계획 §3.2)
 *
 * 명령 하나 = {담당 인물, 대상 거점, 비용, 계산식}.
 * 계산식은 formulas.ts 에만 있고 여기서는 "누가 무엇을 할 수 있는가"만 다룬다.
 */

import { availableUnits, castleDef, castleName, institutionDef, officerDef, officerName, unitDef } from './data';
import {
  B,
  conscriptCost,
  councilPass,
  developGain,
  hasSkill,
  maxStock,
  maxTroops,
  patrolGain,
  recruitScore,
  searchScore,
  trainGain,
} from './formulas';
import { evaluate } from './dsl';
import { makeContext } from './events';
import { applyEffects } from './effects';
import type { RngCursor } from './rng';
import {
  addLog,
  adjustLoyalty,
  factionHasSkill,
  factionTraits,
  hasInstitution,
} from './state';
import type {
  Command,
  ConscriptCommand,
  DevelopCommand,
  GameState,
  InstitutionCommand,
  OfficerState,
  PatrolCommand,
  RecruitCommand,
  SearchCommand,
  StockpileCommand,
  TrainCommand,
} from './types';
import { clamp } from './util';

const DEV_LABEL: Record<string, string> = {
  agri: '농업',
  commerce: '상업',
  wall: '성곽',
  barracks: '병영',
};

/* ------------------------------------------------------------------ *
 * 검증
 * ------------------------------------------------------------------ */

/** 명령을 낼 수 있는지 확인한다. 낼 수 없으면 사유 문자열, 가능하면 null. */
export function validateCommand(state: GameState, cmd: Command): string | null {
  const f = state.factions[cmd.faction];
  if (!f || !f.alive) return '이미 멸망한 세력입니다.';

  if ('officer' in cmd && cmd.officer) {
    const o = state.officers[cmd.officer];
    if (!o) return '없는 인물입니다.';
    if (o.status !== 'active' || o.faction !== cmd.faction) return '휘하 인물이 아닙니다.';
    if (o.acted) return `${officerName(cmd.officer)}은(는) 이번 계절에 이미 움직였습니다.`;
    if (o.armyId) return `${officerName(cmd.officer)}은(는) 출진 중입니다.`;
  }

  if ('castle' in cmd && cmd.castle) {
    const c = state.castles[cmd.castle];
    if (!c) return '없는 거점입니다.';
    if (c.owner !== cmd.faction) return '아군 거점이 아닙니다.';
    if ('officer' in cmd && cmd.officer) {
      const o = state.officers[cmd.officer];
      if (o && o.location !== cmd.castle) return '그 거점에 있지 않은 인물입니다.';
    }
  }

  switch (cmd.kind) {
    case 'develop': {
      const c = state.castles[cmd.castle];
      const def = castleDef(cmd.castle);
      if (c.dev[cmd.target] >= def.maxDev[cmd.target])
        return `${DEV_LABEL[cmd.target]}은(는) 이미 상한입니다.`;
      if (f.resources.gold < B.developCost) return '재화가 부족합니다.';
      return null;
    }
    case 'conscript': {
      const c = state.castles[cmd.castle];
      if (cmd.amount <= 0) return '병력 수가 잘못되었습니다.';
      if (cmd.amount > B.conscriptMax) return `한 번에 ${B.conscriptMax}명까지 징병할 수 있습니다.`;
      if (c.troops + cmd.amount > maxTroops(c))
        return `병영 수용 한계(${maxTroops(c).toLocaleString()}명)를 넘습니다.`;
      const units = availableUnits(cmd.faction, f.institutions).map((u) => u.id);
      if (!units.includes(cmd.unitType)) return '징병할 수 없는 병종입니다.';
      const cost = conscriptCost(unitDef(cmd.unitType), cmd.amount, factionTraits(state, cmd.faction));
      if (f.resources.gold < cost.gold) return '재화가 부족합니다.';
      if (f.resources.iron < cost.iron) return '철이 부족합니다.';
      if (c.loyalty < 20) return '민심이 너무 나빠 사람을 모을 수 없습니다.';
      return null;
    }
    case 'train':
      if (f.resources.gold < B.trainCost) return '재화가 부족합니다.';
      if (state.castles[cmd.castle].troops <= 0) return '훈련할 병력이 없습니다.';
      if (state.castles[cmd.castle].training >= 100) return '이미 훈련도가 최고입니다.';
      return null;
    case 'patrol':
      if (f.resources.gold < B.patrolCost) return '재화가 부족합니다.';
      if (state.castles[cmd.castle].loyalty >= 100) return '민심이 이미 최고입니다.';
      return null;
    case 'search':
      if (f.resources.gold < B.searchCost) return '재화가 부족합니다.';
      return null;
    case 'stockpile': {
      const c = state.castles[cmd.castle];
      if (cmd.grain <= 0) return '수량이 잘못되었습니다.';
      if (f.resources.grain < cmd.grain) return '창고의 곡물이 부족합니다.';
      if (c.stock >= stockCap(state, cmd.faction, cmd.castle)) return '비축 상한입니다.';
      return null;
    }
    case 'recruit': {
      const t = state.officers[cmd.targetOfficer];
      if (!t) return '없는 인물입니다.';
      if (t.status === 'dead') return '이미 세상을 떠났습니다.';
      if (t.status === 'active') return '이미 어딘가에 출사한 인물입니다.';
      if (t.hidden) return '아직 소재를 모릅니다. 먼저 탐색이 필요합니다.';
      if (t.location !== cmd.castle) return '그 거점에 있는 인물이 아닙니다.';
      if (f.resources.gold < B.searchCost) return '재화가 부족합니다.';
      return null;
    }
    case 'captive': {
      const t = state.officers[cmd.targetOfficer];
      if (!t || t.status !== 'captured' || t.captor !== cmd.faction) return '휘하의 포로가 아닙니다.';
      return null;
    }
    case 'institution': {
      const def = institutionDef(cmd.institution);
      if (f.institutions.includes(def.id)) return '이미 반포한 제도입니다.';
      if (def.faction && def.faction !== cmd.faction) return '이 세력이 반포할 수 있는 제도가 아닙니다.';
      if (f.resources.gold < def.cost.gold) return '재화가 부족합니다.';
      if (def.cost.cause && f.resources.cause < def.cost.cause) return '명분이 부족합니다.';
      if (def.requires && !evaluate(def.requires, makeContext(state, cmd.faction)))
        return '선행 조건을 갖추지 못했습니다.';
      if (!cmd.force && !councilPass(state.factions[cmd.faction], def.councilDC, hasAutocrat(state, cmd.faction)))
        return `귀족회의의 지지가 모자랍니다. (필요 ${def.councilDC}, 현재 ${Math.round(f.councilSupport)})`;
      return null;
    }
    default:
      return null;
  }
}

function hasAutocrat(state: GameState, faction: string): boolean {
  return factionHasSkill(state, faction, 'autocrat');
}

/** 제도 반영 후의 거점 비축 상한 */
export function stockCap(state: GameState, faction: string, castleId: string): number {
  const base = maxStock(state.castles[castleId]);
  return hasInstitution(state, faction, 'chochang') ? Math.round(base * 1.4) : base;
}

/* ------------------------------------------------------------------ *
 * 적용
 * ------------------------------------------------------------------ */

function consumeOfficer(state: GameState, id: string | undefined): OfficerState | undefined {
  if (!id) return undefined;
  const o = state.officers[id];
  if (o) o.acted = true;
  return o;
}

/**
 * 내정·인사·제도 명령을 적용한다.
 * @returns 로그 문자열 (실패 시 null)
 */
export function applyDomesticCommand(
  state: GameState,
  cmd: Command,
  rng: RngCursor
): string | null {
  const err = validateCommand(state, cmd);
  if (err) return null;
  const f = state.factions[cmd.faction];

  switch (cmd.kind) {
    case 'develop':
      return doDevelop(state, cmd, rng);
    case 'conscript':
      return doConscript(state, cmd);
    case 'train':
      return doTrain(state, cmd, rng);
    case 'patrol':
      return doPatrol(state, cmd, rng);
    case 'search':
      return doSearch(state, cmd, rng);
    case 'stockpile':
      return doStockpile(state, cmd);
    case 'recruit':
      return doRecruit(state, cmd, rng);
    case 'captive': {
      const t = state.officers[cmd.targetOfficer];
      const def = officerDef(cmd.targetOfficer);
      if (cmd.action === 'execute') {
        t.status = 'dead';
        t.captor = null;
        adjustCouncilForExecution(state, cmd.faction, def.loyalty_type);
        return `${def.name}을(를) 처형했다.`;
      }
      if (cmd.action === 'release') {
        t.status = 'free';
        t.captor = null;
        t.hidden = false;
        t.faction = null;
        t.location = null;
        f.resources.cause = clamp(f.resources.cause + 5, 0, 100);
        return `${def.name}을(를) 놓아 보냈다. (명분 +5)`;
      }
      // 등용 시도
      const recruiter = bestRecruiter(state, cmd.faction);
      const score = recruitScore(officerDef(recruiter), def, { captive: true });
      if (score + rng.int(0, 25) >= B.recruitDC) {
        const cap = capitalOf(state, cmd.faction);
        if (!cap) return null;
        t.status = 'active';
        t.faction = cmd.faction;
        t.captor = null;
        t.hidden = false;
        t.location = cap;
        t.loyalty = 55;
        state.castles[cap].officers.push(t.id);
        return `${def.name}이(가) 항복하여 휘하에 들었다.`;
      }
      return `${def.name}은(는) 끝내 고개를 숙이지 않았다.`;
    }
    case 'institution':
      return doInstitution(state, cmd, rng);
    default:
      return null;
  }
}

function capitalOf(state: GameState, faction: string): string | undefined {
  const owned = Object.values(state.castles).filter((c) => c.owner === faction);
  return (owned.find((c) => castleDef(c.id).type === 'capital') ?? owned[0])?.id;
}

function bestRecruiter(state: GameState, faction: string): string {
  const list = Object.values(state.officers).filter(
    (o) => o.faction === faction && o.status === 'active'
  );
  if (list.length === 0) return Object.keys(state.officers)[0];
  return list.reduce((best, o) =>
    officerDef(o.id).stats.chr > officerDef(best.id).stats.chr ? o : best
  ).id;
}

function adjustCouncilForExecution(state: GameState, faction: string, type: string): void {
  const f = state.factions[faction];
  // 충의로 이름난 자를 베면 민심이 상한다.
  if (type === 'loyal') {
    f.resources.cause = clamp(f.resources.cause - 8, 0, 100);
    for (const c of Object.values(state.castles)) {
      if (c.owner === faction) adjustLoyalty(c, -3);
    }
  }
}

function doDevelop(state: GameState, cmd: DevelopCommand, rng: RngCursor): string {
  const o = consumeOfficer(state, cmd.officer)!;
  const c = state.castles[cmd.castle];
  const def = castleDef(cmd.castle);
  state.factions[cmd.faction].resources.gold -= B.developCost;

  const gain = developGain(officerDef(o.id), c, def, cmd.target) * rng.jitter(0.12);
  c.dev[cmd.target] = Math.min(def.maxDev[cmd.target], c.dev[cmd.target] + gain);
  return `${officerName(o.id)}이(가) ${castleName(cmd.castle)}의 ${DEV_LABEL[cmd.target]}을(를) 개발했다. (+${gain.toFixed(1)})`;
}

function doConscript(state: GameState, cmd: ConscriptCommand): string {
  const o = consumeOfficer(state, cmd.officer)!;
  const c = state.castles[cmd.castle];
  const f = state.factions[cmd.faction];
  const unit = unitDef(cmd.unitType);
  const cost = conscriptCost(unit, cmd.amount, factionTraits(state, cmd.faction));
  const discount = hasInstitution(state, cmd.faction, 'gunje') ? 0.85 : 1;

  f.resources.gold -= Math.round(cost.gold * discount);
  f.resources.iron -= Math.round(cost.iron * discount);

  // 신병이 들어오면 전체 훈련도·사기가 희석된다.
  const before = c.troops;
  c.troops += cmd.amount;
  c.training = (c.training * before + B.recruitTraining * cmd.amount) / Math.max(1, c.troops);

  const stack = c.composition.find((s) => s.unitType === cmd.unitType);
  if (stack) stack.count += cmd.amount;
  else c.composition.push({ unitType: cmd.unitType, count: cmd.amount });

  adjustLoyalty(c, -(cmd.amount / 1000) * B.conscriptLoyaltyCost);
  return `${officerName(o.id)}이(가) ${castleName(cmd.castle)}에서 ${unit.name} ${cmd.amount.toLocaleString()}명을 징집했다.`;
}

function doTrain(state: GameState, cmd: TrainCommand, rng: RngCursor): string {
  const o = consumeOfficer(state, cmd.officer)!;
  const c = state.castles[cmd.castle];
  state.factions[cmd.faction].resources.gold -= B.trainCost;
  const bonus = hasInstitution(state, cmd.faction, 'gunje') ? 1.25 : 1;
  const gain = trainGain(officerDef(o.id), c) * bonus * rng.jitter(0.1);
  c.training = clamp(c.training + gain, 0, 100);
  return `${officerName(o.id)}이(가) ${castleName(cmd.castle)}의 병사를 조련했다. (훈련도 +${gain.toFixed(1)})`;
}

function doPatrol(state: GameState, cmd: PatrolCommand, rng: RngCursor): string {
  const o = consumeOfficer(state, cmd.officer)!;
  const c = state.castles[cmd.castle];
  state.factions[cmd.faction].resources.gold -= B.patrolCost;
  const gain = patrolGain(officerDef(o.id), c) * rng.jitter(0.1);
  adjustLoyalty(c, gain);
  return `${officerName(o.id)}이(가) ${castleName(cmd.castle)}를 순찰했다. (민심 +${gain.toFixed(1)})`;
}

function doSearch(state: GameState, cmd: SearchCommand, rng: RngCursor): string {
  const o = consumeOfficer(state, cmd.officer)!;
  const f = state.factions[cmd.faction];
  f.resources.gold -= B.searchCost;

  let score = searchScore(officerDef(o.id)) + rng.int(0, 30);
  if (
    hasInstitution(state, cmd.faction, 'taehak') ||
    hasInstitution(state, cmd.faction, 'baksa') ||
    hasInstitution(state, cmd.faction, 'hwarangdo')
  ) {
    score += 15;
  }
  if (score < B.searchDC) {
    return `${officerName(o.id)}이(가) ${castleName(cmd.castle)} 일대를 뒤졌으나 소득이 없었다.`;
  }

  // 이 거점에 숨어 있는 재야를 먼저 찾는다.
  const hiddenHere = Object.values(state.officers).filter(
    (x) => x.status === 'free' && x.hidden && x.location === cmd.castle
  );
  const found = rng.pick(hiddenHere);
  if (found) {
    found.hidden = false;
    return `${officerName(o.id)}이(가) ${castleName(cmd.castle)}에서 재야의 ${officerName(found.id)}을(를) 찾아냈다.`;
  }

  // 화랑도가 있으면 무명 청년을 길러 성장형 인재로 만든다.
  if (hasInstitution(state, cmd.faction, 'hwarangdo') || hasSkill(officerDef(o.id), 'hwarang')) {
    const grown = growHwarang(state, cmd.castle, rng);
    if (grown) return grown;
  }
  return `${officerName(o.id)}이(가) 인재를 구했으나 쓸 만한 자를 만나지 못했다.`;
}

/**
 * 화랑도 육성 — 아직 등장 연도가 되지 않은 인물을 조기 발탁한다.
 * (완전한 절차생성 인물은 백로그. 여기서는 데이터에 있는 후세대를 앞당긴다.)
 */
function growHwarang(state: GameState, castle: string, rng: RngCursor): string | null {
  const upcoming = Object.values(state.officers).filter((o) => {
    if (o.status !== 'free' || !o.hidden || o.location !== null) return false;
    const def = officerDef(o.id);
    return def.death >= state.year && def.birth + 15 > state.year && def.birth <= state.year;
  });
  const pick = rng.pick(upcoming);
  if (!pick) return null;
  pick.hidden = false;
  pick.location = castle;
  pick.growth = { lead: 3, war: 3, chr: 5 };
  return `화랑도에서 ${officerName(pick.id)}(이)라는 청년을 발탁했다. 아직 어리나 그릇이 크다.`;
}

function doStockpile(state: GameState, cmd: StockpileCommand): string {
  const o = consumeOfficer(state, cmd.officer)!;
  const c = state.castles[cmd.castle];
  const f = state.factions[cmd.faction];
  const cap = stockCap(state, cmd.faction, cmd.castle);
  const amount = Math.min(cmd.grain, f.resources.grain, cap - c.stock);
  if (amount <= 0) return `${castleName(cmd.castle)}의 창고가 이미 가득하다.`;
  // 조창 정비 이전에는 수송 중 축난다.
  const loss = hasInstitution(state, cmd.faction, 'chochang') ? 0 : 0.08;
  f.resources.grain -= amount;
  c.stock = Math.round(c.stock + amount * (1 - loss));
  return `${officerName(o.id)}이(가) ${castleName(cmd.castle)}에 병량 ${Math.round(amount * (1 - loss)).toLocaleString()}섬을 들였다.`;
}

function doRecruit(state: GameState, cmd: RecruitCommand, rng: RngCursor): string {
  const o = consumeOfficer(state, cmd.officer)!;
  const f = state.factions[cmd.faction];
  f.resources.gold -= B.searchCost;

  const target = state.officers[cmd.targetOfficer];
  const targetDef = officerDef(cmd.targetOfficer);
  const sameOrigin = targetDef.faction === cmd.faction;
  const score = recruitScore(officerDef(o.id), targetDef, { sameFactionOrigin: sameOrigin });

  if (score + rng.int(0, 30) >= B.recruitDC) {
    target.status = 'active';
    target.faction = cmd.faction;
    target.hidden = false;
    target.loyalty = sameOrigin ? 80 : 65;
    target.location = cmd.castle;
    state.castles[cmd.castle].officers.push(target.id);
    return `${officerName(o.id)}의 청으로 ${targetDef.name}이(가) 출사했다.`;
  }
  return `${targetDef.name}은(는) 아직 뜻이 없다며 사양했다.`;
}

function doInstitution(state: GameState, cmd: InstitutionCommand, rng: RngCursor): string {
  const def = institutionDef(cmd.institution);
  const f = state.factions[cmd.faction];
  f.resources.gold -= def.cost.gold;
  if (def.cost.cause) f.resources.cause -= def.cost.cause;
  f.institutions.push(def.id);

  const summaries = applyEffects(state, cmd.faction, def.effects, rng);

  // 귀족회의 반대를 무릅쓰고 강행하면 지지도가 크게 깎이고 정변 위험이 커진다.
  let forced = '';
  if (cmd.force && !councilPass(f, def.councilDC, hasAutocrat(state, cmd.faction))) {
    f.councilSupport = clamp(f.councilSupport - 18, 0, 100);
    forced = ' 귀족들의 반대를 무릅쓴 강행이었다.';
  }
  addLog(state, cmd.faction, 'domestic', `${def.name}을(를) 반포했다.${forced}`);
  return `${def.name} 반포.${summaries.length ? ` (${summaries.join(', ')})` : ''}${forced}`;
}
