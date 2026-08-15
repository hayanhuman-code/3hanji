/**
 * effects.ts — 이벤트·제도의 효과 문자열을 상태 변경으로 옮긴다.
 *
 * 효과 문법:  name            예) reveal_talent
 *             name:값         예) gold:+800, flag:alt_history
 *             name(인자)      예) war(baekje), kill(bidam)
 *             name(인자):값   예) trust(baekje):+20, loyalty(daeya):-15
 *
 * 모든 효과는 "행위 세력(actor)" 기준으로 해석된다.
 */

import { castleName, factionName, officerName } from './data';
import { defaultComposition } from './state';
import {
  addChronicle,
  addLog,
  adjustLoyalty,
  adjustResource,
  capitalCastle,
  factionCastles,
  getRelation,
} from './state';
import type { RngCursor } from './rng';
import type { FactionId, GameState } from './types';
import { clamp } from './util';

interface ParsedEffect {
  name: string;
  args: string[];
  value?: string;
}

const EFFECT_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\(([^)]*)\))?(?::(.+))?$/;

export function parseEffect(src: string): ParsedEffect {
  const m = EFFECT_RE.exec(src.trim());
  if (!m) throw new Error(`효과 문법 오류: "${src}"`);
  return {
    name: m[1],
    args: m[2] ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : [],
    value: m[3]?.trim(),
  };
}

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = Number(v.replace('+', ''));
  return Number.isFinite(n) ? n : fallback;
}

/** 효과 문자열의 문법·대상만 검사한다 (데이터 검증기용). */
export const KNOWN_EFFECTS = new Set([
  'gold',
  'grain',
  'iron',
  'cause',
  'council',
  'autonomy',
  'flag',
  'unflag',
  'loyalty_all',
  'loyalty',
  'wall_all',
  'troops_all',
  'troops',
  'trust',
  'war',
  'peace',
  'alliance',
  'break_alliance',
  'kill',
  'join',
  'defect',
  'reveal_talent',
  'give_castle',
  'take_castle',
  'invasion',
]);

/**
 * 효과 하나를 적용한다.
 * @returns 사람이 읽을 수 있는 요약 (로그에 남긴다). 아무 일도 없으면 null.
 */
export function applyEffect(
  state: GameState,
  actor: FactionId,
  src: string,
  rng: RngCursor
): string | null {
  const { name, args, value } = parseEffect(src);
  const f = state.factions[actor];
  if (!f) return null;

  switch (name) {
    case 'gold':
    case 'grain':
    case 'iron':
    case 'cause': {
      const d = num(value);
      adjustResource(state, actor, name, d);
      const label = { gold: '재화', grain: '곡물', iron: '철', cause: '명분' }[name];
      return `${label} ${d >= 0 ? '+' : ''}${d}`;
    }

    case 'council': {
      const d = num(value);
      f.councilSupport = clamp(f.councilSupport + d, 0, 100);
      return `귀족 지지도 ${d >= 0 ? '+' : ''}${d}`;
    }

    case 'autonomy': {
      const d = num(value);
      f.autonomy = clamp(f.autonomy + d, 0, 100);
      return `자주성 ${d >= 0 ? '+' : ''}${d}`;
    }

    case 'flag': {
      const flag = value ?? args[0];
      if (flag && !f.flags.includes(flag)) f.flags.push(flag);
      return null;
    }

    case 'unflag': {
      const flag = value ?? args[0];
      if (flag) f.flags = f.flags.filter((x) => x !== flag);
      return null;
    }

    case 'loyalty_all': {
      const d = num(value);
      for (const c of factionCastles(state, actor)) adjustLoyalty(c, d);
      return `전 거점 민심 ${d >= 0 ? '+' : ''}${d}`;
    }

    case 'loyalty': {
      const c = state.castles[args[0]];
      if (!c) return null;
      const d = num(value);
      adjustLoyalty(c, d);
      return `${castleName(c.id)} 민심 ${d >= 0 ? '+' : ''}${d}`;
    }

    case 'wall_all': {
      const d = num(value);
      for (const c of factionCastles(state, actor)) c.dev.wall = clamp(c.dev.wall + d, 0, 100);
      return `전 거점 성곽 ${d >= 0 ? '+' : ''}${d}`;
    }

    case 'troops_all': {
      const total = num(value);
      const owned = factionCastles(state, actor);
      if (owned.length === 0) return null;
      const per = Math.round(total / owned.length);
      for (const c of owned) {
        c.troops = Math.max(0, c.troops + per);
        c.composition = defaultComposition(actor, c.troops);
      }
      return `병력 ${total >= 0 ? '+' : ''}${total}`;
    }

    case 'troops': {
      const c = state.castles[args[0]];
      if (!c || !c.owner) return null;
      const d = num(value);
      c.troops = Math.max(0, c.troops + d);
      c.composition = defaultComposition(c.owner, c.troops);
      return `${castleName(c.id)} 병력 ${d >= 0 ? '+' : ''}${d}`;
    }

    case 'trust': {
      const other = args[0];
      if (!other || !state.factions[other]) return null;
      const rel = getRelation(state, actor, other);
      const d = num(value);
      rel.trust = clamp(rel.trust + d, -100, 100);
      return `${factionName(other)} 우호도 ${d >= 0 ? '+' : ''}${d}`;
    }

    case 'war':
    case 'peace':
    case 'alliance': {
      const other = args[0];
      if (!other || !state.factions[other] || other === actor) return null;
      const rel = getRelation(state, actor, other);
      rel.status = name;
      if (name === 'war') rel.trust = Math.min(rel.trust, -40);
      if (name === 'alliance') rel.trust = Math.max(rel.trust, 40);
      if (name === 'peace') rel.truceTurns = Math.max(rel.truceTurns, 4);
      const label = { war: '전쟁', peace: '화평', alliance: '동맹' }[name];
      return `${factionName(other)}와(과) ${label}`;
    }

    case 'break_alliance': {
      const other = args[0];
      if (!other) return null;
      const rel = getRelation(state, actor, other);
      rel.status = 'peace';
      rel.trust = clamp(rel.trust - 45, -100, 100);
      return `${factionName(other)}와(과)의 동맹 파기`;
    }

    case 'kill': {
      const o = state.officers[args[0]];
      if (!o || o.status === 'dead') return null;
      removeOfficerFromWorld(state, args[0]);
      o.status = 'dead';
      addChronicle(state, `${officerName(args[0])} 죽다.`);
      return `${officerName(args[0])} 사망`;
    }

    case 'join': {
      const o = state.officers[args[0]];
      if (!o || o.status === 'dead' || o.faction === actor) return null;
      const cap = capitalCastle(state, actor);
      if (!cap) return null;
      removeOfficerFromWorld(state, args[0]);
      o.faction = actor;
      o.status = 'active';
      o.hidden = false;
      o.location = cap.id;
      o.loyalty = 75;
      cap.officers.push(args[0]);
      return `${officerName(args[0])} 등용`;
    }

    case 'defect': {
      const o = state.officers[args[0]];
      if (!o || o.status !== 'active' || o.faction !== actor) return null;
      removeOfficerFromWorld(state, args[0]);
      o.faction = null;
      o.status = 'free';
      o.hidden = true;
      return `${officerName(args[0])} 이탈`;
    }

    case 'reveal_talent': {
      const hidden = Object.values(state.officers).filter(
        (o) => o.status === 'free' && o.hidden && o.location && isOwnedBy(state, o.location, actor)
      );
      const pick = rng.pick(hidden);
      if (!pick) return null;
      pick.hidden = false;
      return `재야의 ${officerName(pick.id)} 발견`;
    }

    case 'give_castle': {
      const castle = state.castles[args[0]];
      if (!castle) return null;
      const to = args[1] === 'none' ? null : args[1];
      transferCastle(state, castle.id, to);
      return `${castleName(castle.id)} → ${factionName(to)}`;
    }

    case 'take_castle': {
      const castle = state.castles[args[0]];
      if (!castle) return null;
      transferCastle(state, castle.id, actor);
      return `${castleName(castle.id)} 점령`;
    }

    case 'invasion': {
      // 외세(수·당) 원정의 간이 구현.
      // 전용 침공 AI 는 M3 항목이므로, 여기서는 "국경 거점이 큰 피해를 입고
      // 막아내면 명분을 얻는" 스크립트로 처리한다.
      const size = num(args[1], 40000);
      return resolveInvasion(state, actor, args[0] ?? 'foreign', size, rng);
    }

    default:
      return null;
  }
}

export function applyEffects(
  state: GameState,
  actor: FactionId,
  effects: string[],
  rng: RngCursor
): string[] {
  const out: string[] = [];
  for (const e of effects) {
    try {
      const summary = applyEffect(state, actor, e, rng);
      if (summary) out.push(summary);
    } catch (err) {
      addLog(state, actor, 'system', `효과 적용 실패(${e}): ${(err as Error).message}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 보조
 * ------------------------------------------------------------------ */

function isOwnedBy(state: GameState, castle: string, faction: FactionId): boolean {
  return state.castles[castle]?.owner === faction;
}

/** 인물을 거점·부대 명부에서 떼어낸다. */
export function removeOfficerFromWorld(state: GameState, id: string): void {
  const o = state.officers[id];
  if (!o) return;
  if (o.location) {
    const c = state.castles[o.location];
    if (c) c.officers = c.officers.filter((x) => x !== id);
  }
  if (o.armyId) {
    const army = state.armies[o.armyId];
    if (army) {
      army.officers = army.officers.filter((x) => x !== id);
      if (army.commander === id) army.commander = army.officers[0] ?? army.commander;
    }
  }
  o.location = null;
  o.armyId = null;
}

/** 거점의 주인을 바꾸고 주둔 인물을 처리한다. */
export function transferCastle(
  state: GameState,
  castleId: string,
  to: FactionId | null
): { captured: string[] } {
  const castle = state.castles[castleId];
  const captured: string[] = [];
  if (!castle) return { captured };
  const from = castle.owner;
  if (from === to) return { captured };

  for (const oid of [...castle.officers]) {
    const o = state.officers[oid];
    if (!o) continue;
    removeOfficerFromWorld(state, oid);
    if (to === null) {
      o.faction = null;
      o.status = 'free';
      o.hidden = true;
      o.location = castleId;
    } else {
      o.status = 'captured';
      o.captor = to;
      o.faction = null;
      captured.push(oid);
    }
  }
  castle.officers = [];
  castle.owner = to;
  castle.besiegedBy = null;
  castle.siegeTurns = 0;
  castle.loyalty = 25;
  castle.troops = 0;
  castle.composition = [];
  castle.stock = Math.round(castle.stock * 0.3);

  // 마지막 거점을 잃으면 멸망.
  if (from) {
    const remaining = factionCastles(state, from).length;
    if (remaining === 0 && state.factions[from]) {
      state.factions[from].alive = false;
      addChronicle(state, `${factionName(from)} 멸망하다.`);
      addLog(state, null, 'system', `${factionName(from)}이(가) 멸망했다.`);
    }
  }
  return { captured };
}

/** 외세 원정 — 간이 스크립트 */
function resolveInvasion(
  state: GameState,
  target: FactionId,
  source: string,
  size: number,
  rng: RngCursor
): string {
  const owned = factionCastles(state, target);
  if (owned.length === 0) return '침공 대상 없음';

  // 성곽이 약한 거점부터 타격받는다.
  const frontier = owned.slice().sort((a, b) => a.dev.wall - b.dev.wall);
  let remaining = size;
  let totalLost = 0;
  const fallen: string[] = [];

  for (const c of frontier) {
    if (remaining <= 0) break;
    // 방어력 = 성곽 × 병력 × 사기(민심 대용)
    const defense = c.dev.wall * 90 + c.troops * 2.2;
    const attack = Math.min(remaining, defense * rng.float(0.7, 1.4));
    remaining -= attack;

    const lossRatio = clamp(attack / Math.max(1, defense), 0, 1) * rng.float(0.35, 0.75);
    const lost = Math.round(c.troops * lossRatio);
    c.troops = Math.max(0, c.troops - lost);
    c.composition = c.owner ? defaultComposition(c.owner, c.troops) : [];
    totalLost += lost;
    adjustLoyalty(c, -8);
    c.dev.wall = clamp(c.dev.wall - rng.int(3, 12), 0, 100);

    if (attack > defense) {
      fallen.push(c.id);
      transferCastle(state, c.id, null); // 초토화 후 무주공산
    }
  }

  const held = fallen.length === 0;
  if (held) {
    adjustResource(state, target, 'cause', 25);
    for (const c of factionCastles(state, target)) adjustLoyalty(c, 6);
    addChronicle(state, `${source === 'tang' ? '당' : '외세'}의 대군을 막아내다.`);
  } else {
    addChronicle(
      state,
      `${source === 'tang' ? '당' : '외세'}의 침공으로 ${fallen.map(castleName).join('·')} 함락.`
    );
  }

  return `외세 침공: 병력 -${totalLost}${held ? ' (격퇴, 명분 +25)' : `, ${fallen.map(castleName).join('·')} 상실`}`;
}
