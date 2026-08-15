/**
 * Window.tsx — 지도 위에 떠 있는 창(窓).
 *
 * 문서 §4: "지도는 화면 전체를 쓰고, UI 는 그 위에 떠 있는 독립 창으로 얹는다.
 *           사이드바로 지도를 자르지 않는다."
 *
 * 구현은 pipeline/template.html 의 `.win` / `.win-hd` / `.win-x` 를 옮긴 것이다.
 *
 * 위치를 localStorage 에 남기는 이유: 창을 편한 자리로 옮겨 놓고 턴을 넘겼는데
 * 제자리로 돌아오면 옮길 이유가 없어진다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface WindowProps {
  /** localStorage 키이자 창 식별자 */
  id: string;
  title: string;
  /** 기본 위치. 음수면 반대쪽 가장자리 기준 (right / bottom) */
  x: number;
  y: number;
  width: number;
  /** 본문 최대 높이. 넘치면 본문만 스크롤한다 */
  maxHeight?: number;
  onClose?: () => void;
  /** 머리 오른쪽에 놓을 것 (탭 등) */
  head?: ReactNode;
  children: ReactNode;
}

interface Pos {
  x: number;
  y: number;
}

const STORE_KEY = 'samhanji.windows.v1';
/** 창이 화면 밖으로 완전히 사라지지 않도록 남겨 두는 폭 */
const KEEP_VISIBLE = 80;

let topZ = 20;

function loadPositions(): Record<string, Pos> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function savePosition(id: string, pos: Pos): void {
  try {
    const all = loadPositions();
    all[id] = pos;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* 사생활 보호 모드 등에서 막힐 수 있다. 위치만 못 남길 뿐이다. */
  }
}

/** 음수 좌표는 반대쪽 가장자리 기준으로 푼다. */
function resolveDefault(x: number, y: number, width: number): Pos {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: x >= 0 ? x : Math.max(8, w - width + x),
    y: y >= 0 ? y : Math.max(8, h + y),
  };
}

function clampToViewport(pos: Pos, width: number): Pos {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: Math.min(Math.max(pos.x, KEEP_VISIBLE - width), w - KEEP_VISIBLE),
    y: Math.min(Math.max(pos.y, 0), h - 40),
  };
}

export function Window({
  id,
  title,
  x,
  y,
  width,
  maxHeight,
  onClose,
  head,
  children,
}: WindowProps) {
  const [pos, setPos] = useState<Pos>(() => {
    const saved = loadPositions()[id];
    return clampToViewport(saved ?? resolveDefault(x, y, width), width);
  });
  const [z, setZ] = useState(() => ++topZ);
  const ref = useRef<HTMLDivElement | null>(null);

  const toFront = useCallback(() => setZ(++topZ), []);

  /* --- 머리를 잡고 끌기 --- */
  const onHeadPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 닫기 버튼을 눌렀으면 끌지 않는다.
      if ((e.target as HTMLElement).closest('.win-x')) return;
      e.preventDefault();
      toFront();
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = pos;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        setPos(
          clampToViewport(
            { x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) },
            width
          )
        );
      };
      const up = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        setPos((p) => {
          savePosition(id, p);
          return p;
        });
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    },
    [pos, width, id, toFront]
  );

  // 창 크기가 바뀌면 화면 밖에 남아 있을 수 있다.
  useEffect(() => {
    const onResize = () => setPos((p) => clampToViewport(p, width));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [width]);

  return (
    <div
      className="win"
      ref={ref}
      style={{ left: pos.x, top: pos.y, width, zIndex: z }}
      onPointerDown={toFront}
    >
      <div className="win-hd" onPointerDown={onHeadPointerDown}>
        <b>{title}</b>
        {head}
        {onClose && (
          <button className="win-x" onClick={onClose} aria-label={`${title} 창 닫기`} title="닫기" />
        )}
      </div>
      <div className="win-bd" style={maxHeight ? { maxHeight } : undefined}>
        {children}
      </div>
    </div>
  );
}
