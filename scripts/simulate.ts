/**
 * simulate.ts — 헤드리스 자동 시뮬레이션 (시스템 상세계획 §7)
 *
 *   "AI 끼리 100회 대전시켜 세력별 승률을 집계 → 승률이 25~40% 범위를 벗어나면
 *    formulas.ts 를 조정한다."
 *
 * 상태기계 구조라 브라우저 없이 그대로 돌릴 수 있다.
 *
 * 실행:
 *   npm run simulate                 # 기본 30회, 시나리오 s642
 *   npm run simulate -- 100 s551 200 # 100회, s551, 최대 200턴
 */

import { PLAYABLE_FACTIONS, factionName, scenarioDef } from '../src/core/data';
import { pickAIChoice } from '../src/core/events';
import { RngCursor } from '../src/core/rng';
import { createGame } from '../src/core/state';
import { factionCastles, factionTroops } from '../src/core/state';
import { beginNextTurn, completeEvent, resolveTurn } from '../src/core/turn';
import { victoryLabel } from '../src/core/victory';
import type { GameState } from '../src/core/types';

const args = process.argv.slice(2);
const RUNS = Number(args[0] ?? 30);
const SCENARIO = args[1] ?? 's642';
const MAX_TURNS = Number(args[2] ?? 160);

interface RunResult {
  winner: string | null;
  kind: string;
  turns: number;
  year: number;
  finalCastles: Record<string, number>;
  /**
   * **거점이 실제로 손바뀜한 횟수.**
   *
   * 승률만 보면 왜 안 끝나는지 알 수 없다. 성이 안 바뀌면 공성이 여전히
   * 안 되는 것이고, 그러면 승률 조정은 노이즈를 튜닝하는 일이 된다.
   */
  flips: number;
  /** 함락 방식 분포 (§6.3). 한쪽으로 쏠리면 나머지 수단이 사문서다 */
  methods: Record<string, number>;
  /** 전투 횟수와 그중 함락으로 끝난 횟수 */
  battles: number;
  captures: number;
}

function runOne(seed: number): RunResult {
  const scenario = scenarioDef(SCENARIO);
  const factions = Object.keys(scenario.ownership);
  const state: GameState = createGame({
    scenarioId: SCENARIO,
    // 관전자 시점: 아래에서 전 세력을 AI 로 바꾼다.
    playerFaction: factions[0],
    options: { autoBattle: true, historicalEvents: true },
    seed,
  });
  for (const f of Object.values(state.factions)) f.isAI = true;

  const rng = new RngCursor(seed ^ 0x5f3759df);

  // 거점 소유를 매 턴 비교해 손바뀜을 센다
  const owner = new Map<string, string | null>();
  for (const c of Object.values(state.castles)) owner.set(c.id, c.owner);
  let flips = 0;
  const methods: Record<string, number> = {};
  let battles = 0;
  let captures = 0;
  let logAt = 0;

  const scanTurn = () => {
    for (const c of Object.values(state.castles)) {
      if (owner.get(c.id) !== c.owner) {
        flips++;
        owner.set(c.id, c.owner);
      }
    }
    // 전투 기록에서 함락 방식을 읽는다 (로그가 단일 출처다)
    for (const l of state.log.slice(logAt)) {
      if (l.kind !== 'battle') continue;
      if (!/vs/.test(l.text)) continue;
      battles++;
      const m = l.text.match(/함락 \((강공|포위|계략|내응)\)/);
      if (/함락/.test(l.text)) captures++;
      if (m) methods[m[1]] = (methods[m[1]] ?? 0) + 1;
    }
    logAt = state.log.length;
  };

  while (!state.result && state.turn <= MAX_TURNS) {
    let guard = 0;
    for (;;) {
      const step = resolveTurn(state);
      if (step.kind === 'event') {
        completeEvent(state, pickAIChoice(state, step.pending, rng));
        continue;
      }
      if (step.kind === 'battle') {
        // autoBattle 옵션이 켜져 있으면 여기 올 일이 없다. 안전장치.
        state.pendingBattles.shift();
        continue;
      }
      break;
    }
    scanTurn();
    if (state.result) break;
    beginNextTurn(state);
    if (guard++ > 10000) break;
  }
  scanTurn();

  const finalCastles: Record<string, number> = {};
  for (const f of factions) finalCastles[f] = factionCastles(state, f).length;

  // 시간 초과로 끝나면 거점이 가장 많은 세력을 우세로 본다.
  let winner = state.result?.winner ?? null;
  let kind = state.result?.kind ?? 'timeout';
  if (!winner) {
    winner = factions.reduce((a, b) => (finalCastles[a] >= finalCastles[b] ? a : b));
    kind = 'timeout';
  }

  return {
    winner,
    kind,
    turns: state.turn,
    year: state.year,
    finalCastles,
    flips,
    methods,
    battles,
    captures,
  };
}

/* --------------------------------- 실행 --------------------------------- */

const scenario = scenarioDef(SCENARIO);
console.log(
  `시뮬레이션: ${scenario.name} (${scenario.startYear}년) × ${RUNS}회, 최대 ${MAX_TURNS}턴\n`
);

const wins: Record<string, number> = {};
const decisive: Record<string, number> = {};
const results: RunResult[] = [];
const started = Date.now();

for (let i = 0; i < RUNS; i++) {
  const r = runOne(0x1000 + i * 7919);
  results.push(r);
  if (r.winner) {
    wins[r.winner] = (wins[r.winner] ?? 0) + 1;
    if (r.kind !== 'timeout') decisive[r.winner] = (decisive[r.winner] ?? 0) + 1;
  }
  process.stdout.write(
    `\r  진행 ${i + 1}/${RUNS} — 최근: ${factionName(r.winner!)} (${victoryLabel(r.kind)}, ${r.year}년)   `
  );
}
process.stdout.write('\n\n');

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const playable = PLAYABLE_FACTIONS.filter((f) => scenario.ownership[f.id]?.length);

console.log('세력별 승률 (목표 구간 25~40%)');
console.log('─'.repeat(58));
for (const f of playable) {
  const w = wins[f.id] ?? 0;
  const d = decisive[f.id] ?? 0;
  const rate = (w / RUNS) * 100;
  const bar = '█'.repeat(Math.round(rate / 2.5));
  const flag = rate < 25 ? ' ← 약함' : rate > 40 ? ' ← 강함' : '';
  console.log(
    `  ${f.name.padEnd(4)} ${rate.toFixed(1).padStart(5)}%  (${String(w).padStart(3)}승, 결착 ${d}) ${bar}${flag}`
  );
}
console.log('─'.repeat(58));

// 판이 실제로 움직였는지 — 거점이 그대로면 승률보다 먼저 이것부터 봐야 한다.
console.log('\n시작 → 평균 최종 거점');
for (const f of playable) {
  const start = scenario.ownership[f.id]?.length ?? 0;
  const end = results.reduce((s, r) => s + (r.finalCastles[f.id] ?? 0), 0) / RUNS;
  const peak = Math.max(...results.map((r) => r.finalCastles[f.id] ?? 0));
  console.log(
    `  ${f.name.padEnd(4)} ${String(start).padStart(3)} → ${end.toFixed(1).padStart(5)}  (최대 ${peak})`
  );
}
console.log('');

const decided = results.filter((r) => r.kind !== 'timeout');
const avgTurns = decided.length
  ? (decided.reduce((s, r) => s + r.turns, 0) / decided.length).toFixed(1)
  : '-';
console.log(`결착률 ${((decided.length / RUNS) * 100).toFixed(0)}% (${decided.length}/${RUNS})`);
console.log(`평균 결착 턴수 ${avgTurns} (약 ${decided.length ? (Number(avgTurns) / 4).toFixed(1) : '-'}년)`);
console.log(`소요 ${elapsed}초`);

const byKind: Record<string, number> = {};
for (const r of results) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
console.log(
  '승리 유형: ' +
    Object.entries(byKind)
      .map(([k, v]) => `${victoryLabel(k)} ${v}`)
      .join(', ')
);

/* ------------------------------------------------------------------ *
 * 판이 실제로 움직였는가
 *
 * **승률보다 먼저 봐야 하는 두 값이다.** 거점이 안 바뀌면 공성이 여전히
 * 안 되는 것이고, 함락 방식이 한쪽으로 쏠리면 나머지 수단이 사문서다.
 * ------------------------------------------------------------------ */

const flips = results.reduce((a, r) => a + r.flips, 0);
const battles = results.reduce((a, r) => a + r.battles, 0);
const captures = results.reduce((a, r) => a + r.captures, 0);
console.log('');
console.log(`거점 손바뀜  판당 ${(flips / RUNS).toFixed(1)}회 (총 ${flips})`);
console.log(
  `전투         판당 ${(battles / RUNS).toFixed(1)}회, 그중 함락 ${captures}` +
    (battles ? ` (${((captures / battles) * 100).toFixed(0)}%)` : '')
);

const methods: Record<string, number> = {};
for (const r of results) {
  for (const [k, v] of Object.entries(r.methods)) methods[k] = (methods[k] ?? 0) + v;
}
const mTotal = Object.values(methods).reduce((a, b) => a + b, 0);
if (mTotal === 0) {
  console.log('함락 방식     — (한 번도 함락되지 않았다)');
} else {
  console.log(
    '함락 방식     ' +
      ['강공', '포위', '계략', '내응']
        .map((k) => `${k} ${(((methods[k] ?? 0) / mTotal) * 100).toFixed(0)}%`)
        .join(' · ')
  );
}

void factionTroops;
