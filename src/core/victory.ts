/**
 * victory.ts — 승리·패배 판정 (기획서 §3)
 *
 *  1. 통일 — 한반도 전 거점 점령
 *  2. 패권 — 타 세력을 모두 조공국으로 복속(또는 전 거점의 3분의 2 이상 장악)
 *  3. 세력별 특수 승리는 이벤트 플래그로 판정한다.
 */

import { CASTLES, factionName } from './data';
import { addChronicle, addLog, factionCastles, getRelation } from './state';
import type { FactionId, GameState } from './types';

export interface VictoryStatus {
  faction: FactionId;
  castles: number;
  totalCastles: number;
  vassals: number;
  unification: number; // 0~1 진행률
  hegemony: number;
}

export function victoryStatus(state: GameState, faction: FactionId): VictoryStatus {
  const total = CASTLES.length;
  const owned = factionCastles(state, faction).length;
  const others = Object.values(state.factions).filter((f) => f.alive && f.id !== faction);
  const vassals = others.filter(
    (o) => getRelation(state, faction, o.id).status === 'tribute'
  ).length;

  const subdued = others.filter(
    (o) => getRelation(state, faction, o.id).status === 'tribute' || !o.alive
  ).length;

  return {
    faction,
    castles: owned,
    totalCastles: total,
    vassals,
    unification: owned / total,
    hegemony: others.length === 0 ? 1 : Math.max(subdued / others.length, owned / (total * 0.67)),
  };
}

/** 매 턴 결산 후 호출. 조건이 갖춰지면 state.result 를 채운다. */
export function checkVictory(state: GameState): void {
  if (state.result) return;
  const total = CASTLES.length;

  for (const f of Object.values(state.factions)) {
    if (!f.alive) continue;
    const owned = factionCastles(state, f.id).length;

    // 1. 통일
    if (owned === total) {
      declare(state, f.id, 'unification');
      return;
    }

    // 2. 패권 — 살아남은 다른 세력을 모두 조공국으로 복속시킨다.
    //    (기획서 §3 승리 조건 2. 승리 조건은 옵션으로 택일하므로 설정된 경우에만 판정한다.)
    if (state.options.victory === 'hegemony') {
      const others = Object.values(state.factions).filter((o) => o.id !== f.id && o.alive);
      const allSubdued =
        others.length > 0 &&
        others.every((o) => {
          const rel = getRelation(state, f.id, o.id);
          return rel.status === 'tribute' && rel.overlord === f.id;
        });
      if (allSubdued) {
        declare(state, f.id, 'hegemony');
        return;
      }
    }
  }

  // 패배 — 플레이어 세력이 멸망
  const player = state.factions[state.playerFaction];
  if (player && !player.alive) {
    state.result = { winner: findLeader(state), kind: 'player_defeated', year: state.year };
    state.phase = 'gameover';
    addChronicle(state, `${factionName(state.playerFaction)}의 사직이 끊기다.`);
  }
}

function findLeader(state: GameState): FactionId {
  const alive = Object.values(state.factions).filter((f) => f.alive);
  if (alive.length === 0) return state.playerFaction;
  return alive.reduce((best, f) =>
    factionCastles(state, f.id).length > factionCastles(state, best.id).length ? f : best
  ).id;
}

function declare(state: GameState, faction: FactionId, kind: string): void {
  state.result = { winner: faction, kind, year: state.year };
  state.phase = 'gameover';
  const label = kind === 'unification' ? '삼한을 하나로 아우르다' : '천하의 패권을 쥐다';
  addChronicle(state, `${factionName(faction)}, ${label}. (${state.year}년)`);
  addLog(state, null, 'system', `${factionName(faction)}의 ${label}.`);
}

export function victoryLabel(kind: string): string {
  switch (kind) {
    case 'unification':
      return '통일';
    case 'hegemony':
      return '패권';
    case 'player_defeated':
      return '멸망';
    default:
      return kind;
  }
}
