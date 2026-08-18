/**
 * FieldCanvas.tsx — 전장을 그린다.
 *
 * 문서 §4.12 가 요구하는 것 하나: **숫자를 읽지 않아도 전황이 보여야 한다.**
 * 그래서 부대는 블록이고, 병력이 줄면 블록이 작아진다. 사기가 무너지면
 * 게이지가 진사로 바뀐다. 접전 중인 부대는 서로 선으로 이어진다.
 *
 * Canvas 인 이유는 부대가 최대 24개뿐이어서가 아니라, 48×32 타일을 매 프레임
 * 다시 칠해야 하기 때문이다. SVG 로 1,536개 사각형을 두면 배속에서 무너진다.
 */

import { useEffect, useRef, useState } from 'react';
import { fieldSizeM, tileSize } from '../../core/field/battlefield';
import { unitRange, unitTitle } from '../../core/field/sim';
import type { FieldState, FieldUnit, TerrainCode } from '../../core/field/types';
import { TROOP_MARK } from '../../core/types';
import { T } from '../tokens';
import { TERRAIN_TILE, onSpriteLoad, sprite, unitSpriteName } from './sprites';

/**
 * 지형 색 — 픽셀아트 타일이 없는 코드(바다·성벽 등)와, 에셋 로드 실패 시의
 * 폴백. 지(紙) 팔레트 안에서 명도로만 가른다 — 고지도의 어법이다
 */
const TERRAIN_COLOR: Record<TerrainCode, string> = {
  '.': T.ji,
  r: '#E4D9BE',
  f: '#C3BC98',
  h: '#CFC09C',
  m: '#AFA184',
  X: '#8A7E6C',
  M: '#BFC0A8',
  '=': '#9FB3B0',
  '~': T.su,
  s: T.hae,
  W: '#6E6252',
  G: '#8C7A5E',
  P: '#C6C6B4',
  // §7.1 — 치는 성벽보다 짙게(돌출부), 옹성은 한 단계 옅게, 해자는 물빛
  T: '#5B5044',
  O: '#7E7161',
  D: '#7E9099',
  // 예약 코드 (아직 맵에 없다)
  S: '#D8CBA4',
  B: '#B99C7A',
};

/**
 * 장식 오브젝트 — 지형 위에 얹는 소품. 좌표 해시로 자리를 정하므로
 * 매 프레임 같은 곳에 그려진다 (렌더링 전용, 판정과 무관).
 */
const DECOR: Array<{ code: TerrainCode; name: string; every: number }> = [
  { code: 'f', name: 'obj_pine', every: 7 }, // 숲 — 소나무를 드문드문
  { code: 'm', name: 'obj_rock', every: 9 }, // 산악 — 바위
  { code: 'X', name: 'obj_rock', every: 3 }, // 험지 — 바위를 빽빽하게
];

/** 결정론적 타일 해시 — 장식 배치용 */
const tileHash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

const FACTION_COLOR: Record<string, string> = {
  goguryeo: T.goguryeo,
  baekje: T.baekje,
  silla: T.silla,
  gaya: T.gaya,
};

interface Props {
  state: FieldState;
  /** 다시 그리게 하는 값. 코어가 상태를 제자리에서 고치므로 필요하다 */
  tick: number;
  selected: string | null;
  onSelectUnit: (id: string | null) => void;
  /** 빈 땅을 눌렀다 — 지점 이동 명령에 쓴다 */
  onPickPoint: (x: number, y: number) => void;
}

export function FieldCanvas({ state, tick, selected, onSelectUnit, onPickPoint }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ w: 900, h: 620 });
  // 스프라이트가 도착하면 다시 그린다 — 일시정지 중에도 색 블록이 그림으로 바뀌게
  const [spriteGen, setSpriteGen] = useState(0);
  useEffect(() => onSpriteLoad(() => setSpriteGen((g) => g + 1)), []);

  // 스스로의 크기를 잰다. 부모를 재면 접힌 화면에서 어긋난다 (M단계의 교훈)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const f = state.field;
    const [fw, fh] = fieldSizeM(f);
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(box.w * dpr);
    el.height = Math.round(box.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 픽셀아트 — 확대해도 픽셀이 뭉개지지 않게 스무딩을 끈다
    ctx.imageSmoothingEnabled = false;

    // 전장을 화면에 맞춘다. 가로세로 비를 지킨다
    const k = Math.min(box.w / fw, box.h / fh);
    const ox = (box.w - fw * k) / 2;
    const oy = (box.h - fh * k) / 2;
    const X = (mx: number) => ox + mx * k;
    const Y = (my: number) => oy + my * k;

    ctx.fillStyle = T.hae;
    ctx.fillRect(0, 0, box.w, box.h);

    /* --- 지형 --- */
    const [tw, th] = tileSize(f);
    for (let ty = 0; ty < f.tiles.length; ty++) {
      const row = f.tiles[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const c = row[tx] as TerrainCode;
        // 0.6 을 더해 타일 사이에 흰 선이 생기지 않게 한다
        const rx = X(tx * tw);
        const ry = Y(ty * th);
        const rw = tw * k + 0.6;
        const rh = th * k + 0.6;
        const tileName = TERRAIN_TILE[c];
        const img = tileName ? sprite(tileName) : null;
        if (img) {
          ctx.drawImage(img, rx, ry, rw, rh);
        } else {
          // 에셋이 없거나 아직 안 왔다 — 기존 색 블록으로
          ctx.fillStyle = TERRAIN_COLOR[c] ?? T.ji;
          ctx.fillRect(rx, ry, rw, rh);
        }
      }
    }

    /* --- 장식 오브젝트 — 숲의 소나무, 산·험지의 바위. 판정과 무관한 소품 --- */
    for (let ty = 0; ty < f.tiles.length; ty++) {
      const row = f.tiles[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const c = row[tx] as TerrainCode;
        for (const d of DECOR) {
          if (d.code !== c || tileHash(tx, ty) % d.every !== 0) continue;
          const img = sprite(d.name);
          if (!img) continue;
          ctx.drawImage(img, X(tx * tw), Y(ty * th), tw * k + 0.6, th * k + 0.6);
        }
      }
    }

    /* --- 성문 — 공성전 맵의 성문 자리에 문루를 세운다 (가로 2타일 규격) --- */
    {
      const gate = sprite('obj_gate');
      if (gate) {
        for (let ty = 0; ty < f.tiles.length; ty++) {
          const row = f.tiles[ty];
          for (let tx = 0; tx < row.length; tx++) {
            if (row[tx] !== 'G') continue;
            // 가로로 이어진 성문 묶음의 첫 타일에서 한 번만 그린다
            if (tx > 0 && row[tx - 1] === 'G') continue;
            let span = 1;
            while (tx + span < row.length && row[tx + span] === 'G') span++;
            // obj_gate 는 2:1 비율 — 묶음 폭을 채우되 최소 2타일 폭으로,
            // 중심을 성문에 맞춘다 (성벽 위로 살짝 넘쳐도 문루로 읽힌다)
            const wTiles = Math.max(span, 2);
            const gx = X((tx + span / 2 - wTiles / 2) * tw);
            ctx.drawImage(gate, gx, Y(ty * th), wTiles * tw * k + 0.6, th * k + 0.6);
          }
        }
      }
    }

    /* --- 교전선 — 누가 누구와 **붙어 있는지**. 노리는 것만으로는 긋지 않는다 --- */
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(168,50,50,0.5)';
    for (const u of state.units) {
      if (u.dead || !u.target || u.reserve || u.arriveTick > state.tick) continue;
      const v = state.units.find((x) => x.id === u.target);
      if (!v || v.dead) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > unitRange(u)) continue;
      ctx.beginPath();
      ctx.moveTo(X(u.x), Y(u.y));
      ctx.lineTo(X(v.x), Y(v.y));
      ctx.stroke();
    }

    /*
     * 블록 크기는 화면 폭을 따라간다. 고정 픽셀로 두었더니 폰에서 12개 부대가
     * 서로를 덮어 한자가 안 읽혔다. 데스크톱 900px 을 1.0 으로 잡는다.
     */
    const blockK = Math.max(0.42, Math.min(1.15, box.w / 900));

    /* --- 부대 --- */
    for (const u of state.units) {
      if (u.dead || u.arriveTick > state.tick) continue;
      const ratio = Math.max(0.12, u.troops / u.maxTroops);
      // 병력이 줄면 블록이 작아진다 (§4.12)
      const w = (15 + ratio * 26) * blockK;
      const h = (12 + ratio * 20) * blockK;
      const cx = X(u.x);
      const cy = Y(u.y);

      // 수군은 아직 스프라이트가 없다 — 船 블록을 그대로 쓴다
      const img = u.navy ? null : sprite(unitSpriteName(u.troop, u.faction));

      ctx.globalAlpha = u.reserve ? 0.45 : u.routed ? 0.55 : 1;

      let bottom: number; // 게이지가 시작하는 y — 스프라이트/블록의 아래끝
      if (img) {
        // 스프라이트도 병력을 따라 커지고 작아진다 (§4.12 의 어법 유지)
        const s = (20 + ratio * 22) * blockK;
        ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s);
        if (selected === u.id) {
          ctx.lineWidth = 2.4;
          ctx.strokeStyle = T.jinsa;
          ctx.strokeRect(cx - s / 2 - 1, cy - s / 2 - 1, s + 2, s + 2);
        }
        bottom = cy + s / 2;
      } else {
        // 폴백 — 기존 색 블록 + 병종 한자 (문서 §7 — 이모지 금지)
        ctx.fillStyle = FACTION_COLOR[u.faction] ?? T.meokMid;
        ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
        ctx.lineWidth = selected === u.id ? 2.4 : 1.2;
        ctx.strokeStyle = selected === u.id ? T.jinsa : T.meok;
        ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
        ctx.fillStyle = T.onDark;
        ctx.font = `600 ${Math.round(h * 0.62)}px "Noto Serif KR", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(u.navy ? '船' : TROOP_MARK[u.troop], cx, cy + 0.5);
        bottom = cy + h / 2;
      }

      // 사기 게이지 — 40 아래는 진사 (§4.12). 스프라이트를 가리지 않게 아래에
      const gw = w;
      const gh = Math.max(2, 3 * blockK);
      const gy = bottom + 2 * blockK;
      ctx.fillStyle = T.jiDeep;
      ctx.fillRect(cx - gw / 2, gy, gw, gh);
      ctx.fillStyle = u.morale < 40 ? T.jinsa : T.meokMid;
      ctx.fillRect(cx - gw / 2, gy, (gw * Math.max(0, u.morale)) / 100, gh);

      // 지쳤으면 그 아래 한 줄 더
      if (u.fatigue > 40) {
        ctx.fillStyle = 'rgba(90,81,67,0.5)';
        ctx.fillRect(cx - gw / 2, gy + gh + 1, (gw * u.fatigue) / 100, Math.max(1.5, 2 * blockK));
      }
      ctx.globalAlpha = 1;
    }

    /* --- 고른 부대의 이름표 --- */
    const sel = state.units.find((u) => u.id === selected && !u.dead);
    if (sel) {
      const label = `${sel.name} · ${unitTitle(sel)} · ${Math.round(sel.troops).toLocaleString()}`;
      ctx.font = '11px "Noto Serif KR", serif';
      const tw2 = ctx.measureText(label).width + 12;
      const lx = Math.min(box.w - tw2 - 4, Math.max(4, X(sel.x) - tw2 / 2));
      // 스프라이트 위 여백만큼 띄운다 — 이름표가 그림을 가리지 않게
      const selRatio = Math.max(0.12, sel.troops / sel.maxTroops);
      const selHalf = ((20 + selRatio * 22) * blockK) / 2;
      const ly = Math.max(4, Y(sel.y) - selHalf - 24);
      ctx.fillStyle = 'rgba(221,208,178,0.94)';
      ctx.fillRect(lx, ly, tw2, 18);
      ctx.strokeStyle = T.meok;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx, ly, tw2, 18);
      ctx.fillStyle = T.meok;
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 6, ly + 9);
    }
  }, [state, tick, selected, box, spriteGen]);

  /** 화면 좌표 → 전장 미터 */
  const toField = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const f = state.field;
    const [fw, fh] = fieldSizeM(f);
    const k = Math.min(r.width / fw, r.height / fh);
    const ox = (r.width - fw * k) / 2;
    const oy = (r.height - fh * k) / 2;
    return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k };
  };

  const nearestUnit = (x: number, y: number): FieldUnit | null => {
    let best: FieldUnit | null = null;
    let bd = Infinity;
    for (const u of state.units) {
      if (u.dead || u.arriveTick > state.tick) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    // 260m 안쪽이면 그 부대를 고른 것으로 본다 (부대 정면 폭 정도)
    return bd < 260 ? best : null;
  };

  return (
    <canvas
      ref={ref}
      className="field-canvas"
      onPointerDown={(e) => {
        const p = toField(e);
        const u = nearestUnit(p.x, p.y);
        if (u) onSelectUnit(u.id);
        else onPickPoint(p.x, p.y);
      }}
      aria-label="전장"
    />
  );
}
