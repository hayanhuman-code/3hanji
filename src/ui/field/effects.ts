/**
 * effects.ts — 전투 이펙트. **계산된 결과를 보여줄 뿐, 아무것도 계산하지 않는다.**
 *
 * 코어는 건드리지 않는다. 매 프레임 부대 병력·성벽 HP 의 변화를 읽어
 * 「무슨 일이 있었는지」를 렌더 쪽에서 추론한다:
 *   - 병력이 줄었다 → 피격 (점멸·밀림·피해 숫자)
 *   - 줄인 쪽을 노리는 근접 부대 → 돌진 모션 + 타격 섬광
 *   - 궁병이 노리는 중 → 화살 궤적
 *   - 성벽·성문 HP 가 줄었다 → 투석 포물선 + 먼지구름 + 흔들림
 *   - 부대가 사라졌다 → 소멸 파편
 *
 * 섬광·파편·먼지는 코드 도형이고(픽셀 파티클, 기존 팔레트), 날아가는
 * 물체만 스프라이트(obj_arrow·obj_boulder — 없으면 도형 폴백)를 쓴다.
 *
 * 배속: 이펙트 시계는 게임 배속을 따라 흐른다. FX_SIMPLIFY_AT 배속부터는
 * 돌진·화살·섬광을 생략하고 피해 숫자·소멸·흔들림만 남긴다 (숫자는
 * 읽어야 하므로 실시간으로 흐른다). 전체 켬/끔은 localStorage 에 남는다.
 *
 * 성능: 파티클·발사체·숫자는 상한이 있는 배열 풀이다. 넘치면 새 것을
 * 버린다 — 난전에서 오래된 이펙트를 지우는 것보다 눈에 덜 띈다.
 */

import { gatePoint } from '../../core/field/siege';
import { unitRange } from '../../core/field/sim';
import type { FieldState } from '../../core/field/types';
import { T } from '../tokens';
import { sprite } from './sprites';

/* ------------------------------------------------------------------ *
 * 설정
 * ------------------------------------------------------------------ */

/** 이 배속부터 돌진·화살·섬광을 생략한다 (숫자·소멸·흔들림은 유지) */
export const FX_SIMPLIFY_AT = 4;

const MAX_PARTICLES = 400;
const MAX_PROJECTILES = 48;
const MAX_NUMBERS = 40;

/** 근접 돌진 거리(m). 기병이 보병보다 길다 */
const LUNGE_M = { inf: 60, cav: 115 };
const LUNGE_SEC = 0.22;
const MELEE_CD = 0.85; // 돌진 모션 주기(초, 이펙트 시계)
const ARROW_CD = 1.15;
const ARROW_VOLLEY = 3; // 한 번에 나는 화살 수
const HURT_CD = 0.4; // 피격 점멸·밀림 주기
const NUM_WINDOW = 0.5; // 피해 숫자 합산 창(실시간 초)
// 임계는 실측 기준: 접전 중 0.5초 피해가 한 자릿수, 계략·추격전에서 수십~백.
const NUM_BIG = 90; // 이 이상이면 큰 숫자 (진사)
const NUM_MID = 30; // 이 이상이면 중간 강조 (주황)
const BOULDER_CD = 2.4;

const LS_KEY = 'samhanji.fx';

let enabled = true;
try {
  enabled = localStorage.getItem(LS_KEY) !== 'off';
} catch {
  /* SSR·테스트 환경 — 기본 켬 */
}

export function fxEnabled(): boolean {
  return enabled;
}

export function setFxEnabled(v: boolean): void {
  enabled = v;
  try {
    localStorage.setItem(LS_KEY, v ? 'on' : 'off');
  } catch {
    /* 저장 못 해도 동작에는 지장 없다 */
  }
}

/* ------------------------------------------------------------------ *
 * 내부 상태 — 전부 렌더 전용. 좌표는 전장 미터, 크기·흔들림은 화면 px
 * ------------------------------------------------------------------ */

interface Particle {
  kind: 'pix' | 'flash';
  x: number; y: number; vx: number; vy: number;
  ttl: number; life: number;
  size: number; // px
  color: string;
}
interface Projectile {
  kind: 'arrow' | 'boulder';
  x0: number; y0: number; x1: number; y1: number;
  t: number; dur: number; arc: number; // m
  spin: number; angle0: number;
}
interface FloatNum {
  x: number; y: number; text: string; t: number; dur: number;
  big: boolean; color: string;
}
interface Impact { at: number; x: number; y: number }

let clock = 0; // 이펙트 시계 — 배속을 따라 흐른다
const particles: Particle[] = [];
const projectiles: Projectile[] = [];
const numbers: FloatNum[] = [];
const impacts: Impact[] = [];

const prevTroops = new Map<string, number>();
const prevGone = new Map<string, boolean>();
const nextMelee = new Map<string, number>();
const nextArrow = new Map<string, number>();
const nextHurt = new Map<string, number>();
const lunges = new Map<string, { dx: number; dy: number; dist: number; t: number }>();
const flashes = new Map<string, number>(); // id → 점멸이 끝나는 시각
const knocks = new Map<string, { dx: number; dy: number; t: number }>();
const dmgAcc = new Map<string, { sum: number; age: number; x: number; y: number }>();
const hurtRecent = new Map<string, number>(); // id → 마지막 피격 시각

let prevWall = -1;
let prevGate = -1;
let assaultUntil = 0;
let gateAssault = false;
let nextBoulder = 0;
let shakeMag = 0;
let shakeT = 0;
let fieldId = '';
let wallTargetCache: { x: number; y: number } | null = null;

const hash01 = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
};

function reset(): void {
  particles.length = projectiles.length = numbers.length = impacts.length = 0;
  prevTroops.clear(); prevGone.clear(); nextMelee.clear(); nextArrow.clear();
  nextHurt.clear(); lunges.clear(); flashes.clear(); knocks.clear();
  dmgAcc.clear(); hurtRecent.clear();
  prevWall = prevGate = -1;
  assaultUntil = nextBoulder = shakeMag = shakeT = 0;
  wallTargetCache = null;
}

/* ------------------------------------------------------------------ *
 * 스폰 — 도형 파티클은 전부 기존 팔레트에서 고른다
 * ------------------------------------------------------------------ */

function spawnPix(
  x: number, y: number, n: number, colors: string[],
  speed: number, ttl: number, size: number
): void {
  for (let i = 0; i < n; i++) {
    if (particles.length >= MAX_PARTICLES) return;
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.35 + Math.random() * 0.65);
    particles.push({
      kind: 'pix', x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.75 - speed * 0.15,
      ttl, life: ttl * (0.6 + Math.random() * 0.4),
      size: size * (0.7 + Math.random() * 0.6),
      color: colors[(Math.random() * colors.length) | 0],
    });
  }
}

function spawnFlash(x: number, y: number, size: number, color: string, ttl = 0.12): void {
  if (particles.length >= MAX_PARTICLES) return;
  particles.push({ kind: 'flash', x, y, vx: 0, vy: 0, ttl, life: ttl, size, color });
}

/** 근접 타격 — 짧은 섬광 + 사방으로 튀는 픽셀 파편 */
function meleeImpact(x: number, y: number): void {
  spawnFlash(x, y, 20, T.onDark, 0.12);
  spawnPix(x, y, 12, [T.onDark, '#C9B896', T.meokMid], 380, 0.38, 2.8);
}

/** 화살 착탄 — 작은 먼지 튐 (근접과 구별되는 낮고 옅은 흙빛) */
function arrowImpact(x: number, y: number): void {
  spawnPix(x, y, 5, ['#B8A98F', T.jiDeep, '#8C8272'], 150, 0.3, 2);
}

/** 투석 착탄 — 큰 먼지구름 + 성벽 파편 + 화면 흔들림 */
function boulderImpact(x: number, y: number, onWall: boolean): void {
  spawnFlash(x, y, 20, '#D8CDB4', 0.14);
  spawnPix(x, y, 20, ['#B8A98F', '#9C917D', T.jiDeep, '#8C8272'], 260, 0.75, 3.4);
  if (onWall) spawnPix(x, y, 12, ['#8A8580', '#6E6862', T.meokMid], 420, 0.5, 2.6);
  shakeMag = Math.max(shakeMag, 4.5);
  shakeT = 0.35;
}

/** 부대 소멸 — 흩어지듯 사라진다 */
function deathBurst(x: number, y: number, factionColor: string): void {
  spawnPix(x, y, 26, [factionColor, T.meokMid, T.meok, '#C9B896'], 190, 0.85, 2.6);
  spawnFlash(x, y, 18, '#D8CDB4', 0.16);
}

/* ------------------------------------------------------------------ *
 * 프레임 — 감지와 물리를 한 번에
 * ------------------------------------------------------------------ */

/** 성벽 타일 중 공격군 무게중심에 가장 가까운 지점(m). 전장별 캐시 */
function wallTarget(st: FieldState): { x: number; y: number } | null {
  if (wallTargetCache) return wallTargetCache;
  const f = st.field;
  const atk = st.units.filter((u) => u.side === 'attacker' && !u.dead);
  if (!atk.length) return null;
  const cx = atk.reduce((s, u) => s + u.x, 0) / atk.length;
  const cy = atk.reduce((s, u) => s + u.y, 0) / atk.length;
  const tw = (f.kmW * 1000) / f.w;
  const th = (f.kmH * 1000) / f.h;
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (let ty = 0; ty < f.tiles.length; ty++) {
    for (let tx = 0; tx < f.tiles[ty].length; tx++) {
      if (f.tiles[ty][tx] !== 'W') continue;
      const x = (tx + 0.5) * tw;
      const y = (ty + 0.5) * th;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) { bd = d; best = { x, y }; }
    }
  }
  wallTargetCache = best;
  return best;
}

export function fxFrame(state: FieldState, dtReal: number, speed: number): void {
  if (import.meta.env.DEV) lastState = state; // 진단 훅용 — 프로덕션에선 접히는 상수 분기
  if (state.field.id !== fieldId) {
    fieldId = state.field.id;
    reset();
  }
  const dt = dtReal * speed; // 이펙트 시계는 배속을 따른다
  clock += dt;
  const simplify = !enabled || speed >= FX_SIMPLIFY_AT;

  /* --- 감지: 병력 변화 → 피격·소멸 --- */
  for (const u of state.units) {
    const id = u.id;
    const pt = prevTroops.get(id);
    const gone = u.dead || u.troops <= 0;

    if (pt !== undefined && !prevGone.get(id)) {
      const dmg = pt - u.troops;
      if (dmg > 0.5 && enabled) {
        hurtRecent.set(id, clock);
        // 피해 숫자 — 잠깐 모았다가 한 번에 (실시간 창)
        const acc = dmgAcc.get(id);
        if (acc) { acc.sum += dmg; acc.x = u.x; acc.y = u.y; }
        else dmgAcc.set(id, { sum: dmg, age: 0, x: u.x, y: u.y });

        // 점멸 + 밀림 (쿨다운) — 때린 쪽 반대 방향으로
        if (!simplify && !gone && (nextHurt.get(id) ?? 0) <= clock) {
          nextHurt.set(id, clock + HURT_CD);
          flashes.set(id, clock + 0.09);
          const foe = state.units.find(
            (w) => !w.dead && w.target === id &&
              Math.hypot(w.x - u.x, w.y - u.y) <= unitRange(w) * 1.2
          );
          const ang = foe ? Math.atan2(u.y - foe.y, u.x - foe.x) : Math.random() * Math.PI * 2;
          knocks.set(id, { dx: Math.cos(ang) * 26, dy: Math.sin(ang) * 26, t: 0.18 });
        }
      }
      if (gone && enabled) {
        // 전멸 — 남은 피해 숫자를 즉시 띄우고 흩어진다
        const acc = dmgAcc.get(id);
        if (acc) { acc.age = NUM_WINDOW; }
        const fc =
          u.faction === 'goguryeo' ? T.goguryeo :
          u.faction === 'baekje' ? T.baekje :
          u.faction === 'silla' ? T.silla : T.gaya;
        deathBurst(u.x, u.y, fc);
      }
    }
    prevTroops.set(id, u.troops);
    prevGone.set(id, gone);
  }

  /* --- 공격 모션: 노리는 상대가 실제로 피를 흘리고 있을 때만 --- */
  if (enabled && !simplify) {
    for (const u of state.units) {
      if (u.dead || u.reserve || !u.target || u.arriveTick > state.tick) continue;
      const v = state.units.find((w) => w.id === u.target);
      if (!v || v.dead) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > unitRange(u)) continue;
      if ((hurtRecent.get(v.id) ?? -9) < clock - 0.6) continue; // 그림만 붙고 피해가 없으면 침묵

      if (u.troop === 'inf' || u.troop === 'cav' || u.navy) {
        if ((nextMelee.get(u.id) ?? 0) <= clock) {
          nextMelee.set(u.id, clock + MELEE_CD + hash01(u.id) * 0.4);
          const d = Math.hypot(v.x - u.x, v.y - u.y) || 1;
          const dist = u.troop === 'cav' ? LUNGE_M.cav : LUNGE_M.inf;
          lunges.set(u.id, { dx: (v.x - u.x) / d, dy: (v.y - u.y) / d, dist, t: 0 });
          impacts.push({ at: clock + LUNGE_SEC * 0.5, x: v.x, y: v.y });
        }
      } else if (u.troop === 'arc') {
        if ((nextArrow.get(u.id) ?? 0) <= clock && projectiles.length < MAX_PROJECTILES - ARROW_VOLLEY) {
          nextArrow.set(u.id, clock + ARROW_CD + hash01(u.id) * 0.5);
          const dist = Math.hypot(v.x - u.x, v.y - u.y);
          for (let i = 0; i < ARROW_VOLLEY; i++) {
            const jx = (Math.random() - 0.5) * 90;
            const jy = (Math.random() - 0.5) * 90;
            projectiles.push({
              kind: 'arrow',
              x0: u.x + jx * 0.4, y0: u.y + jy * 0.4,
              x1: v.x + jx, y1: v.y + jy,
              t: -i * 0.07, dur: 0.32 + dist / 5000,
              arc: 40 + dist * 0.12, spin: 0, angle0: 0,
            });
          }
        }
      }
    }
  }

  /* --- 공성: 성벽·성문 HP 가 깎이는 동안 투석 포물선 --- */
  const sg = state.siegeState;
  if (sg) {
    if (prevWall >= 0 && enabled) {
      // HP 는 노이즈 없이 단조 감소한다 — 아주 느린 망치질도 감지한다
      const gateDrop = prevGate - sg.gateHp > 0.01;
      const wallDrop = prevWall - sg.wallHp > 0.01;
      if (gateDrop || wallDrop) {
        assaultUntil = clock + 2.0;
        gateAssault = gateDrop;
      }
    }
    prevWall = sg.wallHp;
    prevGate = sg.gateHp;

    if (enabled && !simplify && clock < assaultUntil && clock >= nextBoulder &&
        projectiles.length < MAX_PROJECTILES) {
      const target = gateAssault ? gatePoint(state) : wallTarget(state);
      const throwers = state.units.filter((u) => u.side === 'attacker' && !u.dead && !u.reserve);
      if (target && throwers.length) {
        // 뒷줄에서 던진다 — 목표에서 가장 먼 공격 부대
        let far = throwers[0];
        for (const u of throwers) {
          if (Math.hypot(u.x - target.x, u.y - target.y) >
              Math.hypot(far.x - target.x, far.y - target.y)) far = u;
        }
        nextBoulder = clock + BOULDER_CD + Math.random() * 1.2;
        const dist = Math.hypot(far.x - target.x, far.y - target.y);
        projectiles.push({
          kind: 'boulder',
          x0: far.x, y0: far.y,
          x1: target.x + (Math.random() - 0.5) * 120,
          y1: target.y + (Math.random() - 0.5) * 120,
          t: 0, dur: 1.1 + dist / 4500,
          arc: 320 + dist * 0.3,
          spin: 4 + Math.random() * 3, angle0: Math.random() * Math.PI * 2,
        });
      }
    }
  } else {
    prevWall = prevGate = -1;
  }

  /* --- 물리 진행 --- */
  for (let i = impacts.length - 1; i >= 0; i--) {
    if (impacts[i].at <= clock) {
      meleeImpact(impacts[i].x, impacts[i].y);
      impacts.splice(i, 1);
    }
  }
  for (const [id, l] of lunges) {
    l.t += dt;
    if (l.t >= LUNGE_SEC) lunges.delete(id);
  }
  for (const [id, k] of knocks) {
    k.t -= dt;
    if (k.t <= 0) knocks.delete(id);
  }
  for (const [id, until] of flashes) if (until <= clock) flashes.delete(id);
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t += dt;
    if (p.t >= p.dur) {
      if (p.kind === 'arrow') arrowImpact(p.x1, p.y1);
      else boulderImpact(p.x1, p.y1, true);
      projectiles.splice(i, 1);
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 2.2 * dt;
    p.vy *= 1 - 2.2 * dt;
  }
  if (shakeT > 0) {
    shakeT -= dt;
    if (shakeT <= 0) shakeMag = 0;
  }

  /* --- 피해 숫자 방출 (실시간) --- */
  for (const [id, acc] of dmgAcc) {
    acc.age += dtReal;
    if (acc.age < NUM_WINDOW) continue;
    dmgAcc.delete(id);
    if (!enabled || acc.sum < 1 || numbers.length >= MAX_NUMBERS) continue;
    const val = Math.round(acc.sum);
    numbers.push({
      x: acc.x, y: acc.y,
      text: val.toLocaleString(),
      t: 0, dur: 0.8,
      big: val >= NUM_BIG,
      color: val >= NUM_BIG ? T.jinsa : val >= NUM_MID ? '#C9853F' : T.onDark,
    });
  }
  for (let i = numbers.length - 1; i >= 0; i--) {
    numbers[i].t += dtReal;
    if (numbers[i].t >= numbers[i].dur) numbers.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ *
 * 조회 — 부대 그리기가 묻는다
 * ------------------------------------------------------------------ */

/** 돌진·밀림이 만든 표시 오프셋(m) */
export function fxUnitOffset(id: string): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  const l = lunges.get(id);
  if (l) {
    // 나갔다 돌아온다 — sin 반주기
    const m = Math.sin((l.t / LUNGE_SEC) * Math.PI) * l.dist;
    dx += l.dx * m;
    dy += l.dy * m;
  }
  const k = knocks.get(id);
  if (k) {
    const m = k.t / 0.18;
    dx += k.dx * m;
    dy += k.dy * m;
  }
  return { dx, dy };
}

/** 피격 점멸 강도 0~1 */
export function fxUnitFlash(id: string): number {
  const until = flashes.get(id);
  if (!until || until <= clock) return 0;
  return Math.min(1, (until - clock) / 0.09);
}

/** 화면 흔들림(px) */
export function fxShake(): { x: number; y: number } {
  if (shakeT <= 0 || shakeMag <= 0) return { x: 0, y: 0 };
  const f = shakeT / 0.35;
  return {
    x: Math.sin(clock * 71) * shakeMag * f,
    y: Math.cos(clock * 57) * shakeMag * f,
  };
}

/* ------------------------------------------------------------------ *
 * 그리기
 * ------------------------------------------------------------------ */

/** 발사체 + 파티클. 부대 위 레이어에서 부른다. tilePx = 타일 화면 크기 */
export function fxDrawWorld(
  ctx: CanvasRenderingContext2D,
  X: (m: number) => number,
  Y: (m: number) => number,
  tilePx: number
): void {
  for (const p of projectiles) {
    if (p.t < 0) continue; // 시차 대기 중
    const q = p.t / p.dur;
    const x = p.x0 + (p.x1 - p.x0) * q;
    const y = p.y0 + (p.y1 - p.y0) * q;
    const lift = p.arc * 4 * q * (1 - q); // 포물선 (화면 위쪽으로)
    const sx = X(x);
    const sy = Y(y - lift);
    ctx.save();
    ctx.translate(sx, sy);
    if (p.kind === 'arrow') {
      // 진행 방향 — 포물선 접선
      const ang = Math.atan2(
        (p.y1 - p.y0) / p.dur - (p.arc * 4 * (1 - 2 * q)) / p.dur,
        (p.x1 - p.x0) / p.dur
      );
      ctx.rotate(ang);
      const img = sprite('obj_arrow');
      const s = tilePx * 0.75;
      // 짧은 잔상 — 빠른 물체가 정지 프레임에서도 읽히게
      ctx.strokeStyle = 'rgba(58,44,30,0.45)';
      ctx.lineWidth = Math.max(1, tilePx * 0.05);
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, 0);
      ctx.lineTo(-s * 0.25, 0);
      ctx.stroke();
      if (img) ctx.drawImage(img, -s / 2, -s / 2, s, s);
      else {
        ctx.strokeStyle = '#5A4632';
        ctx.lineWidth = Math.max(1.2, tilePx * 0.06);
        ctx.beginPath();
        ctx.moveTo(-s / 2, 0);
        ctx.lineTo(s / 2, 0);
        ctx.stroke();
      }
    } else {
      ctx.rotate(p.angle0 + p.spin * p.t);
      const img = sprite('obj_boulder');
      const s = tilePx * 0.42 * (1 + 0.5 * 4 * q * (1 - q)); // 높이 오를 때 살짝 커진다
      if (img) ctx.drawImage(img, -s / 2, -s / 2, s, s);
      else {
        ctx.fillStyle = '#6E655A';
        ctx.beginPath();
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  for (const p of particles) {
    const a = Math.max(0, Math.min(1, p.life / p.ttl));
    ctx.globalAlpha = a;
    if (p.kind === 'flash') {
      // 짧은 섬광 — 커지며 사라지는 마름모
      const r = p.size * (1.6 - a);
      ctx.save();
      ctx.translate(X(p.x), Y(p.y));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = p.color;
      ctx.fillRect(-r / 2, -r / 2, r, r);
      ctx.restore();
    } else {
      const s = p.size;
      ctx.fillStyle = p.color;
      ctx.fillRect(X(p.x) - s / 2, Y(p.y) - s / 2, s, s);
    }
  }
  ctx.globalAlpha = 1;
}

/** 진단·테스트용 — 살아 있는 이펙트 수 */
export function fxStats(): { particles: number; projectiles: number; numbers: number } {
  return { particles: particles.length, projectiles: projectiles.length, numbers: numbers.length };
}

// 개발 중 콘솔에서 이펙트 상태를 들여다보는 훅 (프로덕션 번들에서는 제거된다)
let lastState: FieldState | null = null;
function fxProbe(): unknown {
  if (!lastState) return null;
  const sg = lastState.siegeState;
  const siege = sg
    ? {
        wall: Math.round(sg.wallHp), gate: Math.round(sg.gateHp),
        prevWall: Math.round(prevWall), prevGate: Math.round(prevGate),
        assaultIn: Math.round((assaultUntil - clock) * 10) / 10,
        nextBoulderIn: Math.round((nextBoulder - clock) * 10) / 10,
        gateAssault,
      }
    : null;
  return { siege, nums: numbers.map((n) => ({ t: n.text, c: n.color })), arc: lastState.units
    .filter((u) => u.troop === 'arc' && !u.dead)
    .map((u) => {
      const v = lastState!.units.find((w) => w.id === u.target);
      return {
        id: u.id, reserve: u.reserve, target: u.target,
        dist: v ? Math.round(Math.hypot(v.x - u.x, v.y - u.y)) : null,
        range: unitRange(u),
        hurtAgo: v ? Math.round((clock - (hurtRecent.get(v.id) ?? -999)) * 10) / 10 : null,
      };
    }) };
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as { __fxStats?: typeof fxStats; __fxProbe?: typeof fxProbe };
  w.__fxStats = fxStats;
  w.__fxProbe = fxProbe;
}

/** 피해 숫자 — 최상단 레이어 */
export function fxDrawNumbers(
  ctx: CanvasRenderingContext2D,
  X: (m: number) => number,
  Y: (m: number) => number
): void {
  for (const n of numbers) {
    const q = n.t / n.dur;
    const a = q > 0.7 ? (1 - q) / 0.3 : 1;
    const size = n.big ? 15 : 11;
    ctx.globalAlpha = a;
    ctx.font = `${n.big ? 700 : 600} ${size}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const sx = X(n.x);
    const sy = Y(n.y) - 20 - q * 26;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(24,20,16,0.85)';
    ctx.strokeText(n.text, sx, sy);
    ctx.fillStyle = n.color;
    ctx.fillText(n.text, sx, sy);
  }
  ctx.globalAlpha = 1;
}
