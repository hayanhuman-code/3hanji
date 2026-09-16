/**
 * sfx.ts — 효과음 목록.
 *
 * 이름 하나가 소리 하나다. 호출부는 `play('turn')` 만 알면 되고,
 * 그것이 무슨 악기로 어떻게 나는지는 여기서만 정한다.
 *
 * 세기의 기준 (섞일 때 서로를 덮지 않게 미리 층을 갈라 둔다):
 *   0.10~0.20  창 여닫기·누르기 — 있는지 모를 만큼
 *   0.25~0.40  확정·거절·선택
 *   0.50~0.70  턴 넘김·출진·이벤트
 *   0.80~1.00  전투 개시·함락·승패 — 판이 바뀌는 순간에만
 */

import { audioContext, sfxDestination, unlock } from './engine';
import { ajaeng, buk, gayageum, jing, paperSlide, pyeongyeong, woodTap } from './voices';

export type SfxName =
  | 'click' // 버튼
  | 'open' // 창·시트 열기
  | 'close' // 창·시트 닫기
  | 'confirm' // 명령 확정
  | 'deny' // 거절당함
  | 'select' // 거점·인물 고르기
  | 'turn' // 턴 종료 (계절이 넘어간다)
  | 'march' // 출진
  | 'battle' // 전투 개시
  | 'capture' // 함락
  | 'event' // 역사 이벤트 등장
  | 'victory'
  | 'defeat';

/** 마지막으로 낸 시각. 같은 소리가 겹쳐 터지는 것을 막는다. */
const lastAt = new Map<SfxName, number>();
/** 이 간격 안에 같은 소리가 또 오면 버린다(초) */
const DEBOUNCE: Partial<Record<SfxName, number>> = {
  click: 0.04,
  select: 0.05,
  open: 0.08,
  close: 0.08,
};

export function play(name: SfxName): void {
  const ctx = audioContext();
  const dest = sfxDestination();
  if (!ctx || !dest) return;

  const t = ctx.currentTime;
  const gap = DEBOUNCE[name];
  if (gap !== undefined && t - (lastAt.get(name) ?? -99) < gap) return;
  lastAt.set(name, t);

  // 아주 조금 뒤로 미룬다. currentTime 에 바로 예약하면 첫 파형이 잘려 딸깍거린다.
  const t0 = t + 0.012;

  switch (name) {
    case 'click':
      woodTap(ctx, dest, t0, 0.14);
      break;

    case 'select':
      pyeongyeong(ctx, dest, t0, { freq: 880, dur: 0.5, gain: 0.16 });
      break;

    case 'open':
      paperSlide(ctx, dest, t0, 0.2, true);
      break;

    case 'close':
      paperSlide(ctx, dest, t0, 0.2, false);
      break;

    case 'confirm':
      // 두 음이 올라간다 — 「되었다」
      gayageum(ctx, dest, t0, { freq: 392, dur: 0.5, gain: 0.3 });
      gayageum(ctx, dest, t0 + 0.09, { freq: 587.33, dur: 0.7, gain: 0.26, bend: true });
      break;

    case 'deny':
      // 눌린 저음 하나. 올라가지 않는다 — 「아니다」
      ajaeng(ctx, dest, t0, { freq: 116.54, dur: 0.42, gain: 0.32 });
      break;

    case 'turn':
      // 북 둘에 대금 한 음. 계절이 한 칸 넘어간다.
      buk(ctx, dest, t0, 0.5);
      buk(ctx, dest, t0 + 0.26, 0.32);
      gayageum(ctx, dest, t0 + 0.42, { freq: 293.66, dur: 1.1, gain: 0.3, bend: true });
      break;

    case 'march':
      // 북이 셋으로 몰아가고 아쟁이 낮게 깔린다.
      for (let i = 0; i < 3; i++) buk(ctx, dest, t0 + i * 0.15, 0.5 - i * 0.06);
      ajaeng(ctx, dest, t0 + 0.1, { freq: 146.83, dur: 1.2, gain: 0.34, bend: true });
      break;

    case 'battle':
      jing(ctx, dest, t0, 0.85);
      buk(ctx, dest, t0 + 0.34, 0.6);
      buk(ctx, dest, t0 + 0.52, 0.45);
      break;

    case 'capture':
      // 징 하나에 내려앉는 두 음. 성이 넘어갔다.
      jing(ctx, dest, t0, 0.7);
      ajaeng(ctx, dest, t0 + 0.2, { freq: 174.61, dur: 1.4, gain: 0.34 });
      ajaeng(ctx, dest, t0 + 0.75, { freq: 130.81, dur: 1.8, gain: 0.3, bend: true });
      break;

    case 'event':
      // 편경 셋 — 사서가 펼쳐진다
      pyeongyeong(ctx, dest, t0, { freq: 523.25, dur: 1.4, gain: 0.3 });
      pyeongyeong(ctx, dest, t0 + 0.13, { freq: 698.46, dur: 1.5, gain: 0.26 });
      pyeongyeong(ctx, dest, t0 + 0.3, { freq: 880, dur: 1.9, gain: 0.22 });
      break;

    case 'victory':
      jing(ctx, dest, t0, 0.9);
      // 평조로 올라간다 — 황 태 중 임
      [261.63, 293.66, 349.23, 392].forEach((f, i) =>
        gayageum(ctx, dest, t0 + 0.3 + i * 0.2, { freq: f, dur: 1.2, gain: 0.32, bend: i === 3 })
      );
      break;

    case 'defeat':
      jing(ctx, dest, t0, 0.6);
      // 계면조로 내려간다 — 임 중 협 황
      [196, 174.61, 155.56, 130.81].forEach((f, i) =>
        ajaeng(ctx, dest, t0 + 0.25 + i * 0.42, { freq: f, dur: 1.4, gain: 0.3, bend: true })
      );
      break;
  }
}

/**
 * 첫 손짓에서 컨텍스트를 깨우고 그 소리까지 낸다.
 * `unlock()` 은 여러 번 불러도 안전하므로 호출부가 상태를 들고 있을 필요가 없다.
 */
export function playWithUnlock(name: SfxName): void {
  unlock();
  play(name);
}
