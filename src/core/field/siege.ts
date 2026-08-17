/**
 * field/siege.ts — 공성전 (기획서 §6).
 *
 * **공성전은 성벽을 낀 야전이 아니다.**
 *
 * 수비 보정만 얹은 야전으로 처리하면 두 가지가 동시에 깨진다 — 성이 함락되지
 * 않아 게임이 끝나지 않고(실제로 결착률 0% 였다), 농성이라는 전술이 사라진다.
 * 그래서 판정 구조 자체가 다르다.
 *
 *   야전:   부대가 접촉하면 싸운다 → 적 부대를 깨면 이긴다
 *   공성전: **성문·성벽을 돌파해야** 싸운다 → 입성하거나 항복받아야 이긴다
 *
 * 즉 공성전의 물음은 「누가 더 센가」가 아니라 **「어떻게 들어갈 것인가」**다.
 * 들어가는 길이 넷이다 — 강공·포위·계략·내응(§6.3).
 */

import type { RngCursor } from '../rng';
import { TERRAIN } from './balance';
import { tileSize } from './battlefield';
import type { Battlefield, FieldState, FieldUnit, TerrainCode } from './types';

/* ------------------------------------------------------------------ *
 * 조절 다이얼 (§6.7)
 *
 * **결착률이 안 나오면 여기부터 만진다.** 밸런싱할 때 이 파일만 열면 되도록
 * 다섯 값을 한 덩어리로 모아 둔다. 다른 곳에 흩어 놓지 말 것.
 * ------------------------------------------------------------------ */

export const SIEGE = {
  /** 성벽 HP = 성곽 개발도 × 이 값 (안시성 100 → 12,000) */
  wallHpPerDev: 120,
  /** 성문 HP = 성벽 HP × 이 값. **성문이 약점이다** */
  gateHpRatio: 0.35,
  /** 포위 시 라운드당 병량 감소 = 주둔 병력 × 이 값 × 지형계수 */
  starveRate: 0.004,
  /** 내응 기본 성공률 */
  infiltrateBase: 0.25,
  /** 제한 라운드. 초과하면 공격 실패로 물러난다 */
  maxRounds: 90,

  /* --- 아래는 다이얼이 아니라 규칙 상수다 --- */

  /** 한 라운드의 전장 시간(초). 90라운드 = 30시간 = 하루 이상 */
  roundSeconds: 1200,
  /** 성문을 두드릴 수 있는 거리(m) */
  gateReach: 260,
  /**
   * 성문에 주는 **틱당**(전장 1초) 피해 = 병력 × 이 값 × 단계.
   *
   * 틱이 1초라는 것을 잊고 0.0016 으로 두었더니, 5,000명 세 부대가 안시성
   * 성문(3,990)을 **1분 30초**만에 부수었다. 「하루 이상」이 목표인데
   * 성문이 야전 한 합보다 빨리 깨졌다.
   *
   * 지금 값이면 2단계 보병 세 부대가 대략 여덟 시간 두드려야 문이 열린다.
   * 공성병기(4단계)를 끌고 오면 세 시간이다 — 그것이 정석인 이유다.
   */
  ramRate: 0.000005,
  /** 공성병기(보병 4단계)면 성문 피해가 이만큼 곱해진다 */
  ramEngineBonus: 2.6,
  /** 보병계가 아닌 부대가 성문을 두드릴 때 */
  ramOffClass: 0.35,
  /** 성벽을 넘는 중에 받는 피해 배율 (§6.2 — 등반은 비싸다) */
  climbPenalty: 3.0,
  /** 등반으로 성벽을 깎는 속도. 성벽은 성문의 세 배 두께이고 더 느리다 */
  climbRate: 0.0000012,
  /** 병량이 0 인 채 한 라운드가 지나면 사기가 이만큼 떨어진다 */
  starveMorale: 8,
  /** 이 사기 아래면 항복 판정에 들어간다 */
  surrenderMorale: 30,
  /** 시가전으로 넘어가면 수비 보정이 +50% → +15% 로 준다 (§6.4) */
  streetDefense: 1.15,
  /** 시가전에서 항복하는 사기 */
  streetSurrenderMorale: 20,

  /* ------------------------------------------------------------------ *
   * §7.7 성곽 구조물 다이얼
   *
   * 기획서가 「§6.7 상수 파일에 합칠 것」이라 했으므로 여기 둔다. 지금은
   * **맵 데이터에만** 반영돼 있고(치·옹성·해자 타일이 실제로 깔렸다),
   * 이 계수를 읽는 전투 로직은 다음 단계다. 값을 미리 못 박아 두는 이유는
   * 밸런싱할 때 찾아다니지 않게 하려는 것이다.
   * ------------------------------------------------------------------ */

  /** 해자에 발을 들인 그 라운드의 방어 감소 */
  moatDefPenalty: -0.3,
  /** 치에서 쏠 때 측면 판정 보정 */
  chiFlankBonus: 0.25,
  /** 옹성벽 HP = 성벽 HP × 이 값 */
  ongseongHpRatio: 0.6,
  /** 계곡수를 가진 성의 포위 완화 — 굶기기가 이만큼 더디다 */
  waterSourceSiegeRelief: 0.25,
  /** 구릉 방어 (TERRAIN.h 와 같은 값을 다이얼로도 적어 둔다) */
  hillDefBonus: 0.1,
  /** 외성이 떨어질 때 내성으로 물릴 수 있는 병력 비율 */
  innerRetreatRatio: 0.7,
  /** 쌍성에서 한쪽이 떨어져 다른 성으로 물러날 때 받는 추격 피해 */
  twinRetreatDamage: 0.15,
} as const;

/** 성이 함락된 방식. 재측정에서 분포를 본다 — 한쪽으로 쏠리면 나머지가 사문서다 */
export type SiegeMethod = 'assault' | 'encircle' | 'scheme' | 'infiltrate';

/** 수비 총대장의 성향 — 내응 성공률을 가른다 */
export type SiegeTrait = 'loyal' | 'ambitious' | 'mercenary' | null;

/** 전장 밖에서 온 값들. 매 틱 다시 캐지 않으려고 판에 붙여 둔다 */
export interface SiegeContext {
  wardenChr: number;
  wardenTrait: SiegeTrait;
  /** 강을 낀 성인가 — 수공의 조건 */
  riverside: boolean;
}

/** 공격 측이 지금 무엇을 하고 있는가 (§6.3) */
export type SiegeMode = 'assault' | 'encircle';

export interface SiegeState {
  wallHp: number;
  wallMax: number;
  gateHp: number;
  gateMax: number;
  /** 성문이 깨졌거나 성벽을 넘었다 — 여기서부터 시가전 */
  breached: boolean;
  breachTick: number | null;
  /** 수비 측 병량 */
  grain: number;
  grainMax: number;
  /** 산악이면 1.4 — 안시성을 말려 죽일 수 있는 이유 (§5.2) */
  terrainToll: number;
  mode: SiegeMode;
  /** 내응은 한 번뿐이다 */
  infiltrated: boolean;
  surrendered: boolean;
  /** 화공이 든 뒤라야 소성을 쓸 수 있다 */
  burned: boolean;
  method: SiegeMethod | null;
  /** 마지막으로 병량을 정산한 라운드 */
  lastRound: number;
  /** 마지막으로 항복을 물은 라운드 */
  lastSurrenderCheck: number;
}

/* ------------------------------------------------------------------ *
 * 성 안과 밖
 * ------------------------------------------------------------------ */

/**
 * 성벽 안쪽 타일 표.
 *
 * 바깥 테두리에서 성벽이 아닌 곳을 타고 물을 부어 본다. 물이 안 닿았고
 * 성벽도 아닌 칸이 **성 안**이다. 성벽을 「가운데 근처」로 어림잡으면
 * 성문 앞 공터까지 성 안이 되어 버린다.
 */
const insideCache = new Map<string, Uint8Array>();

export function insideWallGrid(f: Battlefield): Uint8Array {
  const hit = insideCache.get(f.id);
  if (hit) return hit;

  const w = f.w;
  const h = f.h;
  const outside = new Uint8Array(w * h);
  /*
   * 치(T)·옹성벽(O)도 성벽이다 (§7.1). 이 둘을 빼고 물을 부으면 옹성 안쪽이
   * 「성 밖」으로 잡혀, 성문 앞 옹성 주머니에서 근접 교전이 성립해 버린다.
   */
  const isWall = (x: number, y: number) => {
    const c = f.tiles[y][x] as TerrainCode;
    return c === 'W' || c === 'G' || c === 'T' || c === 'O';
  };

  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (outside[i] || isWall(x, y)) return;
    outside[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) {
    const x = i % w;
    const y = (i - x) / w;
    inside[i] = !outside[i] && !isWall(x, y) ? 1 : 0;
  }
  insideCache.set(f.id, inside);
  return inside;
}

/** 이 지점(m)이 성 안인가 */
export function insideWall(f: Battlefield, x: number, y: number): boolean {
  const [tw, th] = tileSize(f);
  const tx = Math.floor(x / tw);
  const ty = Math.floor(y / th);
  if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return false;
  return insideWallGrid(f)[ty * f.w + tx] === 1;
}

/**
 * 성문 자리(m). 여럿이면 공격군이 먼저 닿는 문.
 *
 * **판에 캐시해 둔다.** 매 틱 48×32 를 훑던 탓에 부대 스무 개가 십만 틱을
 * 도는 공성전 한 판에서 30억 번 타일을 읽었다 — 시뮬레이션이 서른 배 느려졌다.
 * 성문은 전투 중에 움직이지 않는다.
 */
export function gatePoint(st: FieldState): { x: number; y: number } | null {
  if (st.gateAt !== undefined) return st.gateAt;
  const at = findGate(st);
  st.gateAt = at;
  return at;
}

function findGate(st: FieldState): { x: number; y: number } | null {
  const f = st.field;
  const [tw, th] = tileSize(f);
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  for (let ty = 0; ty < f.h; ty++) {
    for (let tx = 0; tx < f.w; tx++) {
      if (f.tiles[ty][tx] !== 'G') continue;
      const x = (tx + 0.5) * tw;
      const y = (ty + 0.5) * th;
      // 공격 방향의 반대쪽에 있는 성문일수록 좋다 (공격군이 먼저 닿는 문)
      const score = -(x * st.axis.dx + y * st.axis.dy);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * 준비
 * ------------------------------------------------------------------ */

export function createSiegeState(
  wallDev: number,
  grain: number,
  mountainous: boolean
): SiegeState {
  const wallMax = Math.max(600, Math.round(wallDev * SIEGE.wallHpPerDev));
  const gateMax = Math.round(wallMax * SIEGE.gateHpRatio);
  return {
    wallHp: wallMax,
    wallMax,
    gateHp: gateMax,
    gateMax,
    breached: false,
    breachTick: null,
    grain: Math.max(0, grain),
    grainMax: Math.max(1, grain),
    // 산에서 버티면 병량이 먼저 마른다 (§5.2)
    terrainToll: mountainous ? TERRAIN.m.toll : 1,
    mode: 'assault',
    infiltrated: false,
    surrendered: false,
    burned: false,
    method: null,
    lastRound: 0,
    lastSurrenderCheck: 0,
  };
}

/* ------------------------------------------------------------------ *
 * 매 틱
 * ------------------------------------------------------------------ */

function note(st: FieldState, text: string, big = false) {
  st.log.push({ tick: st.tick, text, big });
  if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
}

function breach(st: FieldState, s: SiegeState, how: SiegeMethod, text: string) {
  if (s.breached) return;
  s.breached = true;
  s.breachTick = st.tick;
  s.method = how;
  note(st, text, true);
  note(st, '── 시가전 ──', true);
  // 성이 뚫리면 지키던 쪽의 사기가 크게 꺾인다
  for (const u of st.units) if (u.side === 'defender' && !u.dead) u.morale -= 20;
}

/**
 * 공성전의 한 틱.
 *
 * 야전 판정 앞에 끼워 넣는다. 여기서 성문이 깎이고 병량이 마르고 항복이 난다.
 */
export function stepSiege(st: FieldState, s: SiegeState, rng: RngCursor): void {
  if (s.surrendered) return;
  const gate = gatePoint(st);

  /*
   * 사람이 공격을 안 잡았으면 AI 가 고른다. 라운드가 바뀌는 순간에만 —
   * 매 틱 판단하면 같은 결정을 만 번 되풀이한다.
   */
  if (st.playerSide !== 'attacker' && st.tick % SIEGE.roundSeconds === 0) {
    siegeAI(st, s, rng, st.siegeCtx);
  }

  /* --- ① 강공 — 성문을 두드린다 (§6.3-①) --- */
  if (!s.breached && s.mode === 'assault') {
    for (const u of st.units) {
      if (u.side !== 'attacker' || u.dead || u.reserve || u.routed) continue;
      if (u.arriveTick > st.tick) continue;

      const atGate = gate && Math.hypot(u.x - gate.x, u.y - gate.y) <= SIEGE.gateReach;
      if (atGate) {
        // 보병 4단계는 공성병기를 낸다. 그것이 정석이다
        const engine = u.troop === 'inf' && u.tier >= 4 ? SIEGE.ramEngineBonus : 1;
        const cls = u.troop === 'inf' ? 1 : SIEGE.ramOffClass;
        s.gateHp -= u.troops * SIEGE.ramRate * u.tier * engine * cls;
        if (s.gateHp <= 0) {
          s.gateHp = 0;
          breach(st, s, 'assault', `성문이 부서졌다 — ${u.name} 부대가 돌입한다.`);
          return;
        }
        continue;
      }

      /*
       * 성벽에 붙었으면 넘는다. 공성병기 없이 기어오르는 것은 비싸다 —
       * 등반 중에는 피해를 세 배로 받는다(§6.2). 병력 대비 5배 넘게 녹는다.
       */
      if (!gate && nearWall(st, u)) {
        s.wallHp -= u.troops * SIEGE.climbRate * u.tier;
        u.troops -= u.troops * 0.00035 * SIEGE.climbPenalty;
        if (s.wallHp <= 0) {
          s.wallHp = 0;
          breach(st, s, 'assault', `성벽이 무너졌다 — ${u.name} 부대가 넘어 들어간다.`);
          return;
        }
      }
    }
  }

  /* --- ② 포위 — 굶긴다 (§6.3-②) --- */
  const round = Math.floor(st.tick / SIEGE.roundSeconds);
  if (round > s.lastRound) {
    const rounds = round - s.lastRound;
    s.lastRound = round;

    const holding = st.units
      .filter((u) => u.side === 'defender' && !u.dead)
      .reduce((a, u) => a + u.troops, 0);

    /*
     * 포위 중에는 병량이 마르고, **마른 뒤에도 계속 마른다.**
     *
     * 처음에는 병량이 0 이 된 그 라운드에만 사기를 깎았다. 그래서 공격군이
     * 잠깐 강공으로 돌아서면 굶주림이 없던 일이 되었다 — 성 안에 먹을 것이
     * 없는데 사기가 멀쩡했다. 포위가 풀리기 전까지는 매 라운드 깎인다.
     */
    if (s.mode === 'encircle' && !s.breached) {
      const was = s.grain;
      s.grain = Math.max(0, s.grain - holding * SIEGE.starveRate * s.terrainToll * rounds);
      if (s.grain <= 0) {
        if (was > 0) note(st, '성 안의 병량이 다했다.', true);
        for (const u of st.units) {
          if (u.side === 'defender' && !u.dead) u.morale -= SIEGE.starveMorale * rounds;
        }
      }
    }
  }

  /*
   * 항복 판정 (§6.3-② · §6.4).
   *
   * **라운드 경계에서만 본다.** 매 틱 6% 로 굴렸더니 조건이 서는 순간
   * 17초 만에 성이 열렸다 — 굶기는 것이 전술이 아니라 스위치가 되어 버린다.
   */
  if (round > s.lastSurrenderCheck) {
    s.lastSurrenderCheck = round;
    const alive = st.units.filter((u) => u.side === 'defender' && !u.dead);

    /*
     * 성이 포위돼 있으면 무너진 부대가 **달아날 데가 없다.** 야전이라면
     * 물러나면 그만이지만 여기서는 성문 안이다 — 전부 무너지면 항복이다.
     * 이 줄이 없으면 굶어 무너진 수비군이 성 안에서 영원히 버틴다.
     */
    if (alive.length && alive.every((u) => u.routed)) {
      s.surrendered = true;
      s.method = s.method ?? (s.grain <= 0 ? 'encircle' : 'assault');
      note(st, '지킬 사람이 남지 않았다 — 성이 열렸다.', true);
      return;
    }

    if (alive.length) {
      const avg = alive.reduce((a, u) => a + u.morale, 0) / alive.length;
      const line = s.breached ? SIEGE.streetSurrenderMorale : SIEGE.surrenderMorale;
      const starved = s.grain <= 0 && !s.breached;
      if (avg <= line && (starved || s.breached) && rng.chance(0.35)) {
        s.surrendered = true;
        s.method = s.method ?? (starved ? 'encircle' : 'assault');
        note(st, '수비군이 성문을 열고 항복했다.', true);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 공성 AI — 사람이 안 잡은 쪽이 스스로 고른다
 * ------------------------------------------------------------------ */

/**
 * AI 공격군의 공성 판단.
 *
 * 네 수단(§6.3)을 다 쓸 줄 알아야 한다. 강공만 하면 안시성 같은 성은
 * 영영 안 떨어지고, 포위만 하면 병량 많은 성 앞에서 시간만 간다.
 *
 *   내응 — 한 번뿐이므로 일찍 던진다. 실패해도 잃는 것이 없다
 *   계략 — 조건이 맞는 순간이 오면 그때 쓴다 (계절·물가·책략 단계)
 *   강공 ↔ 포위 — 성문이 안 깎이면 굶기는 쪽으로 돌아선다
 */
function siegeAI(
  st: FieldState,
  s: SiegeState,
  rng: RngCursor,
  ctx: { wardenChr: number; wardenTrait: SiegeTrait; riverside: boolean }
): void {
  if (s.breached || s.surrendered) return;
  const round = Math.floor(st.tick / SIEGE.roundSeconds);

  // ① 내응 — 두 번째 라운드에 한 번 던진다
  if (!s.infiltrated && round >= 1) {
    infiltrate(st, s, ctx.wardenChr, ctx.wardenTrait, rng);
    return;
  }

  // ② 계략 — 공격 측 책략계가 있어야 한다
  const wits = st.units.filter(
    (u) => u.side === 'attacker' && u.troop === 'str' && !u.dead && !u.routed
  );
  if (wits.length && round >= 2) {
    const tier = Math.max(...wits.map((u) => u.tier));
    const wit = 0.8;
    for (const id of ['waterAttack', 'burnGate', 'fireCity'] as SiegeSchemeId[]) {
      if (!siegeSchemeError(st, s, id, tier, ctx.riverside)) {
        castSiegeScheme(st, s, id, tier, ctx.riverside, wit);
        return;
      }
    }
  }

  /*
   * ③ 강공이냐 포위냐.
   *
   * 열 라운드를 두드려도 성문이 절반 넘게 남아 있으면 정면으로는 안 되는
   * 성이다 — 굶긴다. 산성은 병량 소모가 1.4배이므로 이쪽이 정답이 된다(§5.2).
   * 반대로 병량이 다해 가는 성은 굳이 굶길 이유가 없으니 마저 친다.
   */
  if (s.mode === 'assault' && round >= 8) {
    /*
     * 진척으로 판단한다. 지금 속도로 제한 라운드(90) 안에 문을 못 깨겠으면
     * 정면으로는 안 되는 성이다 — 굶긴다. 「10라운드에 절반 남았으면 포위」로
     * 두었더니 열한 시간이면 깰 수 있는 문 앞에서 포위로 돌아섰다.
     */
    const done = s.gateMax - s.gateHp;
    const perRound = done / round;
    const need = perRound > 0 ? s.gateHp / perRound : Infinity;
    if (round + need > SIEGE.maxRounds) setSiegeMode(st, s, 'encircle');
  } else if (s.mode === 'encircle' && s.grain <= 0) {
    /*
     * 굶겼으면 마무리는 강공이다. 다만 **아직 버틸 만한 성에는 돌아서지
     * 않는다** — 그러면 굶주림이 멎어 여태 굶긴 것이 없던 일이 된다.
     */
    const alive = st.units.filter((u) => u.side === 'defender' && !u.dead);
    const avg = alive.length ? alive.reduce((a, u) => a + u.morale, 0) / alive.length : 0;
    if (avg <= 45) setSiegeMode(st, s, 'assault');
  }
}

/** 성벽 타일에 붙어 있는가 */
function nearWall(st: FieldState, u: FieldUnit): boolean {
  const f = st.field;
  const [tw, th] = tileSize(f);
  const tx = Math.floor(u.x / tw);
  const ty = Math.floor(u.y / th);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      if (f.tiles[y][x] === 'W') return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 개입 명령
 * ------------------------------------------------------------------ */

/** 강공이냐 포위냐 (§6.3). 이것이 공성전의 첫 판단이다 */
export function setSiegeMode(st: FieldState, s: SiegeState, mode: SiegeMode): void {
  if (s.mode === mode) return;
  s.mode = mode;
  note(st, mode === 'assault' ? '성문을 친다 — 강공.' : '사방을 막는다 — 포위.', true);
}

/**
 * 내응(內應) — 첩자를 넣어 성문을 연다 (§6.3-④).
 *
 * `성공률 = 25% − 수비장수 매력×0.3 + 성향 보정`
 *
 * 인물 데이터의 성향이 여기서 값을 한다. **야심가·실리형이 지키는 성은
 * 정면으로 깨는 것보다 사서 여는 쪽이 싸다.** 한 번뿐이므로 언제 쓸지가
 * 판단이 된다.
 */
export function infiltrate(
  st: FieldState,
  s: SiegeState,
  chr: number,
  trait: SiegeTrait,
  rng: RngCursor
): string | null {
  if (s.infiltrated) return '이미 첩자를 넣었습니다.';
  if (s.breached) return '이미 성이 뚫렸습니다.';
  s.infiltrated = true;

  const bonus = trait === 'loyal' ? -0.2 : trait === 'ambitious' ? 0.1 : trait === 'mercenary' ? 0.18 : 0;
  const p = Math.max(0.02, SIEGE.infiltrateBase - (chr * 0.3) / 100 + bonus);
  if (rng.chance(p)) {
    breach(st, s, 'infiltrate', '안에서 성문이 열렸다 — 내응이 통했다.');
    return null;
  }
  note(st, '첩자가 잡혔다. 내응은 실패했다.', true);
  return null;
}

/* ------------------------------------------------------------------ *
 * 공성 계략 (§6.3-③)
 * ------------------------------------------------------------------ */

export type SiegeSchemeId = 'waterAttack' | 'fireCity' | 'burnGate';

export interface SiegeSchemeSpec {
  name: string;
  tier: 1 | 2 | 3 | 4;
  desc: string;
  /** 이 계절에만 (빈 배열이면 언제나) */
  seasons: number[];
}

export const SIEGE_SCHEMES: Record<SiegeSchemeId, SiegeSchemeSpec> = {
  waterAttack: {
    name: '수공',
    tier: 3,
    seasons: [1],
    desc: '강을 끌어 성벽을 무너뜨린다 — 여름, 물가, 책략 3단계',
  },
  fireCity: {
    name: '화공',
    tier: 2,
    seasons: [2, 3],
    desc: '성 안에 불을 놓아 병량을 태운다 — 가을·겨울, 책략 2단계',
  },
  burnGate: {
    name: '소성',
    tier: 2,
    seasons: [],
    desc: '탄 자리를 파고들어 성문을 태운다 — 화공이 든 뒤에만',
  },
};

/** 지금 이 공성 계략을 쓸 수 있는가. 못 쓰면 이유를 돌려준다 */
export function siegeSchemeError(
  st: FieldState,
  s: SiegeState,
  id: SiegeSchemeId,
  strTier: number,
  riverside: boolean
): string | null {
  const spec = SIEGE_SCHEMES[id];
  if (s.breached) return '이미 성이 뚫렸습니다.';
  if (strTier < spec.tier) return `국가 책략 ${spec.tier}단계가 있어야 합니다.`;
  if (spec.seasons.length && !spec.seasons.includes(st.season)) {
    return `${spec.seasons.map((i) => ['봄', '여름', '가을', '겨울'][i]).join('·')}에만 씁니다.`;
  }
  if (id === 'waterAttack' && !riverside) return '강을 낀 성이 아닙니다.';
  if (id === 'burnGate' && !s.burned) return '먼저 화공이 들어야 합니다.';
  return null;
}

export function castSiegeScheme(
  st: FieldState,
  s: SiegeState,
  id: SiegeSchemeId,
  strTier: number,
  riverside: boolean,
  wit: number
): string | null {
  const err = siegeSchemeError(st, s, id, strTier, riverside);
  if (err) return err;

  switch (id) {
    case 'waterAttack':
      s.wallHp = Math.max(0, s.wallHp - s.wallMax * 0.4);
      for (const u of st.units) if (u.side === 'defender' && !u.dead) u.morale -= 25 * wit;
      note(st, '물길을 돌려 성벽을 쳤다 — 성벽이 크게 상했다.', true);
      if (s.wallHp <= 0) breach(st, s, 'scheme', '물에 성벽이 무너져 내렸다.');
      break;

    case 'fireCity':
      s.grain = Math.max(0, s.grain * 0.5);
      s.burned = true;
      note(st, '성 안에 불이 번졌다 — 병량 절반이 탔다.', true);
      break;

    case 'burnGate':
      s.gateHp = Math.max(0, s.gateHp - s.gateMax * 0.6);
      note(st, '탄 자리를 파고들어 성문을 태웠다.', true);
      if (s.gateHp <= 0) breach(st, s, 'scheme', '성문이 타 무너졌다.');
      break;
  }
  return null;
}
