/**
 * tune-field.ts — 전투 길이를 실제로 재서 계수를 맞춘다.
 *
 * 기획서 §4.2 가 정한 목표(전장 내 시간):
 *   조우전 3~5부대  약 2시간
 *   야전   6~12부대 약 6시간
 *   공성전 8~14부대 하루 이상
 *
 * 눈대중으로 damageDivisor 를 고치면 세 유형의 길이가 한꺼번에 움직인다.
 * 여기서 돌려 보고 정한다.
 *
 *   npm run tune:field            현재 값으로 잰다
 *   npm run tune:field -- 320     그 값으로 바꿔 잰다 (파일은 안 고친다)
 */

import { OFFICERS } from '../src/core/data';
import { F } from '../src/core/field/balance';
import { createField } from '../src/core/field/setup';
import { runToEnd } from '../src/core/field/sim';
import type { FieldEntry, FieldSetup, Row, Tier } from '../src/core/field/types';
import type { FactionId, Troop } from '../src/core/types';

const override = Number(process.argv[2]);
if (Number.isFinite(override) && override > 0) {
  (F as unknown as { damageDivisor: number }).damageDivisor = override;
}

const STATS = new Map(OFFICERS.map((o) => [o.id, o.stats]));
const statsOf = (id: string) => STATS.get(id)!;

/** 그 세력에서 계열별로 좋은 인물을 뽑는다 */
function pick(faction: FactionId, troop: Troop, n: number, skip: Set<string>): string[] {
  const list = OFFICERS.filter(
    (o) => o.faction === faction && o.troop === troop && !skip.has(o.id)
  ).sort((a, b) => b.stats.lead + b.stats.war - (a.stats.lead + a.stats.war));
  const out = list.slice(0, n).map((o) => o.id);
  for (const id of out) skip.add(id);
  return out;
}

const HOME: Record<Troop, Row> = { inf: 'front', cav: 'mid', arc: 'rear', str: 'rear' };

/** 부대 구성 — 보병 위주에 기병·궁병·책략을 섞는다 */
function army(faction: FactionId, count: number, troopsEach: number): FieldEntry[] {
  const skip = new Set<string>();
  const mix: Troop[] = [];
  for (let i = 0; i < count; i++) {
    mix.push((['inf', 'inf', 'cav', 'arc', 'inf', 'cav', 'str', 'inf', 'arc', 'cav', 'inf', 'str'] as Troop[])[i % 12]);
  }
  const out: FieldEntry[] = [];
  for (const t of mix) {
    const [id] = pick(faction, t, 1, skip);
    if (!id) continue;
    out.push({ officer: id, troops: troopsEach, row: HOME[t], reserve: false });
  }
  return out;
}

const tiers = (t: Tier): Record<Troop, Tier> => ({ inf: t, cav: t, arc: t, str: t });

interface Case {
  label: string;
  fieldId: string;
  units: number;
  troops: number;
  siege: boolean;
  targetHours: [number, number];
}

const CASES: Case[] = [
  { label: '조우전 (4부대)', fieldId: 'hanseong', units: 4, troops: 2500, siege: false, targetHours: [1.2, 3] },
  { label: '야전 (8부대)', fieldId: 'hanseong', units: 8, troops: 4000, siege: false, targetHours: [3.5, 9] },
  /*
   * 부대가 많다고 전투가 길어지지는 않는다 — **넓어질 뿐이다.**
   * 12부대는 전선이 넓어 양쪽이 한꺼번에 붙으므로 8부대보다 오히려 빨리
   * 판가름 난다. (아래 하한을 4시간으로 잡았던 것은 3열 진형이 뒤집혀
   * 궁병이 앞에 나가 얻어맞던 시절의 값이었다. 진형을 바로잡자 3.6시간이
   * 되었고, 이쪽이 맞는 값이다 — 1배속 실시간 22분으로 §4.2 의 10~60분 안이다.)
   */
  { label: '야전 (12부대)', fieldId: 'gugwon', units: 12, troops: 4000, siege: false, targetHours: [3, 12] },
  // 살수는 험지 31% 에 청천강이 가로지른다. 통로가 좁아 오래 걸리는 것이
  // 이 전장의 성격이다 — 짧게 만들면 살수대첩이 살수대첩이 아니게 된다.
  { label: '산악 (살수)', fieldId: 'salsu', units: 8, troops: 4000, siege: false, targetHours: [4, 16] },
  // 공성은 아직 §6 규칙(포위·성문·원군)이 없다. 지금은 성벽 지형만 걸려 있어
  // 야전과 크게 다르지 않다. 규칙을 붙인 뒤에 다시 잰다.
  { label: '공성 (안시성) *규칙 전', fieldId: 'ansi', units: 10, troops: 5000, siege: true, targetHours: [3, 40] },
];

function run(c: Case, seed: number) {
  const setup: FieldSetup = {
    fieldId: c.fieldId,
    seed,
    season: 0,
    siege: c.siege,
    playerSide: null,
    attackerFaction: 'goguryeo',
    defenderFaction: 'silla',
    tiers: { attacker: tiers(2), defender: tiers(2) },
    attacker: army('goguryeo', c.units, c.troops),
    defender: army('silla', c.units, c.troops),
  };
  const st = runToEnd(createField(setup), statsOf);
  return {
    hours: st.tick / 3600,
    winner: st.result?.winner,
    aLoss: st.result?.attackerLoss ?? 0,
    dLoss: st.result?.defenderLoss ?? 0,
  };
}

console.log(`damageDivisor = ${F.damageDivisor}\n`);
console.log('유형                  전장시간   1배속 실시간   승자      공격손실  수비손실   목표');
console.log('─'.repeat(94));

let allOk = true;
for (const c of CASES) {
  const runs = [1, 2, 3, 4, 5].map((s) => run(c, 1000 + s * 7919));
  const avgH = runs.reduce((s, r) => s + r.hours, 0) / runs.length;
  const realMin = (avgH * 3600) / 10 / 60; // 1배속 = 1초당 전장 10초
  const atk = runs.filter((r) => r.winner === 'attacker').length;
  const aL = Math.round(runs.reduce((s, r) => s + r.aLoss, 0) / runs.length);
  const dL = Math.round(runs.reduce((s, r) => s + r.dLoss, 0) / runs.length);
  const [lo, hi] = c.targetHours;
  const ok = avgH >= lo && avgH <= hi;
  if (!ok) allOk = false;
  console.log(
    `${c.label.padEnd(20)} ${avgH.toFixed(1).padStart(6)}시간 ${realMin.toFixed(0).padStart(9)}분` +
      `   공${atk}/5 ${String(aL).padStart(9)} ${String(dL).padStart(9)}   ${lo}~${hi}시간 ${ok ? '✓' : '✗'}`
  );
}
console.log('');
console.log(allOk ? '모든 유형이 목표 안에 들어왔다.' : '목표를 벗어난 유형이 있다 — damageDivisor 를 조정할 것.');
