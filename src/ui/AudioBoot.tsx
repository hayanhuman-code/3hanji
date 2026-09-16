/**
 * AudioBoot.tsx — 소리를 깨우고, 화면에 맞는 배경음을 건다. 아무것도 그리지 않는다.
 *
 * 두 가지를 여기 모은 이유:
 *
 * ① **자동재생 정책.** 브라우저는 사람이 손을 대기 전에는 소리를 내주지 않는다.
 *    버튼마다 unlock 을 부르는 대신 문서 맨 위에서 첫 손짓 한 번을 받는다.
 *
 * ② **누르는 소리.** 버튼이 수십 개인데 하나하나 붙이면 새 버튼을 만들 때마다
 *    빠뜨린다. 클릭을 위임으로 받아 `button` 이면 소리를 낸다. 소리를 내지
 *    않아야 하는 버튼은 `data-sfx="off"` 를 단다 — 예외가 표에 적히는 셈이다.
 */

import { useEffect } from 'react';
import { play, setTrack, unlock, getSettings, onSettings } from './audio';
import { useGame } from './store';

export function AudioBoot() {
  const screen = useGame((s) => s.screen);
  const field = useGame((s) => s.field);
  const state = useGame((s) => s.state);

  // ① 첫 손짓에서 깨운다. 한 번이면 되므로 곧바로 뗀다.
  useEffect(() => {
    const wake = () => unlock();
    const opts = { once: true, capture: true } as const;
    document.addEventListener('pointerdown', wake, opts);
    document.addEventListener('keydown', wake, opts);
    document.addEventListener('touchstart', wake, opts);
    return () => {
      document.removeEventListener('pointerdown', wake, true);
      document.removeEventListener('keydown', wake, true);
      document.removeEventListener('touchstart', wake, true);
    };
  }, []);

  // ② 누르는 소리 — 위임으로 한 자리에서 받는다.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('button, .btn');
      if (!el || el.getAttribute('data-sfx') === 'off') return;
      if (el instanceof HTMLButtonElement && el.disabled) return;
      play('click');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  /*
   * 화면이 배경음을 정한다.
   *   시작 화면        → 북 없는 가락
   *   전장(둘 다 포함) → 자진모리
   *   전략 지도        → 진양조, 내 나라의 악기로
   *
   * 세력을 함께 넘기는 이유: 고구려로 하는 판과 신라로 하는 판은 다른 소리가
   * 나야 한다 (`bgm.ts` 의 VOICE — 세력색을 고른 근거와 같은 자리에서 왔다).
   */
  useEffect(() => {
    const who = state?.playerFaction ?? 'silla';
    if (screen === 'field' || field) setTrack('battle', who);
    else if (screen === 'game') setTrack('map', who);
    else setTrack('title', who);
  }, [screen, field, state?.playerFaction]);

  // 설정에서 배경음을 다시 켜면 그 자리에서 이어져야 한다.
  useEffect(
    () =>
      onSettings((s) => {
        if (!s.bgm) return;
        const who = state?.playerFaction ?? 'silla';
        setTrack(screen === 'field' || field ? 'battle' : screen === 'game' ? 'map' : 'title', who);
      }),
    [screen, field, state?.playerFaction]
  );

  // 탭을 떠나 있는 동안 계속 울리면 성가시다. 돌아오면 다시 건다.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !getSettings().bgm) return;
      unlock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return null;
}
