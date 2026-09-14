/**
 * field/bridge.ts — 전략맵과 전장 사이.
 *
 * 두 층의 말이 다르다. 전략맵은 「군대가 몇 명」으로 말하고 전장은
 * 「누가 몇을 이끄는 부대」로 말한다. 그 통역이 여기 전부 모여 있다.
 * 전장 코어(sim·setup·orders)는 GameState 를 모르고, 전략 코어는
 * FieldState 를 모른다 — 어느 한쪽을 고쳐도 다른 쪽이 흔들리지 않는다.
 *
 * 통역의 요점 하나: **병종은 장수를 따른다** (§1.2). 전략맵에서 무엇을
 * 징병했든, 전장에 서는 부대의 계열은 그 부대를 이끄는 장수의 것이다.
 * 나라가 올린 병종 단계가 그 위에 곱해진다.
 */

import { castleDef, officerDef } from '../data';
import { navalPlan } from '../naval';
import { seedFromString } from '../rng';
import { armyTroops } from '../state';
import type { FactionId, GameState, OfficerId, PendingBattle, Tier, Troop } from '../types';
import { TROOP_LABEL } from '../types';
import { battlefield } from './battlefield';
import { homeRow } from './balance';
import type { FieldEntry, FieldSetup, Row, Side, UnitOrigin } from './types';
import { MAX_UNITS, NO_OFFICER } from './types';

/** 계열이 제자리로 삼는 열 (§4.5). 표는 balance.ts 한 곳에만 둔다 */
const HOME_ROW = (t: Troop): Row => homeRow(t);

/**
 * 거점 유형별 주둔 수비대 구성 (§3.5).
 *
 * **출진 부대의 계열은 장수를 따르지만 주둔군은 아니다.** 주둔군은 그 인물의
 * 사병이 아니라 국가의 병력이다. 이 표가 없으면 문관 하나만 남은 성의
 * 12,000 이 전부 책략계가 되어 기병 6,000 에게 깨진다.
 *
 * 산성에 궁병이 많고 기병이 적은 것은 지형 때문이다(산악에서 기병 -50%).
 * 항구에는 수군이 상비된다 — **거점의 성격이 수비대 구성으로 드러난다.**
 */
const GARRISON: Record<string, Array<{ troop: Troop; navy?: boolean; share: number }>> = {
  capital: [
    { troop: 'inf', share: 0.45 },
    { troop: 'arc', share: 0.3 },
    { troop: 'cav', share: 0.25 },
  ],
  major: [
    { troop: 'inf', share: 0.5 },
    { troop: 'arc', share: 0.3 },
    { troop: 'cav', share: 0.2 },
  ],
  fort: [
    { troop: 'inf', share: 0.45 },
    { troop: 'arc', share: 0.45 },
    { troop: 'cav', share: 0.1 },
  ],
  port: [
    { troop: 'inf', share: 0.4 },
    { troop: 'arc', share: 0.25 },
    { troop: 'cav', share: 0.05 },
    { troop: 'inf', navy: true, share: 0.3 },
  ],
};

/**
 * 주둔 수비대를 부대로 나눈다.
 *
 * 성에 있는 장수를 **계열이 맞는 부대에 먼저** 붙인다. 남는 부대는 지휘관
 * 없이 선다(통솔 40 상당). 「어느 성에 누구를 두는가」가 전략 판단이 되는
 * 자리다 — 양만춘을 안시성에서 빼고 문관을 넣으면 성이 눈에 띄게 물러진다.
 */
function garrisonEntries(castleId: string, troops: number, officers: OfficerId[]): FieldEntry[] {
  const plan = GARRISON[castleDef(castleId).type] ?? GARRISON.major;
  const free = [...officers];
  const out: FieldEntry[] = [];
  const origin: UnitOrigin = { kind: 'garrison', id: castleId };

  for (const part of plan) {
    const n = Math.round(troops * part.share);
    if (n < 200) continue;

    // 계열이 맞는 사람 → 수군이면 naval 인 사람 → 아무나 → 없으면 무지휘
    let pick = free.findIndex((id) => {
      const d = officerDef(id);
      return d.troop === part.troop && (!part.navy || d.naval);
    });
    if (pick < 0 && part.navy) pick = free.findIndex((id) => officerDef(id).naval);
    if (pick < 0) pick = free.length ? 0 : -1;
    const officer = pick >= 0 ? free.splice(pick, 1)[0] : NO_OFFICER;

    out.push({
      officer,
      id: `defender-${castleId}-${out.length}`,
      origin,
      troops: n,
      row: part.navy ? 'front' : HOME_ROW(part.troop),
      reserve: false,
      navy: part.navy,
      troop: part.troop,
      name: officer ? undefined : part.navy ? '수군' : `${TROOP_LABEL[part.troop]} 수비대`,
    });
  }

  /*
   * 구성표에 못 들어간 장수도 성을 지킨다. 남은 병력을 그들에게 나눠 준다 —
   * 이쪽은 자기 계열을 이끌므로 페널티가 없다.
   */
  const used = out.reduce((a, e) => a + e.troops, 0);
  const left = troops - used;
  if (left > 400 && free.length) {
    const each = Math.floor(left / free.length);
    for (const id of free) {
      out.push({
        officer: id,
        id: `defender-${castleId}-${out.length}`,
        origin,
        troops: each,
        row: HOME_ROW(officerDef(id).troop),
        reserve: false,
      });
    }
  }
  return out.filter((e) => e.troops > 0);
}

/** 이 인물의 성장분까지 반영한 능력치 — 전장이 부를 조회 함수 */
export function fieldStats(state: GameState) {
  return (id: string) => {
    /*
     * 지휘관 없는 수비대 (§3.5). 장수가 아예 없어도 주둔군은 존재한다 —
     * 국가의 병력이지 그 인물의 사병이 아니기 때문이다. 통솔 40 상당으로
     * 자동 운용되고, 사기 회복은 없다.
     */
    if (!id) return { lead: 40, war: 40, int: 40 };
    const def = officerDef(id);
    const g = state.officers[id]?.growth ?? {};
    return {
      lead: def.stats.lead + (g.lead ?? 0),
      war: def.stats.war + (g.war ?? 0),
      int: def.stats.int + (g.int ?? 0),
    };
  };
}

function tiersOf(state: GameState, faction: FactionId): Record<Troop, Tier> {
  // 세이브가 예전 것이면 없을 수 있다 — 그때는 1단계로 본다
  return state.factions[faction]?.troopTiers ?? { inf: 1, cav: 1, arc: 1, str: 1 };
}

/**
 * 한 덩이의 병력을 장수들에게 나눈다.
 *
 * 고르게 나누지 않는다. **대장이 본대를 쥔다** — 그래야 대장을 잃으면
 * 전선이 크게 무너지고, 부장을 몇 붙이는 것과 명장 하나를 내는 것이
 * 다른 선택이 된다.
 */
function splitTroops(total: number, officers: OfficerId[], commander?: OfficerId): number[] {
  const n = officers.length;
  if (n === 0) return [];
  const weights = officers.map((id) => (id === commander ? 1.8 : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  // 나머지는 대장에게 — 총합이 어긋나면 전략맵으로 돌아갈 병력이 안 맞는다
  out[0] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

/** 좋은 순으로 12명까지. 대장은 무조건 남는다 */
function pickOfficers(state: GameState, ids: OfficerId[], commander?: OfficerId): OfficerId[] {
  const uniq = [...new Set(ids)].filter((id) => state.officers[id]?.status === 'active');
  if (uniq.length <= MAX_UNITS) return uniq;
  const rest = uniq
    .filter((id) => id !== commander)
    .sort((a, b) => {
      const x = officerDef(a).stats;
      const y = officerDef(b).stats;
      return y.lead + y.war - (x.lead + x.war);
    });
  const head = commander && uniq.includes(commander) ? [commander] : [];
  return [...head, ...rest].slice(0, MAX_UNITS);
}

/**
 * 한 **군대**를 부대들로 나눈다.
 *
 * 군대마다 따로 부르는 것이 요점이다. 예전에는 여러 군대의 장수를 한 풀에
 * 합쳐 총병력을 나눴는데, 그러면 어느 부대가 어느 군대의 것인지가 편성
 * 단계에서 이미 사라져 전투가 끝난 뒤 병력을 제자리로 돌릴 수 없었다.
 */
function entriesFor(
  state: GameState,
  side: Side,
  origin: UnitOrigin,
  officers: OfficerId[],
  total: number,
  commander?: OfficerId,
  navy?: { troops: number; leaders: OfficerId[] }
): FieldEntry[] {
  const out: FieldEntry[] = [];
  let landTotal = total;

  /*
   * 실어 온 수군은 수군으로 선다 (§3.4).
   *
   * 예전에는 출진 부대가 무조건 육상이어서, 배로 상륙을 강행한 군대가
   * 상륙지에서는 물에서 힘을 못 쓰는 보병으로 싸웠다. 이끌 `naval` 장수가
   * 없으면 탑승만 한 것이므로 그대로 육상 부대가 된다.
   */
  if (navy && navy.troops > 0 && navy.leaders.length > 0) {
    /*
     * 장수가 모자라면 큰 쪽을 먼저 세운다. 부대는 장수를 통해서만 존재하므로,
     * 한 사람이 배와 뭍을 동시에 이끌 수는 없다. 수군 장수 하나뿐인 군대가
     * 보병을 더 많이 싣고 왔다면 그 사람은 본대를 이끌고, 배는 탑승으로 남는다.
     */
    const landTroops = total - navy.troops;
    const spare = officers.length - navy.leaders.length;
    const maxLeaders =
      landTroops > 0 && spare <= 0
        ? navy.troops >= landTroops
          ? navy.leaders.length
          : 0
        : navy.leaders.length;
    const leaders = navy.leaders.slice(0, Math.min(maxLeaders, MAX_UNITS));
    const shares = splitTroops(Math.min(navy.troops, total), leaders, commander);
    leaders.forEach((id, i) => {
      const n = Math.max(1, shares[i]);
      landTotal -= n;
      out.push({
        officer: id,
        id: `${side}-${origin.id}-${id}-navy`,
        origin,
        troops: n,
        // 수군은 물에서 앞장선다. 항구 수비대와 같은 자리다.
        row: 'front',
        reserve: false,
        navy: true,
        troop: officerDef(id).troop,
      });
    });
  }

  const used = new Set(out.map((e) => e.officer));
  const rest = officers.filter((id) => !used.has(id));
  if (landTotal > 0 && rest.length > 0) {
    const chosen = pickOfficers(state, rest, used.has(commander ?? '') ? undefined : commander);
    const shares = splitTroops(landTotal, chosen, commander);
    chosen.forEach((id, i) => {
      out.push({
        officer: id,
        id: `${side}-${origin.id}-${id}`,
        origin,
        troops: Math.max(1, shares[i]),
        row: HOME_ROW(officerDef(id).troop),
        reserve: false,
        navy: false,
      });
    });
  } else if (landTotal > 0 && out.length > 0) {
    // 육상을 이끌 사람이 남지 않았다 — 남은 병력은 수군 부대가 함께 싣는다
    out[0].troops += landTotal;
  }
  return out;
}

/** 이 전투에 참여하는 군대들의 편성 (군대별로 나눠서 짠다) */
function armyEntries(state: GameState, side: Side, armyIds: readonly string[]): FieldEntry[] {
  const out: FieldEntry[] = [];
  for (const aid of armyIds) {
    const army = state.armies[aid];
    if (!army) continue;
    const active = army.officers.filter((id) => state.officers[id]?.status === 'active');
    const plan = navalPlan(army.units, active);
    out.push(
      ...entriesFor(
        state,
        side,
        { kind: 'army', id: aid },
        army.officers,
        armyTroops(army),
        army.commander,
        { troops: plan.navyTroops, leaders: plan.leaders }
      )
    );
  }
  return out;
}

/**
 * 여섯 부대가 넘으면 뒤쪽 둘을 예비대로 돌린다.
 *
 * 전부 전선에 세우면 개입할 여지가 없어져 관전이 된다. 예비대가 있어야
 * 「지금 넣을 것인가」라는 물음이 생긴다 (§4.7).
 */
function markReserve(entries: FieldEntry[]): FieldEntry[] {
  if (entries.length < 6) return entries;
  const n = entries.length;
  return entries.map((e, i) => (i >= n - 2 ? { ...e, reserve: true } : e));
}

/**
 * 전투 대기열 항목 → 전장 편성.
 *
 * 거점 id 와 전장 id 는 1:1 이다(battlemaps.json 을 castles.json 에서 냈다).
 * 그래서 어디서 싸우든 그 땅의 실제 지형 위에서 싸운다.
 */
export function buildFieldSetup(state: GameState, pending: PendingBattle): FieldSetup {
  const castle = state.castles[pending.castle];

  const attackerEntries = armyEntries(state, 'attacker', pending.attackerArmies);
  const defenderEntries = armyEntries(state, 'defender', pending.defenderArmies);

  // 성 안의 주둔군은 **따로** 짠다 — 야전 부대와 계열 규칙이 다르다 (§3.5)
  const holdsCastle = pending.siege && castle.owner === pending.defender;
  const garrison = holdsCastle
    ? garrisonEntries(
        pending.castle,
        castle.troops,
        castle.officers.filter((id) => state.officers[id]?.status === 'active')
      )
    : [];

  /*
   * 성의 값 (§6.2). 성곽 개발도가 성벽 HP 를, 비축 병량이 농성 기간을 정한다.
   * 수비 총대장의 매력·성향은 내응 성공률에 쓴다 (§6.3-④) — **야심가가
   * 지키는 성은 정면으로 깨는 것보다 사서 여는 쪽이 싸다.**
   */
  const warden = castle.officers[0] ? officerDef(castle.officers[0]) : null;

  return {
    fieldId: pending.castle,
    // 같은 판을 다시 돌리면 같은 결과가 나와야 한다 — 시각이 아니라 판에서 낸다
    seed: seedFromString(`${pending.id}:${state.turn}:${state.rng}`),
    season: state.season as 0 | 1 | 2 | 3,
    siege: pending.siege,
    playerSide: state.spectator
      ? null
      : pending.attacker === state.playerFaction
        ? 'attacker'
        : pending.defender === state.playerFaction
          ? 'defender'
          : null,
    attackerFaction: pending.attacker,
    defenderFaction: pending.defender,
    tiers: {
      attacker: tiersOf(state, pending.attacker),
      defender: tiersOf(state, pending.defender),
    },
    wallDev: castle.dev.wall,
    grain: castle.stock,
    wardenChr: warden?.stats.chr ?? 50,
    wardenTrait: warden?.loyalty_type ?? null,
    /*
     * 양쪽 모두 12부대 상한을 받는다 — 예전에는 공격 측에 상한이 없어
     * 여러 군대가 모이면 판에 13부대 이상이 섰다.
     *
     * 예비대는 **출진 부대에만** 표시한다. 주둔 수비대를 예비로 돌리면
     * 아무도 투입 명령을 내리지 않는 자동 전투에서 그 병력이 영영 싸우지
     * 않는다 — 성을 지키러 있는 병력이다.
     */
    attacker: capUnits(markReserve(attackerEntries)),
    defender: capUnits([...markReserve(defenderEntries), ...garrison]),
  };
}

/**
 * 한쪽 12부대를 넘지 않게 추린다. 넘치면 작은 부대들을 큰 쪽에 합친다 —
 * 잘라 내면 그 병력이 전략맵에서 증발한다.
 *
 * **합치는 상대를 아무나 고르지 않는다.** 같은 출처(같은 군대·같은 성)이고
 * 수군 여부가 같은 부대끼리 먼저 합친다. 그래야 병력이 남의 군대로 건너가지
 * 않고, 수군 병력이 육상 부대에 섞이지 않는다. 출처가 12가지를 넘는
 * 드문 경우에만 가장 큰 부대에 얹는다(총합은 그래도 보존된다 — 다만 그
 * 병력의 소속은 큰 쪽을 따라간다).
 *
 * 합쳐진 부대의 장수는 판에 서지 않으므로 포로가 되지 않는다.
 */
function capUnits(entries: FieldEntry[]): FieldEntry[] {
  if (entries.length <= MAX_UNITS) return entries;
  const key = (e: FieldEntry) => `${e.origin ? `${e.origin.kind}:${e.origin.id}` : '-'}|${e.navy ? 'n' : 'l'}`;
  const sorted = [...entries].sort((a, b) => b.troops - a.troops);
  const keep = sorted.slice(0, MAX_UNITS);
  for (const e of sorted.slice(MAX_UNITS)) {
    const same = keep.find((k) => key(k) === key(e));
    (same ?? keep[0]).troops += e.troops;
  }
  return keep;
}

/**
 * 전투가 성립하는가.
 *
 * 한쪽에 이끌 사람이 아무도 없으면 전장을 열 수 없다 — 부대는 장수를 통해서만
 * 존재한다. 그런 경우는 전략맵에서 「싸움 없이」 처리해야 한다.
 */
export function fieldPossible(setup: FieldSetup): boolean {
  return setup.attacker.length > 0 && setup.defender.length > 0;
}

/** 전장이 실제로 있는가 (거점 id 로 찾는다) */
export function hasBattlefield(castleId: string): boolean {
  try {
    battlefield(castleId);
    return true;
  } catch {
    return false;
  }
}
