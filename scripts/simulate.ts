/**
 * simulate.ts — 헤드리스 자동 시뮬레이션 (시스템 상세계획 §7)
 *
 * 관전자 실행이다 — 맡은 세력 없이 전 세력을 AI 로 돌린다. 예전에는
 * `playerFaction` 이 남아 있어 그 세력이 멸망하면 다른 두 나라가 아직
 * 싸우는 중에도 판이 끝났고, 그 판이 「결착」으로 집계됐다.
 *
 * 집계는 `state.events`(구조화 사건)만 본다. 화면 로그는 600개에서 잘리므로
 * 거기서 세면 판이 길어질수록 조용히 틀어진다.
 *
 * **시간 초과 우세는 승리가 아니다.** 두 값을 다른 자리에 담는다.
 *
 * 실행:
 *   npm run simulate                                  # 기본 30회, s642, 160턴
 *   npm run simulate -- 100 s551 200                  # 옛 위치 인자도 받는다
 *   npm run simulate -- --runs 200 --scenario s642 --max-turns 160 \
 *                       --events on --victory hegemony --out out.json
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { PLAYABLE_FACTIONS, factionName, scenarioDef } from '../src/core/data';
import { pickAIChoice } from '../src/core/events';
import { RngCursor } from '../src/core/rng';
import { createGame } from '../src/core/state';
import { METHOD_LABEL, summarizeRun, type RunSummary } from '../src/core/stats';
import { beginNextTurn, completeEvent, resolveTurn } from '../src/core/turn';
import { victoryLabel } from '../src/core/victory';
import type { CaptureMethod, FactionId, GameState } from '../src/core/types';

/* ------------------------------- 인자 ------------------------------- */

interface Options {
  runs: number;
  scenario: string;
  maxTurns: number;
  historicalEvents: boolean;
  victory: 'hegemony' | 'unification';
  out: string | null;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    runs: 30,
    scenario: 's642',
    maxTurns: 160,
    historicalEvents: true,
    victory: 'hegemony',
    out: null,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const v = argv[++i];
    switch (a) {
      case '--runs':
        o.runs = Number(v);
        break;
      case '--scenario':
        o.scenario = v;
        break;
      case '--max-turns':
        o.maxTurns = Number(v);
        break;
      case '--events':
        o.historicalEvents = v !== 'off';
        break;
      case '--victory':
        o.victory = v === 'unification' ? 'unification' : 'hegemony';
        break;
      case '--out':
        o.out = v;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  // 옛 호출 방식: runs scenario maxTurns
  if (positional[0]) o.runs = Number(positional[0]);
  if (positional[1]) o.scenario = positional[1];
  if (positional[2]) o.maxTurns = Number(positional[2]);
  return o;
}

const OPT = parseArgs(process.argv.slice(2));

/** 고정 시드 묶음 — 변경 전후를 같은 판으로 비교하기 위한 것이다. */
function seedOf(i: number): number {
  return 0x1000 + i * 7919;
}

function runOne(seed: number): RunSummary {
  const scenario = scenarioDef(OPT.scenario);
  const factions = Object.keys(scenario.ownership);
  const state: GameState = createGame({
    scenarioId: OPT.scenario,
    // 관전자 실행 — 맡은 세력이 없다. 이 값은 시나리오 조회의 기준으로만 남는다.
    playerFaction: factions[0],
    spectator: true,
    options: {
      autoBattle: true,
      historicalEvents: OPT.historicalEvents,
      victory: OPT.victory,
    },
    seed,
  });

  /*
   * 이벤트 선택도 상태의 난수를 쓴다. 예전에는 playerFaction 세력의 선택만
   * 시뮬레이터가 따로 만든 난수로 처리해, 그 세력만 통계적으로 달랐다.
   * 관전자 실행에서는 turn.ts 가 전 세력을 같은 경로로 처리하므로
   * 이 커서는 안전장치로만 남는다.
   */
  const rng = new RngCursor(seed ^ 0x5f3759df);

  let guard = 0;
  while (!state.result && state.turn <= OPT.maxTurns) {
    for (;;) {
      const step = resolveTurn(state);
      if (step.kind === 'event') {
        completeEvent(state, pickAIChoice(state, step.pending, rng));
        continue;
      }
      if (step.kind === 'battle') {
        // autoBattle 이 켜져 있고 관전자이므로 여기 올 일이 없다. 안전장치.
        state.pendingBattles.shift();
        continue;
      }
      break;
    }
    if (state.result) break;
    beginNextTurn(state);
    if (guard++ > 10000) break;
  }

  return summarizeRun(state, factions);
}

/* --------------------------------- 실행 --------------------------------- */

function commitHash(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '(git 없음)';
  }
}

const scenario = scenarioDef(OPT.scenario);
const factions = Object.keys(scenario.ownership);
const playable = PLAYABLE_FACTIONS.filter((f) => scenario.ownership[f.id]?.length);
const commit = commitHash();

console.log(
  `시뮬레이션: ${scenario.name} (${scenario.startYear}년) × ${OPT.runs}회, 최대 ${OPT.maxTurns}턴`
);
console.log(
  `조건: 역사 이벤트 ${OPT.historicalEvents ? '켬' : '끔'} · 자동 전투 · 승리 조건 ${
    OPT.victory === 'hegemony' ? '패권' : '통일'
  } · 시드 0x1000+7919i · 커밋 ${commit.slice(0, 7)}\n`
);

const results: RunSummary[] = [];
const started = Date.now();

for (let i = 0; i < OPT.runs; i++) {
  const r = runOne(seedOf(i));
  results.push(r);
  const tag =
    r.outcome === 'victory'
      ? `${factionName(r.winner!)} ${victoryLabel(r.kind)}`
      : r.tie
        ? '시간 초과 (동률)'
        : `시간 초과 — ${factionName(r.leader!)} 우세`;
  process.stdout.write(`\r  진행 ${i + 1}/${OPT.runs} — 최근: ${tag} (${r.endYear}년)          `);
}
process.stdout.write('\n\n');

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const RUNS = results.length;

/* --- 자체 검사 — 집계가 서로 안 맞으면 수치를 믿을 수 없다 --- */
const problems: string[] = [];
const victories = results.filter((r) => r.outcome === 'victory').length;
const timeouts = results.filter((r) => r.outcome === 'timeout').length;
if (victories + timeouts !== RUNS) problems.push('승리 + 시간 초과 ≠ 표본 수');
for (const r of results) {
  const mSum = Object.values(r.methods).reduce((a, b) => a + b, 0);
  if (mSum !== r.captures) problems.push('함락 방식 합계가 함락 수와 다름');
  if (r.outcome === 'timeout' && !r.tie && !r.leader) problems.push('시간 초과인데 우세도 동률도 아님');
}

/* --- 세력별 결과 --- */
const realWins: Record<FactionId, number> = {};
const winKinds: Record<FactionId, Record<string, number>> = {};
const leads: Record<FactionId, number> = {};
for (const f of factions) {
  realWins[f] = 0;
  leads[f] = 0;
  winKinds[f] = {};
}
let ties = 0;
for (const r of results) {
  if (r.outcome === 'victory' && r.winner) {
    realWins[r.winner] = (realWins[r.winner] ?? 0) + 1;
    winKinds[r.winner][r.kind] = (winKinds[r.winner][r.kind] ?? 0) + 1;
  } else if (r.tie) ties++;
  else if (r.leader) leads[r.leader] = (leads[r.leader] ?? 0) + 1;
}

console.log('세력별 결과 — 실제 승리와 시간 초과 우세는 다른 값이다');
console.log('─'.repeat(72));
console.log('  세력   실제 승리        (유형)                시간 초과 우세');
for (const f of playable) {
  const w = realWins[f.id] ?? 0;
  const kinds =
    Object.entries(winKinds[f.id] ?? {})
      .map(([k, v]) => `${victoryLabel(k)} ${v}`)
      .join(', ') || '—';
  const lead = leads[f.id] ?? 0;
  console.log(
    `  ${f.name.padEnd(4)} ${((w / RUNS) * 100).toFixed(1).padStart(5)}% (${String(w).padStart(3)}판)  ` +
      `${kinds.padEnd(22)} ${((lead / RUNS) * 100).toFixed(1).padStart(5)}% (${String(lead).padStart(3)}판)`
  );
}
console.log('─'.repeat(72));
console.log(`  동률(우세 없음) ${ties}판 · 표본 ${RUNS}판`);

/* --- 종료 턴 분포 --- */
console.log('\n결착 (제한 턴 안에 승리 조건이 난 판)');
console.log(`  결착률 ${((victories / RUNS) * 100).toFixed(1)}% (${victories}/${RUNS})`);
if (victories > 0) {
  const turns = results
    .filter((r) => r.outcome === 'victory')
    .map((r) => r.endTurn)
    .sort((a, b) => a - b);
  const median = turns[Math.floor(turns.length / 2)];
  const mean = turns.reduce((a, b) => a + b, 0) / turns.length;
  console.log(
    `  결착 턴 중앙값 ${median} (약 ${(median / 4).toFixed(1)}년) · 평균 ${mean.toFixed(1)} · 최소 ${turns[0]} · 최대 ${turns[turns.length - 1]}`
  );
  const buckets = [40, 80, 120, 160];
  const hist = buckets.map((b, i) => {
    const lo = i === 0 ? 0 : buckets[i - 1];
    return `${lo + 1}~${b}턴 ${turns.filter((t) => t > lo && t <= b).length}`;
  });
  console.log(`  종료 턴 분포 (결착판 ${turns.length}) — ${hist.join(' · ')}`);
}

/* --- 판이 실제로 움직였는가 --- */
console.log('\n시작 → 평균 최종 거점');
for (const f of playable) {
  const start = scenario.ownership[f.id]?.length ?? 0;
  const end = results.reduce((s, r) => s + (r.finalCastles[f.id] ?? 0), 0) / RUNS;
  const peak = Math.max(...results.map((r) => r.finalCastles[f.id] ?? 0));
  console.log(
    `  ${f.name.padEnd(4)} ${String(start).padStart(3)} → ${end.toFixed(1).padStart(5)}  (최대 ${peak})`
  );
}

const flips = results.reduce((a, r) => a + r.flips, 0);
const battles = results.reduce((a, r) => a + r.battles, 0);
const captures = results.reduce((a, r) => a + r.captures, 0);
const eliminations = results.reduce((a, r) => a + r.eliminated.length, 0);
console.log('');
console.log(`거점 손바뀜  판당 ${(flips / RUNS).toFixed(1)}회 (총 ${flips})`);
console.log(
  `전투         판당 ${(battles / RUNS).toFixed(1)}회 (총 ${battles}), 함락 ${captures}` +
    (battles ? ` (전투 대비 ${((captures / battles) * 100).toFixed(0)}%)` : '')
);
console.log(`멸망         총 ${eliminations}건`);

const methods: Record<string, number> = {};
for (const r of results) {
  for (const [k, v] of Object.entries(r.methods)) methods[k] = (methods[k] ?? 0) + v;
}
const mTotal = Object.values(methods).reduce((a, b) => a + b, 0);
if (mTotal === 0) {
  console.log('함락 방식     — (한 번도 함락되지 않았다)');
} else {
  const keys = Object.keys(METHOD_LABEL) as CaptureMethod[];
  console.log(`함락 방식 (표본 ${mTotal}건)`);
  for (const k of keys) {
    const n = methods[k] ?? 0;
    if (n === 0) continue;
    console.log(`  ${METHOD_LABEL[k].padEnd(10)} ${((n / mTotal) * 100).toFixed(1).padStart(5)}% (${n})`);
  }
  const zero = keys.filter((k) => (methods[k] ?? 0) === 0).map((k) => METHOD_LABEL[k]);
  if (zero.length) console.log(`  한 번도 안 쓰인 수단: ${zero.join(' · ')}`);
}

console.log(`\n소요 ${elapsed}초`);
if (problems.length) {
  console.log('\n집계 자체 검사 실패:');
  for (const p of [...new Set(problems)]) console.log(`  ✗ ${p}`);
} else {
  console.log('집계 자체 검사 통과 (승리+시간초과=표본, 함락 방식 합=함락 수)');
}

if (OPT.out) {
  mkdirSync(dirname(OPT.out), { recursive: true });
  writeFileSync(
    OPT.out,
    JSON.stringify(
      {
        commit,
        scenario: OPT.scenario,
        startYear: scenario.startYear,
        runs: RUNS,
        maxTurns: OPT.maxTurns,
        historicalEvents: OPT.historicalEvents,
        victory: OPT.victory,
        autoBattle: true,
        spectator: true,
        seedRule: '0x1000 + i * 7919',
        elapsedSec: Number(elapsed),
        selfCheck: problems.length === 0 ? 'pass' : [...new Set(problems)],
        results,
      },
      null,
      2
    )
  );
  console.log(`결과를 ${OPT.out} 에 적었다.`);
}
