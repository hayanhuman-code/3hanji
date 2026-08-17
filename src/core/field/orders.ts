/**
 * field/orders.ts — 개입(介入).
 *
 * 이 파일이 전투 v2 의 성패를 가른다.
 *
 * 전투가 30~60분인데 할 일이 태세 버튼 넷뿐이면 플레이어는 전부 즉시결판을
 * 눌러 버린다(기획서 §10 의 최대 리스크). 그래서 **길이와 개입 밀도는
 * 함께 가야 한다.** 여기 있는 명령들은 하나하나가 실제로 승패를 갈라야 한다.
 *
 * 명령은 전부 「지금 판을 고치는」 함수다. 되돌리기는 없다 —
 * 무른 판단도 판단이라는 것이 이 전투의 태도다.
 */

import { RngCursor } from '../rng';
import type { Troop } from '../types';
import { F, SEASON } from './balance';
import { onWater, specAt } from './battlefield';
import type { FieldState, FieldUnit, Side, Stance, Tier } from './types';

const find = (st: FieldState, id: string) => st.units.find((u) => u.id === id && !u.dead);

function note(st: FieldState, text: string, big = false) {
  st.log.push({ tick: st.tick, text, big });
  if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
}

/* ------------------------------------------------------------------ *
 * ① 태세 — 전군 또는 한 부대
 * ------------------------------------------------------------------ */

export function setStance(st: FieldState, side: Side, stance: Stance, unitId?: string): void {
  if (unitId) {
    const u = find(st, unitId);
    if (!u || u.side !== side) return;
    u.stance = stance;
    return;
  }
  for (const u of st.units) if (u.side === side && !u.dead) u.stance = stance;
  note(st, `${side === 'attacker' ? '공격' : '수비'} 전군 태세 — ${stanceName(stance)}`);
}

const stanceName = (s: Stance) => ({ charge: '돌격', hold: '견고', shoot: '사격', wait: '대기' })[s];

/* ------------------------------------------------------------------ *
 * ② 목표 지정 · ③ 지점 이동
 * ------------------------------------------------------------------ */

/** 특정 적을 향하게 한다. null 이면 다시 알아서 고르게 둔다 */
export function setTarget(st: FieldState, unitId: string, targetId: string | null): void {
  const u = find(st, unitId);
  if (!u) return;
  u.orderTarget = targetId;
  if (targetId) {
    const v = find(st, targetId);
    if (v) note(st, `${u.name} → ${v.name} 을(를) 노린다.`);
  }
}

/**
 * 전장의 한 지점으로 보낸다. 고지 선점·여울 차단이 여기서 나온다.
 * 7×5km 실지형이 값을 하는 자리다 (§4.7).
 */
export function moveTo(st: FieldState, unitId: string, x: number, y: number): void {
  const u = find(st, unitId);
  if (!u) return;
  u.orderPoint = { x, y };
  u.orderTarget = null;
  u.path = [];
  u.pathGoal = null;
  u.pathAt = -9999;
  const ground = specAt(st.field, x, y);
  note(st, `${u.name} 부대에 ${ground.name} 으로 이동을 명한다.`);
}

/** 명령을 거두고 계열 규칙에 맡긴다 */
export function releaseOrders(st: FieldState, unitId: string): void {
  const u = find(st, unitId);
  if (!u) return;
  u.orderPoint = null;
  u.orderTarget = null;
}

/* ------------------------------------------------------------------ *
 * ④ 예비대 투입 — 이 전투의 핵심 판단 (§4.7)
 * ------------------------------------------------------------------ */

/**
 * 예비대를 전선에 넣는다.
 *
 * 12부대 중 둘셋을 뒤에 빼 두면 초반 전력은 약해지지만, 전선이 뚫린 곳에
 * 제때 밀어넣으면 판이 뒤집힌다. **언제 쓸 것인가** — 그것이 30분 전투를
 * 지루하지 않게 만드는 장치다.
 *
 * 새로 들어온 부대는 지친 전열을 교대해 줄 수 있으므로, 투입 순간
 * 근처 아군의 사기가 오른다.
 */
export function commitReserve(st: FieldState, unitId: string): boolean {
  const u = find(st, unitId);
  if (!u || !u.reserve) return false;
  u.reserve = false;
  u.stance = 'charge';
  note(st, `${u.name} 예비대 투입.`, true);
  for (const a of st.units) {
    if (a.side !== u.side || a.dead || a.id === u.id) continue;
    if (Math.hypot(a.x - u.x, a.y - u.y) < 1400) a.morale = Math.min(100, a.morale + 8);
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * ⑤ 추격 · 정지 (§4.7-1 추격 국면)
 * ------------------------------------------------------------------ */

/**
 * 무너진 적을 쫓을 것인가, 진형을 지킬 것인가.
 *
 * 쫓으면 적을 섬멸해 전략적 이득이 크지만, 진형이 흐트러진 채 적 원군이
 * 도착하면 역전당한다. 이 게임에서 원군은 실제로 온다(§4.7-2).
 */
export function pursue(st: FieldState, side: Side, on: boolean): void {
  for (const u of st.units) {
    if (u.side !== side || u.dead) continue;
    u.pursuing = on;
    if (!on) {
      u.orderTarget = null;
      u.orderPoint = null;
    }
  }
  note(st, on ? '추격을 명한다.' : '추격을 멈추고 진형을 갖춘다.', true);
}

/* ------------------------------------------------------------------ *
 * ⑥ 퇴각
 * ------------------------------------------------------------------ */

/** 손실을 줄이고 물러난다. 한 부대만 뺄 수도, 전군을 뺄 수도 있다 */
export function withdraw(st: FieldState, side: Side, unitId?: string): void {
  const list = unitId
    ? st.units.filter((u) => u.id === unitId && !u.dead)
    : st.units.filter((u) => u.side === side && !u.dead);
  for (const u of list) {
    u.routed = true;
    u.orderTarget = null;
    u.orderPoint = null;
  }
  note(st, unitId ? `${list[0]?.name ?? ''} 부대가 물러난다.` : '전군 퇴각.', true);
}

/* ------------------------------------------------------------------ *
 * ⑦ 계략 — 책략계가 국가 단계만큼 쓸 수 있다 (§2.1)
 * ------------------------------------------------------------------ */

export type SchemeId = 'disrupt' | 'fire' | 'ambush' | 'flood' | 'cutSupply';

export interface SchemeSpec {
  name: string;
  /** 이 국가 책략 단계부터 쓸 수 있다 */
  tier: Tier;
  desc: string;
  /** 다시 쓰기까지 걸리는 전장 시간(초) */
  cooldown: number;
}

export const SCHEMES: Record<SchemeId, SchemeSpec> = {
  disrupt: { name: '교란', tier: 1, cooldown: 1200, desc: '적 한 부대의 사기를 흔든다' },
  fire: { name: '화계', tier: 2, cooldown: 2400, desc: '불을 놓는다. 가을에 위력이 커진다' },
  ambush: { name: '매복', tier: 2, cooldown: 2400, desc: '한동안 그 부대가 받는 피해가 커진다' },
  flood: { name: '수계', tier: 3, cooldown: 3600, desc: '물을 터뜨린다. 여름에, 물가에서 크다' },
  cutSupply: { name: '보급차단', tier: 3, cooldown: 3000, desc: '적 한 부대를 지치게 한다' },
};

/** 그 부대가 지금 이 계략을 쓸 수 있는가. 못 쓰면 이유를 돌려준다 */
export function schemeError(
  st: FieldState,
  caster: FieldUnit,
  id: SchemeId,
  tiers: Record<Troop, Tier>
): string | null {
  const s = SCHEMES[id];
  if (caster.troop !== 'str') return '책략계 장수만 계략을 씁니다.';
  if (caster.routed || caster.dead) return '무너진 부대는 계략을 못 씁니다.';
  if (tiers.str < s.tier) return `국가 책략 ${s.tier}단계가 있어야 합니다.`;
  if (st.tick < (caster.schemeAt ?? -99999) + s.cooldown) {
    const left = Math.ceil(((caster.schemeAt ?? 0) + s.cooldown - st.tick) / 60);
    return `아직 준비되지 않았습니다 (${left}분).`;
  }
  return null;
}

/**
 * 계략을 건다.
 *
 * 살수대첩은 여기서 성립한다 — **여름에, 강가에 몰린 적에게, 책략 3단계
 * 을지문덕이 수계를 쓴다.** 조건이 다 맞아야 하므로 전략적 준비가 필요하다
 * (§5.5). 조건을 못 맞추면 그냥 약한 계략이다.
 */
export function castScheme(
  st: FieldState,
  casterId: string,
  id: SchemeId,
  targetId: string,
  tiers: Record<Troop, Tier>,
  intOf: (officer: string) => number
): string | null {
  const caster = find(st, casterId);
  const target = find(st, targetId);
  if (!caster) return '없는 부대입니다.';
  if (!target) return '없는 목표입니다.';
  if (target.side === caster.side) return '아군에게는 못 겁니다.';
  const err = schemeError(st, caster, id, tiers);
  if (err) return err;

  const rng = new RngCursor(st.rngCursor);
  // 지력이 높을수록 세게 든다. 계략은 병력이 아니라 사람이 부리는 것이다
  const wit = intOf(caster.officer) / 100;
  const spec = SCHEMES[id];
  caster.schemeAt = st.tick;

  switch (id) {
    case 'disrupt':
      target.morale -= 18 * wit;
      note(st, `${caster.name}이(가) ${target.name} 부대를 교란했다.`, true);
      break;

    case 'fire': {
      const season = SEASON.fireBonus[st.season];
      const ground = specAt(st.field, target.x, target.y);
      // 숲에서 불이 제일 잘 붙는다
      const woods = ground.name === '숲' ? 1.6 : 1;
      const loss = target.maxTroops * 0.09 * wit * season * woods * rng.float(0.9, 1.1);
      target.troops = Math.max(0, target.troops - loss);
      target.morale -= 14 * wit;
      note(
        st,
        `${caster.name}이(가) 불을 놓았다 — ${target.name} 부대 ${Math.round(loss)}명 손실` +
          (season > 1 ? ' (가을 건조)' : '') +
          (woods > 1 ? ' (숲)' : ''),
        true
      );
      break;
    }

    case 'ambush':
      target.exposedUntil = st.tick + 900;
      note(st, `${caster.name}이(가) ${target.name} 부대의 길목에 매복을 두었다.`, true);
      break;

    case 'flood': {
      const season = SEASON.floodBonus[st.season];
      const wet = onWater(st.field, target.x, target.y);
      const near = wet ? 2.2 : specAt(st.field, target.x, target.y).name === '여울' ? 1.8 : 0.5;
      const loss = target.maxTroops * 0.14 * wit * season * near * rng.float(0.9, 1.1);
      target.troops = Math.max(0, target.troops - loss);
      target.morale -= 26 * wit * (near > 1 ? 1 : 0.4);
      note(
        st,
        near > 1
          ? `${caster.name}이(가) 물을 터뜨렸다 — ${target.name} 부대 ${Math.round(loss)}명이 물에 휩쓸렸다` +
              (season > 1 ? ' (여름 장마)' : '')
          : `${caster.name}이(가) 물을 터뜨렸으나 ${target.name} 부대는 물가에 있지 않았다.`,
        true
      );
      break;
    }

    case 'cutSupply':
      target.fatigue = Math.min(F.fatigueMax, target.fatigue + 32 * wit);
      target.morale -= 8 * wit;
      note(st, `${caster.name}이(가) ${target.name} 부대의 보급을 끊었다.`, true);
      break;
  }

  if (target.troops <= target.maxTroops * 0.04) {
    target.dead = true;
    target.troops = 0;
    note(st, `${target.name} 부대 궤멸.`, true);
    for (const a of st.units) if (a.side === target.side && !a.dead) a.morale -= F.moraleOnAllyLost;
  }
  st.rngCursor = rng.seed;
  void spec;
  return null;
}
