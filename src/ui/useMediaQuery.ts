/**
 * useMediaQuery.ts — 화면이 어떤 종류인지 컴포넌트가 직접 묻는다.
 *
 * 왜 CSS 만으로 안 되는가: 폰에서 창(窓)은 「좁아진 창」이 아니라 아예
 * 바텀 시트가 된다 — 끄는 축이 가로에서 세로로 바뀌고, 자유 좌표가 스냅
 * 3단으로 바뀐다. 이것은 모양이 아니라 동작이라 CSS 로는 표현할 수 없다.
 * C단계에서 CSS 로 강제하려다 `!important` 가 드래그의 인라인 스타일을
 * 이겨 창이 안 끌리는 버그를 만들었다(M1 커밋에서 걷어냈다).
 *
 * 기준은 tokens.css 상단에 적어 둔 것과 같다.
 */

import { useEffect, useState } from 'react';

/** 손 화면. 761~1100 은 「좁은 화면」이라 창을 그대로 끈다. */
export const PHONE = '(max-width: 760px)';
/** 손가락. 폭이 아니라 입력 장치로 가른다 — 터치 노트북에서도 맞는다. */
export const COARSE = '(pointer: coarse)';

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    // 훅이 붙는 사이에 폭이 바뀌었을 수 있다.
    setMatch(mq.matches);
    const on = (e: MediaQueryListEvent) => setMatch(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);

  return match;
}

export const usePhone = (): boolean => useMediaQuery(PHONE);
