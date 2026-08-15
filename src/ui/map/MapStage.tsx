/**
 * MapStage.tsx — 지도의 조작면(操作面).
 *
 * 팬·줌·핀치·거점 선택의 포인터 처리를 여기서만 한다.
 * 그리는 일은 자식(Terrain / Routes / CastleMarkers …)이 하고,
 * 변환은 useMapView 가 소유한다.
 *
 * 선택을 pointerup 에서 처리하는 이유:
 *   팬을 하려면 setPointerCapture 를 걸어야 하는데, 그러면 click 이벤트가 오지 않는다.
 *   그래서 pointerdown 에서 "무엇을 눌렀는지"를 기억해 두고, 손을 뗄 때
 *   **끌지 않았을 때만** 선택으로 친다 (pipeline/template.html:341-373 과 같은 방식).
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { MapViewApi } from './useMapView';

interface Props {
  api: MapViewApi;
  onSelect: (id: string) => void;
  children: ReactNode;
}

/** 이만큼 움직이면 클릭이 아니라 끌기로 본다 (px) */
const DRAG_THRESHOLD = 3;
const WHEEL_STEP = 1.16;
const KEY_PAN = 60;

export function MapStage({ api, onSelect, children }: Props) {
  const { stageRef, worldRef, zoomAt, zoomCenter, fit, panBy, apply } = api;
  const svgRef = useRef<SVGSVGElement | null>(null);

  // 처음 한 번 전체 보기. 스테이지가 실제 크기를 가진 뒤라야 계산이 선다.
  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let dragMoved = false;
    let lastX = 0;
    let lastY = 0;
    let pinchDist = 0;
    let downId: string | null = null;

    const local = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = stage.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      downId = target?.closest?.('[data-castle-id]')?.getAttribute('data-castle-id') ?? null;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true;
        dragMoved = false;
        lastX = e.clientX;
        lastY = e.clientY;
        stage.classList.add('dragging');
      }
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        /* 캡처를 못 잡아도 팬은 동작한다 */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const [p0, p1] = [...pointers.values()];
        const d = Math.hypot(p0.x - p1.x, p0.y - p1.y);
        if (pinchDist) {
          const [mx, my] = local({ clientX: (p0.x + p1.x) / 2, clientY: (p0.y + p1.y) / 2 });
          zoomAt(mx, my, d / pinchDist);
        }
        pinchDist = d;
        dragMoved = true;
        return;
      }
      if (!dragging) return;

      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true;
      lastX = e.clientX;
      lastY = e.clientY;
      panBy(dx, dy);
    };

    const endPointer = (e: PointerEvent) => {
      if (e.type === 'pointerup' && !dragMoved && downId) onSelect(downId);
      downId = null;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        dragging = false;
        stage.classList.remove('dragging');
      }
    };

    // React 의 onWheel 은 passive 라 preventDefault 를 못 한다. 직접 건다.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(x, y, e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
    };

    const onDoubleClick = (e: MouseEvent) => {
      const [x, y] = local(e);
      zoomAt(x, y, 1.8);
    };

    /**
     * 키보드는 window 가 아니라 스테이지에 건다.
     * 원본 프로토타입은 window 에 걸어 두었는데, 이 게임에는 병력 수를 치는
     * 입력창이 있어 '-' 나 '0' 을 가로채면 안 된다.
     */
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') zoomCenter(1.3);
      else if (e.key === '-') zoomCenter(1 / 1.3);
      else if (e.key === '0') fit();
      else if (e.key === 'ArrowLeft') panBy(KEY_PAN, 0);
      else if (e.key === 'ArrowRight') panBy(-KEY_PAN, 0);
      else if (e.key === 'ArrowUp') panBy(0, KEY_PAN);
      else if (e.key === 'ArrowDown') panBy(0, -KEY_PAN);
      else return;
      e.preventDefault();
    };

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dblclick', onDoubleClick);
    stage.addEventListener('keydown', onKeyDown);
    return () => {
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', endPointer);
      stage.removeEventListener('pointercancel', endPointer);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('dblclick', onDoubleClick);
      stage.removeEventListener('keydown', onKeyDown);
    };
  }, [stageRef, onSelect, zoomAt, zoomCenter, fit, panBy]);

  // 자식이 다시 마운트되면 월드 <g> 가 변환을 잃는다. 그릴 때마다 다시 쓴다.
  useEffect(apply);

  return (
    <div className="map-stage" ref={stageRef} tabIndex={0} aria-label="전략 지도">
      <svg ref={svgRef} className="map-svg">
        <g ref={worldRef}>{children}</g>
      </svg>
    </div>
  );
}
