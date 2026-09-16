/**
 * victory.ts — 승리·패배 판정 (기획서 §3)
 *
 *  1. 통일 — 한반도 전 거점 점령
 *  2. 패권 — 살아남은 다른 세력을 모두 조공국으로 복속(또는 혼자 남음)
 *  3. 세력별 특수 승리는 이벤트 플래그로 판정한다.
 *
 * **진행률과 판정은 같은 정의를 쓴다.** 화면이 「조공국 2/2」를 보여 주는데
 * 판정이 나지 않으면 사용자는 무엇이 모자란지 알 길이 없다. 그래서
 * victoryStatus() 와 checkVictory() 는 같은 조건식을 본다.
 */

import { CASTLES, factionName } from './data';
import { addChronicle, addEvent, addLog, factionCastles, getRelation } from './state';
import type { FactionId, GameState } from './types';

export interface VictoryStatus {
  faction: FactionId;
  castles: number;
  totalCastles: number;
  vassals: number;
  /** 살아 있는 다른 세력 수 — vassals 의 분모 */
  rivals: number;
  unification: number; // 0~1 진행률
  hegemony: number;
}

/** 이 세력에게 조공을 바치는 세력들 (방향이 중요하다) */
function vassalsOf(state: GameState, faction: FactionId): FactionId[] {
  return Object.values(state.factions)
    .filter((o) => o.alive && o.id !== faction)
    .filter((o) => {
      const rel = getRelation(state, faction, o.id);
      return rel.status === 'tribute' && rel.overlord === faction;
    })
    .map((o) => o.id);
}

export function victoryStatus(state: GameState, faction: FactionId): VictoryStatus {
  const total = CASTLES.length;
  const owned = factionCastles(state, faction).length;
  const rivals = Object.values(state.factions).filter((f) => f.alive && f.id !== faction).length;
  const vassals = vassalsOf(state, faction).length;

  return {
    faction,
    castles: owned,
    totalCastles: total,
    vassals,
    rivals,
    unification: owned / total,
    // 혼자 남았으면 이미 패권이다. 화면이 1.0 을 보여 주고 판정도 같이 난다.
    hegemony: rivals === 0 ? 1 : vassals / rivals,
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
      const status = victoryStatus(state, f.id);
      // 혼자 남은 것도 패권이다 — 예전에는 이 경우 판정이 아예 나지 않아,
      // 다른 나라를 다 멸망시키고도 76 거점을 다 먹을 때까지 판이 끝나지 않았다.
      if (status.rivals === 0) {
        declare(state, f.id, 'last_standing');
        return;
      }
      if (status.vassals === status.rivals) {
        declare(state, f.id, 'hegemony');
        return;
      }
    }
  }

  // 패배 — 플레이어 세력이 멸망.
  // 관전자 실행에는 맡은 세력이 없으므로 이 판정을 하지 않는다.
  if (state.spectator) return;
  const player = state.factions[state.playerFaction];
  if (player && !player.alive) {
    const winner = findLeader(state);
    state.result = { winner, kind: 'player_defeated', year: state.year };
    state.phase = 'gameover';
    addChronicle(state, `${factionName(state.playerFaction)}의 사직이 끊기다.`);
    addEvent(state, { kind: 'game_over', winner, result: 'player_defeated' });
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
  const label = victoryLabel(kind);
  const line =
    kind === 'unification'
      ? '삼한을 하나로 아우르다'
      : kind === 'last_standing'
        ? '홀로 남아 천하를 쥐다'
        : '천하의 패권을 쥐다';
  addChronicle(state, `${factionName(faction)}, ${line}. (${state.year}년)`);
  addLog(state, null, 'system', `${factionName(faction)}의 ${label}.`);
  addEvent(state, { kind: 'game_over', winner: faction, result: kind });
}

export function victoryLabel(kind: string): string {
  switch (kind) {
    case 'unification':
      return '통일';
    case 'hegemony':
      return '패권';
    case 'last_standing':
      return '전멸승';
    case 'player_defeated':
      return '멸망';
    case 'timeout':
      return '시간 초과';
    default:
      return kind;
  }
}
