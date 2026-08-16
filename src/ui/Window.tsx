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
 *
 * 폰(≤760px)에서는 같은 컴포넌트가 **바텀 시트**가 된다. 390px 화면에서
 * 자유 좌표로 떠 있는 창은 성립하지 않는다 — 어디에 두어도 지도를 다 가린다.
 * 대신 아래에 붙여 놓고 위아래로 끌어 3단으로 여닫는다. 끄는 축과 스냅이
 * 달라지는 것은 모양이 아니라 동작이라 CSS 로는 못 하고 여기서 갈라야 한다.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePhone } from './useMediaQuery';

export interface WindowProps {
  /** localStorage 키이자 창 식별자 */
  id: string;
  title: string;
  /** 기본 위치. 음수면 반대쪽 가장자리 기준 (right / bottom) */
  x: number;
  y: number;
  width: number;
  /** 본문 최대 높이. 넘치면 본문만 스크롤한다. 시트에서는 스냅이 대신한다 */
  maxHeight?: number;
  onClose?: () => void;
  /** 머리 오른쪽에 놓을 것 (탭 등) */
  head?: ReactNode;
  /**
   * 값이 바뀌면 접혀 있던 시트를 「절반」까지 올린다.
   * 지도에서 거점을 골랐는데 시트가 엿보기 단이면 아무 일도 없는 것처럼 보인다.
   * 데스크톱 창에는 뜻이 없다.
   */
  raiseKey?: number;
  /**
   * 값이 바뀌면 시트를 「엿보기」로 접는다.
   * 「전체」 버튼처럼 지도를 다 보여 줘야 하는 동작이 부를 자리다.
   */
  collapseKey?: number;
  /**
   * 스냅이 확정됐을 때의 시트 높이(px). 폰이 아니면 0.
   *
   * **끄는 도중에는 안 부른다** — 손가락을 따라 매 프레임 부모를 다시 그리면
   * 거점 76개가 같이 딸려 온다. 지도가 필요한 것은 확정된 높이뿐이다.
   */
  onHeight?: (h: number) => void;
  children: ReactNode;
}

interface Pos {
  x: number;
  y: number;
}

const STORE_KEY = 'samhanji.windows.v1';
const SNAP_KEY = 'samhanji.sheets.v1';
/** 창이 화면 밖으로 완전히 사라지지 않도록 남겨 두는 폭 */
const KEEP_VISIBLE = 80;

/**
 * 시트 3단. 「엿보기」는 머리만 남기고 지도를 다 내준다 —
 * 출진할 곳을 지도에서 고르는 동안 필요한 상태다.
 */
type Snap = 0 | 1 | 2;
/** 「엿보기」 단의 높이. 접었을 때 지도가 얼마나 가리는지를 지도 쪽도 알아야 한다. */
export const SHEET_PEEK = 56;
function snapHeights(vh: number): [number, number, number] {
  return [SHEET_PEEK, Math.round(vh * 0.45), Math.round(vh * 0.88)];
}
/** MapStage 와 같은 임계값. 누른 것인지 끈 것인지 가른다. */
const DRAG_THRESHOLD = 3;

let topZ = 20;

function loadJson<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}

function saveEntry(key: string, id: string, value: unknown): void {
  try {
    const all = loadJson<unknown>(key);
    all[id] = value;
    localStorage.setItem(key, JSON.stringify(all));
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
  raiseKey,
  collapseKey,
  onHeight,
  children,
}: WindowProps) {
  const phone = usePhone();
  const [pos, setPos] = useState<Pos>(() => {
    const saved = loadJson<Pos>(STORE_KEY)[id];
    return clampToViewport(saved ?? resolveDefault(x, y, width), width);
  });
  const [snap, setSnap] = useState<Snap>(() => {
    const saved = loadJson<number>(SNAP_KEY)[id];
    return saved === 0 || saved === 1 || saved === 2 ? saved : 1;
  });
  /** 끄는 동안의 실시간 높이. 손을 떼면 null 로 돌아가고 스냅이 맡는다. */
  const [dragH, setDragH] = useState<number | null>(null);
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  const [z, setZ] = useState(() => ++topZ);
  const ref = useRef<HTMLDivElement | null>(null);

  const toFront = useCallback(() => setZ(++topZ), []);

  /* --- 데스크톱: 머리를 잡고 끌어 옮긴다 --- */
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
          saveEntry(STORE_KEY, id, p);
          return p;
        });
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    },
    [pos, width, id, toFront]
  );

  /* --- 폰: 머리가 손잡이다. 위아래로 끌면 스냅이 바뀐다 --- */
  const onGripPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const t = e.target as HTMLElement;
      // 닫기와 탭은 누르는 것이지 끄는 것이 아니다.
      if (t.closest('.win-x') || t.closest('.tabs')) return;
      e.preventDefault();
      toFront();
      const heights = snapHeights(vh);
      const startY = e.clientY;
      const startH = heights[snap];
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      let moved = false;
      let live = startH;

      const move = (ev: PointerEvent) => {
        const dy = startY - ev.clientY; // 위로 끌면 커진다
        if (!moved && Math.abs(dy) > DRAG_THRESHOLD) moved = true;
        if (!moved) return;
        live = Math.min(Math.max(startH + dy, SHEET_PEEK), heights[2]);
        setDragH(live);
      };
      const up = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        setDragH(null);
        // 끌었으면 가장 가까운 단으로, 그냥 눌렀으면 접기/펴기 토글.
        let next: Snap;
        if (moved) {
          let best: Snap = 0;
          for (const i of [1, 2] as const) {
            if (Math.abs(heights[i] - live) < Math.abs(heights[best] - live)) best = i;
          }
          next = best;
        } else {
          next = snap === 0 ? 1 : 0;
        }
        setSnap(next);
        saveEntry(SNAP_KEY, id, next);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    },
    [snap, vh, id, toFront]
  );

  // 바깥에서 「올려 달라」고 하면 접혀 있을 때만 절반까지 올린다.
  // 이미 펼쳐 놓은 것을 함부로 줄이지는 않는다.
  useEffect(() => {
    if (raiseKey === undefined) return;
    setSnap((s) => (s === 0 ? 1 : s));
  }, [raiseKey]);

  // 「접어 달라」. 첫 렌더에는 반응하지 않는다 — 저장해 둔 단을 덮어쓰면 안 된다.
  const firstCollapse = useRef(collapseKey);
  useEffect(() => {
    if (collapseKey === undefined || collapseKey === firstCollapse.current) return;
    setSnap(0);
    saveEntry(SNAP_KEY, id, 0);
  }, [collapseKey, id]);

  /**
   * 폰의 ✕ 는 창을 없애는 것이 아니라 **엿보기로 접는 것**이다.
   * 시트 머리의 탭 줄이 폰의 유일한 이동 수단이라 통째로 치우면 갈 곳이 없어진다.
   * 접은 다음 바깥(onClose)에 알려 지도가 전체 보기로 돌아가게 한다.
   */
  const closeSheet = useCallback(() => {
    setSnap(0);
    saveEntry(SNAP_KEY, id, 0);
    onClose?.();
  }, [id, onClose]);

  /*
   * 시트가 얼마나 올라와 있는지를 CSS 로 흘려보낸다. 지도 HUD(줌 위젯)가
   * 그 위에 얹혀 있어야 하기 때문이다 — 고정 위치로 두었더니 기본 단(절반)에서
   * 통째로 가려져 폰에서는 확대·축소를 아예 누를 수 없었다.
   */
  const sheetH = phone ? (dragH ?? snapHeights(vh)[snap]) : 0;
  /*
   * useEffect 가 아니라 useLayoutEffect 다. 「전체 보기」는 시트를 접은 **뒤의**
   * 높이를 기준으로 지도를 맞춰야 하는데, 보통 효과로 두면 그 값이 다음 프레임에나
   * 쓰여 지도가 아직 절반쯤 가려진 화면 기준으로 축소된다(실측: 31% 대신 21%).
   */
  useLayoutEffect(() => {
    if (!phone) return;
    const root = document.documentElement;
    root.style.setProperty('--sheet-h', `${sheetH}px`);
    return () => {
      root.style.removeProperty('--sheet-h');
    };
  }, [phone, sheetH]);

  // 확정된 높이만 바깥에 알린다 (dragH 는 일부러 뺐다 — 위 주석 참조).
  const settledH = phone ? snapHeights(vh)[snap] : 0;
  useEffect(() => {
    onHeight?.(settledH);
  }, [settledH, onHeight]);

  // 창 크기가 바뀌면 화면 밖에 남아 있을 수 있다. 시트는 높이 기준이 달라진다.
  useEffect(() => {
    const onResize = () => {
      setVh(window.innerHeight);
      setPos((p) => clampToViewport(p, width));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [width]);

  const closeBtn = onClose && (
    <button className="win-x" onClick={onClose} aria-label={`${title} 창 닫기`} title="닫기" />
  );

  if (phone) {
    return (
      <div
        className={`win sheet${dragH === null ? '' : ' dragging'}`}
        ref={ref}
        style={{ height: sheetH, zIndex: z }}
        onPointerDown={toFront}
      >
        <div className="win-hd" onPointerDown={onGripPointerDown}>
          <span className="grip" aria-hidden="true" />
          <b>{title}</b>
          {head}
          {onClose && (
            <button
              className="win-x"
              onClick={closeSheet}
              aria-label="창 접고 전체 지도 보기"
              title="접기"
            />
          )}
        </div>
        <div className="win-bd">{children}</div>
      </div>
    );
  }

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
        {closeBtn}
      </div>
      <div className="win-bd" style={maxHeight ? { maxHeight } : undefined}>
        {children}
      </div>
    </div>
  );
}
