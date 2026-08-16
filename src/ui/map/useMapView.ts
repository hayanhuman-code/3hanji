/**
 * useMapView.ts — 전략맵의 뷰 변환(확대·이동)을 혼자 소유한다.
 *
 * 왜 React 상태가 아니라 ref 인가:
 *   포인터를 끌 때마다 상태를 바꾸면 거점 76개와 길 141개가 매 프레임 다시 그려진다.
 *   변환은 DOM 속성 하나(`transform`)면 되므로, 뷰는 ref 에 두고 직접 쓴다.
 *   React 로 흘려보내는 것은 배율 숫자 하나뿐이다(줌 위젯 표시용).
 *
 * 좌표계:
 *   SVG 에 viewBox 를 쓰지 않는다. 월드 <g> 에 translate(tx,ty) scale(k) 를 걸고
 *   tx·ty 를 **화면 픽셀**로 다룬다. 그래야 "포인터 아래 지점을 고정한 채 확대"와
 *   "지도가 화면 밖으로 못 나가게" 하는 계산이 성립한다.
 *   구현은 pipeline/template.html 에서 검증된 것을 옮긴 것이다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 지도에서 실제로 쓰는 범위 (거점이 놓인 자리 + 여백). 지도 캔버스 전체가 아니다. */
export interface ContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface View {
  k: number;
  tx: number;
  ty: number;
  minK: number;
  maxK: number;
}

export interface MapViewApi {
  /** 스테이지(팬·줌을 받는 div) */
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** 변환이 걸리는 월드 <g> */
  worldRef: React.RefObject<SVGGElement | null>;
  view: React.RefObject<View>;
  /** 화면상 배율 (%). 이것만 React 로 흘린다. */
  zoom: number;
  /** 포인터 위치(스테이지 기준 px)를 고정점으로 확대·축소 */
  zoomAt: (px: number, py: number, factor: number) => void;
  /** 화면 중앙 기준 확대·축소 */
  zoomCenter: (factor: number) => void;
  /** 전체 보기 */
  fit: () => void;
  /** 지도 좌표를 화면 중앙으로 */
  centerOn: (x: number, y: number) => void;
  /** 가장자리 가까이 있거나 화면 밖이면 중앙으로 당긴다 */
  ensureVisible: (x: number, y: number) => void;
  /** 화면 픽셀만큼 이동 */
  panBy: (dx: number, dy: number) => void;
  /** 뷰가 바뀔 때마다 불리는 곳에 붙일 수 있는 훅 (라벨 단계 노출 등) */
  onApply: React.RefObject<((v: View) => void) | null>;
  /** 변환을 다시 쓴다 (레이어가 새로 마운트됐을 때) */
  apply: () => void;
}


export function useMapView(content: ContentBox): MapViewApi {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<SVGGElement | null>(null);
  const view = useRef<View>({ k: 1, tx: 0, ty: 0, minK: 0.2, maxK: 6 });
  const onApply = useRef<((v: View) => void) | null>(null);

  const [zoom, setZoom] = useState(100);
  // 배율 표시는 매 프레임 리렌더할 필요가 없다. 프레임마다 한 번으로 합친다.
  // (시간 스로틀을 쓰면 첫 화면에서 fit() 이 걸러져 100% 로 굳는다.)
  const readoutQueued = useRef(false);

  const stageSize = useCallback((): [number, number] => {
    const el = stageRef.current;
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    return [r.width, r.height];
  }, []);

  /**
   * 쓰는 범위가 화면보다 작으면 가운데로, 크면 그 범위 밖으로 나가지 못하게.
   *
   * 지도 캔버스(1760×2049)가 아니라 **거점이 놓인 범위**를 기준으로 삼는다.
   * 캔버스 기준으로 잡으면 요서 쪽 빈 바다까지 끌고 다니게 된다.
   */
  const clampView = useCallback(() => {
    const v = view.current;
    const [w, h] = stageSize();
    const cw = content.w * v.k;
    const ch = content.h * v.k;
    v.tx =
      cw <= w
        ? (w - cw) / 2 - content.x * v.k
        : Math.min(-content.x * v.k, Math.max(w - (content.x + content.w) * v.k, v.tx));
    v.ty =
      ch <= h
        ? (h - ch) / 2 - content.y * v.k
        : Math.min(-content.y * v.k, Math.max(h - (content.y + content.h) * v.k, v.ty));
  }, [content, stageSize]);

  const apply = useCallback(() => {
    const v = view.current;
    worldRef.current?.setAttribute('transform', `translate(${v.tx},${v.ty}) scale(${v.k})`);
    onApply.current?.(v);
    if (!readoutQueued.current) {
      readoutQueued.current = true;
      requestAnimationFrame(() => {
        readoutQueued.current = false;
        setZoom(Math.round(view.current.k * 100));
      });
    }
  }, []);

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      const v = view.current;
      const nk = Math.max(v.minK, Math.min(v.maxK, v.k * factor));
      const ratio = nk / v.k;
      // 포인터 아래의 지도 지점이 그 자리에 머물도록 평행이동을 함께 옮긴다.
      v.tx = px - (px - v.tx) * ratio;
      v.ty = py - (py - v.ty) * ratio;
      v.k = nk;
      clampView();
      apply();
    },
    [clampView, apply]
  );

  const zoomCenter = useCallback(
    (factor: number) => {
      const [w, h] = stageSize();
      zoomAt(w / 2, h / 2, factor);
    },
    [stageSize, zoomAt]
  );

  const fit = useCallback(() => {
    const v = view.current;
    const [w, h] = stageSize();
    if (w === 0 || h === 0) return;
    v.k = Math.min(w / content.w, h / content.h) * 0.98;
    // 전체 보기보다 더 줄이면 빈 바다만 보인다. 하한을 여기서 묶는다.
    v.minK = v.k * 0.92;
    v.tx = (w - content.w * v.k) / 2 - content.x * v.k;
    v.ty = (h - content.h * v.k) / 2 - content.y * v.k;
    apply();
  }, [content, stageSize, apply]);

  const centerOn = useCallback(
    (x: number, y: number) => {
      const v = view.current;
      const [w, h] = stageSize();
      // 너무 축소된 상태에서 부르면 어디를 보는지 알 수 없다. 최소한 이만큼은 당긴다.
      v.k = Math.max(v.k, 0.62);
      v.tx = w / 2 - x * v.k;
      v.ty = h / 2 - y * v.k;
      clampView();
      apply();
    },
    [stageSize, clampView, apply]
  );

  const ensureVisible = useCallback(
    (x: number, y: number) => {
      const v = view.current;
      const [w, h] = stageSize();
      const sx = v.tx + x * v.k;
      const sy = v.ty + y * v.k;
      // 고정 80px 은 데스크톱에서는 여백이지만 390px 폰에서는 화면의 20% 라,
      // 가장자리 근처의 거점을 고를 때마다 지도가 필요 없이 다시 가운데로 뛴다.
      // 화면 크기에 비례하게 하되 위아래로 묶는다.
      const margin = Math.max(24, Math.min(80, Math.min(w, h) * 0.1));
      if (sx < margin || sx > w - margin || sy < margin || sy > h - margin) {
        v.tx = w / 2 - x * v.k;
        v.ty = h / 2 - y * v.k;
        clampView();
        apply();
      }
    },
    [stageSize, clampView, apply]
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = view.current;
      v.tx += dx;
      v.ty += dy;
      clampView();
      apply();
    },
    [clampView, apply]
  );

  // 창 크기가 바뀌면 지도가 화면 밖에 남아 있을 수 있다.
  useEffect(() => {
    const onResize = () => {
      clampView();
      apply();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampView, apply]);

  return {
    stageRef,
    worldRef,
    view,
    zoom,
    zoomAt,
    zoomCenter,
    fit,
    centerOn,
    ensureVisible,
    panBy,
    onApply,
    apply,
  };
}
