/**
 * stats.ts — 자동 대전 집계.
 *
 * **표시 문구를 해석해서 세지 않는다.** 예전 집계는 `state.log` 의 글을
 * 정규식으로 읽었는데, 그 배열은 최근 600개만 남으므로 판이 길어지면
 * 그 뒤로 전투·함락이 한 건도 세어지지 않았다(손바뀜 판당 23.2회 대
 * 전투 판당 3.8회라는 모순이 그 흔적이다).
 *
 * 그래서 세는 대상은 `state.events` — 유형·행위자·대상·턴·고유 ID 를 가진
 * 구조화 사건 — 뿐이다. 여기 있는 함수는 전부 순수 함수라 테스트에서
 * 상태를 만들어 그대로 검사할 수 있다.
 */

import { CASTLES } from './data';
import type { CaptureMethod, FactionId, GameEvent, GameState } from './types';

/** 판 하나의 결과. 실제 승리와 시간 초과 우세를 **다른 자리에** 담는다. */
export interface RunSummary {
  /** 제한 턴 안에 승리 조건이 났는가 */
  outcome: 'victory' | 'timeout';
  /** 실제 승리자. 시간 초과면 null — 우세는 승리가 아니다 */
  winner: FactionId | null;
  /** unification · hegemony · last_standing · timeout */
  kind: string;
  /** 시간 초과 시 거점이 가장 많던 세력. 동률이면 null */
  leader: FactionId | null;
  /** 시간 초과 우세가 동률이었는가 */
  tie: boolean;
  endTurn: number;
  endYear: number;
  finalCastles: Record<FactionId, number>;
  /** 멸망한 세력 */
  eliminated: FactionId[];
  /** 거점이 실제로 손바뀜한 횟수 */
  flips: number;
  battles: number;
  captures: number;
  /** 함락 방식 분포 (전장 4종 + 전장 밖 경로) */
  methods: Record<string, number>;
}

/** `sinceId` 보다 뒤에 생긴 사건만. 커서는 배열 길이가 아니라 ID 다. */
export function eventsSince(state: GameState, sinceId: number): GameEvent[] {
  return state.events.filter((e) => e.id > sinceId);
}

export function lastEventId(state: GameState): number {
  return state.events.length ? state.events[state.events.length - 1].id : 0;
}

/** 거점이 가장 많은 세력. 동률이면 null — 우세를 첫 세력에게 몰아주지 않는다. */
export function leadingFaction(counts: Record<FactionId, number>): {
  leader: FactionId | null;
  tie: boolean;
} {
  const entries = Object.entries(counts);
  if (entries.length === 0) return { leader: null, tie: false };
  const best = Math.max(...entries.map(([, n]) => n));
  const top = entries.filter(([, n]) => n === best).map(([f]) => f);
  return top.length === 1 ? { leader: top[0], tie: false } : { leader: null, tie: true };
}

/**
 * 한 판을 요약한다.
 *
 * `factions` 는 그 시나리오가 세우는 세력들이다(거점 집계의 분모).
 */
export function summarizeRun(state: GameState, factions: readonly FactionId[]): RunSummary {
  const finalCastles: Record<FactionId, number> = {};
  for (const f of factions) finalCastles[f] = 0;
  for (const c of Object.values(state.castles)) {
    if (c.owner && c.owner in finalCastles) finalCastles[c.owner]++;
  }

  let flips = 0;
  let battles = 0;
  let captures = 0;
  const methods: Record<string, number> = {};
  const eliminated: FactionId[] = [];

  for (const e of state.events) {
    switch (e.kind) {
      case 'battle':
        battles++;
        break;
      case 'castle_captured':
        flips++;
        // 임자가 없던 성을 접수한 것은 「함락」이 아니다 — 방식 분포를 흐린다.
        if (e.from !== null) {
          captures++;
          methods[e.method] = (methods[e.method] ?? 0) + 1;
        }
        break;
      case 'faction_eliminated':
        eliminated.push(e.faction);
        break;
      default:
        break;
    }
  }

  const decided = state.result && state.result.kind !== 'player_defeated';
  const { leader, tie } = leadingFaction(finalCastles);

  return {
    outcome: decided ? 'victory' : 'timeout',
    winner: decided ? state.result!.winner : null,
    kind: decided ? state.result!.kind : 'timeout',
    leader: decided ? null : leader,
    tie: decided ? false : tie,
    endTurn: state.turn,
    endYear: state.year,
    finalCastles,
    eliminated,
    flips,
    battles,
    captures,
    methods,
  };
}

/** 함락 방식의 표시 순서와 이름 */
export const METHOD_LABEL: Record<CaptureMethod, string> = {
  assault: '강공',
  encircle: '포위(전장)',
  scheme: '계략',
  infiltrate: '내응',
  starvation: '포위(아사)',
  no_defender: '무장수',
  undefended: '무혈',
  neutral: '무주공산',
  event: '이벤트',
  invasion: '외세',
};

export const TOTAL_CASTLES = CASTLES.length;
