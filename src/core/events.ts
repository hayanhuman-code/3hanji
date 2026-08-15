/**
 * events.ts — 이벤트 엔진 (시스템 상세계획 §3.6)
 *
 * 매 턴 events.json 전체의 트리거 조건을 평가하고, 발동 가능한 이벤트를 대기열에 넣는다.
 * 조건 평가는 dsl.ts 가, 효과 적용은 effects.ts 가 담당한다. 여기서는 흐름만 다룬다.
 */

import { EVENTS, eventDef, factionName, scenarioDef, tryOfficerDef } from './data';
import { evaluate, type DslContext, type DslValue } from './dsl';
import { applyEffects } from './effects';
import type { RngCursor } from './rng';
import { addChronicle, addLog, factionCastles, factionTroops, getRelation } from './state';
import type { EventDef, FactionId, GameState, PendingEvent } from './types';

/** 이벤트/제도 조건식이 볼 수 있는 게임 상태 */
export function makeContext(state: GameState, actor: FactionId): DslContext {
  const resolveFaction = (v: string | undefined): FactionId => (v && state.factions[v] ? v : actor);

  return {
    variable(name) {
      switch (name) {
        case 'year':
          return state.year;
        case 'season':
          return state.season;
        case 'turn':
          return state.turn;
        case 'actor':
          return actor;
        default:
          return undefined;
      }
    },

    call(name, args): DslValue {
      switch (name) {
        case 'owns': {
          const [f, c] = args.length >= 2 ? args : [actor, args[0]];
          return state.castles[c]?.owner === f;
        }
        case 'war':
        case 'peace':
        case 'alliance':
        case 'tribute': {
          const [a, b] = args.length >= 2 ? args : [actor, args[0]];
          if (!a || !b || !state.factions[a] || !state.factions[b]) return false;
          return getRelation(state, a, b).status === name;
        }
        case 'trust': {
          const [a, b] = args.length >= 2 ? args : [actor, args[0]];
          if (!a || !b || !state.factions[a] || !state.factions[b]) return 0;
          return getRelation(state, a, b).trust;
        }
        case 'flag': {
          const [f, name2] = args.length >= 2 ? args : [actor, args[0]];
          return state.factions[f]?.flags.includes(name2) ?? false;
        }
        case 'institution': {
          const [f, id] = args.length >= 2 ? args : [actor, args[0]];
          return state.factions[f]?.institutions.includes(id) ?? false;
        }
        case 'alive': {
          const o = state.officers[args[0]];
          return !!o && o.status !== 'dead';
        }
        case 'serves': {
          const [oid, f] = args.length >= 2 ? args : [args[0], actor];
          const o = state.officers[oid];
          return !!o && o.status === 'active' && o.faction === f;
        }
        case 'hasSkill': {
          const def = tryOfficerDef(args[0]);
          return !!def && def.skills.includes(args[1]);
        }
        case 'castles':
          return factionCastles(state, resolveFaction(args[0])).length;
        case 'troops':
          return factionTroops(state, resolveFaction(args[0]));
        case 'gold':
          return state.factions[resolveFaction(args[0])]?.resources.gold ?? 0;
        case 'grain':
          return state.factions[resolveFaction(args[0])]?.resources.grain ?? 0;
        case 'cause':
          return state.factions[resolveFaction(args[0])]?.resources.cause ?? 0;
        case 'autonomy':
          return state.factions[resolveFaction(args[0])]?.autonomy ?? 0;
        case 'council':
          return state.factions[resolveFaction(args[0])]?.councilSupport ?? 0;
        case 'factionAlive':
          return state.factions[resolveFaction(args[0])]?.alive ?? false;
        default:
          throw new Error(`알 수 없는 조건 함수: ${name}`);
      }
    },
  };
}

/**
 * 이 시나리오/옵션에서 활성인 이벤트 목록.
 *
 * 시나리오가 `events` 를 명시하면 그 목록만 쓴다. 압축 캠페인처럼
 * 서기 연표를 쓰지 않는 판에서 역사 이벤트가 끼어들지 않게 하기 위해서다
 * (빈 배열 = 이벤트 없음).
 */
export function activeEvents(state: GameState): EventDef[] {
  const allowed = scenarioDef(state.scenarioId).events;
  const pool = allowed ? EVENTS.filter((e) => allowed.includes(e.id)) : EVENTS;
  return pool.filter((e) => state.options.historicalEvents || !e.historical);
}

function triggerMatches(state: GameState, e: EventDef, actor: FactionId, rng: RngCursor): boolean {
  const t = e.trigger;
  if (t.year !== undefined && state.year !== t.year) return false;
  if (t.yearFrom !== undefined && state.year < t.yearFrom) return false;
  if (t.yearTo !== undefined && state.year > t.yearTo) return false;
  if (t.condition) {
    try {
      if (!evaluate(t.condition, makeContext(state, actor))) return false;
    } catch (err) {
      addLog(state, null, 'system', `이벤트 조건 오류 [${e.id}]: ${(err as Error).message}`);
      return false;
    }
  }
  if (t.chance !== undefined && !rng.chance(t.chance)) return false;
  return true;
}

/**
 * 턴 엔진 ⑤단계: 이벤트 트리거 검사.
 * 발동 가능한 이벤트를 state.pendingEvents 에 쌓는다.
 */
export function checkEvents(state: GameState, rng: RngCursor): void {
  const fired = new Set(state.firedEvents);
  const candidates = activeEvents(state);

  for (const e of candidates) {
    const once = e.once ?? true;
    if (once && fired.has(e.id)) continue;

    const actors: FactionId[] = e.faction
      ? state.factions[e.faction]?.alive
        ? [e.faction]
        : []
      : Object.values(state.factions)
          .filter((f) => f.alive)
          .map((f) => f.id);

    for (const actor of actors) {
      if (!triggerMatches(state, e, actor, rng)) continue;
      state.pendingEvents.push({ eventId: e.id, faction: actor });
      if (once) {
        fired.add(e.id);
        state.firedEvents.push(e.id);
        break; // 1회성 이벤트는 한 세력만 겪는다.
      }
    }
  }
}

/** 이벤트 선택지를 적용한다. */
export function resolveEventChoice(
  state: GameState,
  pending: PendingEvent,
  choiceIndex: number,
  rng: RngCursor
): string[] {
  const def = eventDef(pending.eventId);
  const choice = def.choices[choiceIndex] ?? def.choices[0];
  if (!choice) return [];

  const summaries = applyEffects(state, pending.faction, choice.effects, rng);
  addLog(
    state,
    pending.faction,
    'event',
    `[${def.name}] ${choice.text}${summaries.length ? ` → ${summaries.join(', ')}` : ''}`
  );
  if (def.historical) {
    addChronicle(state, `${factionName(pending.faction)}: ${def.name} — ${choice.text}`);
  }
  return summaries;
}

/** AI 가 이벤트 선택지를 고른다. */
export function pickAIChoice(_state: GameState, pending: PendingEvent, rng: RngCursor): number {
  const def = eventDef(pending.eventId);
  if (def.choices.length <= 1) return 0;
  const idx = def.choices.map((_, i) => i);
  const chosen = rng.weighted(idx, (i) => def.choices[i].aiWeight ?? 1);
  return chosen ?? 0;
}

/** 혜안(foresight) 특기 보유 시, 다음에 올 수 있는 역사 이벤트를 귀띔한다. */
export function foresightHints(state: GameState, faction: FactionId): string[] {
  const hints: string[] = [];
  const fired = new Set(state.firedEvents);
  for (const e of activeEvents(state)) {
    if (!e.historical || fired.has(e.id)) continue;
    if (e.faction && e.faction !== faction) continue;
    const from = e.trigger.year ?? e.trigger.yearFrom;
    if (from === undefined) continue;
    if (from >= state.year && from <= state.year + 3) {
      hints.push(`${from}년 — ${e.name}`);
    }
  }
  return hints;
}
