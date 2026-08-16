/**
 * BattleScreen.tsx — 전술 전투 화면 (시스템 상세계획 §4 ⑤)
 *
 * 헥스 맵은 Canvas 로 그린다. 이 화면은 전략맵 없이도 뜬다 —
 * 전투 시뮬레이터(sandbox)와 실제 전투가 같은 컴포넌트를 쓴다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { factionColor, factionName, unitDef } from '../core/data';
import { T, textOn } from './tokens';
import {
  attackableUnits,
  attackableWalls,
  reachable,
} from '../core/battle/battleEngine';
import { livingUnits, sideTroops, type BattleUnit } from '../core/battle/battleState';
import { hexCorners, hexToPixel, pixelToHex, type Axial } from '../core/battle/hex';
import type { HexTerrain } from '../core/types';
import { fmt } from '../core/util';
import { useGame } from './store';

/**
 * 헥스 지형색 — 지(紙) 팔레트 안에서 **명도로만** 가른다.
 * 밝을수록 트인 땅, 어두울수록 막힌 땅. 성벽·성문·본성은 먹 계열로 올려
 * 지형과 인공물이 한눈에 갈리게 했다.
 *
 * 색만으로 정보를 전달하지 않는다(문서 §7) — 칸에 지형 이름을 함께 쓰고
 * 범례에도 이름을 단다.
 */
const TERRAIN_COLOR: Record<HexTerrain, string> = {
  plain: T.ji,
  hill: T.jiDeep,
  forest: '#a9a684',
  mudflat: '#b7b3a2',
  mountain: '#94886d',
  river: T.su,
  wall: T.meokMid,
  gate: T.jinsa,
  keep: T.meok,
};

/**
 * 지형 기호 — 명도만으로는 숲·구릉·산악이 갈리지 않는다.
 * 문서 §0 원칙 ②("형태가 정보를 담는다. 색은 보조다")에 따라
 * 칸마다 한자 한 글자를 옅게 찍는다. 범례에도 이름이 함께 있다.
 */
const TERRAIN_MARK: Partial<Record<HexTerrain, string>> = {
  hill: '丘',
  forest: '林',
  mountain: '山',
  river: '川',
  mudflat: '洲',
};

const TERRAIN_LABEL: Record<HexTerrain, string> = {
  plain: '평지',
  forest: '숲',
  hill: '구릉',
  mountain: '산악',
  river: '강',
  mudflat: '갯벌',
  wall: '성벽',
  gate: '성문',
  keep: '천수',
};

export function BattleScreen() {
  const battle = useGame((s) => s.battle);
  const live = useGame((s) => s.battleIsLive);
  const revision = useGame((s) => s.revision);
  const move = useGame((s) => s.battleMove);
  const attack = useGame((s) => s.battleAttack);
  const attackWall = useGame((s) => s.battleAttackWall);
  const endTurn = useGame((s) => s.battleEndTurn);
  const delegate = useGame((s) => s.battleDelegate);
  const withdraw = useGame((s) => s.battleWithdraw);
  const finish = useGame((s) => s.battleFinish);
  const setScreen = useGame((s) => s.setScreen);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<Axial | null>(null);

  const myTurn = !!battle && !battle.finished && battle.activeSide === battle.playerSide;

  const selected = battle && selectedId ? battle.units[selectedId] : undefined;
  const reach = useMemo(() => {
    if (!battle || !selected || !myTurn || selected.side !== battle.playerSide) return null;
    return reachable(battle, selected);
    // revision 이 바뀌면 다시 계산한다.
  }, [battle, selected, myTurn, revision]);

  const targets = useMemo(() => {
    if (!battle || !selected || !myTurn) return [];
    return attackableUnits(battle, selected);
  }, [battle, selected, myTurn, revision]);

  const wallTargets = useMemo(() => {
    if (!battle || !selected || !myTurn) return [];
    return attackableWalls(battle, selected);
  }, [battle, selected, myTurn, revision]);

  /* --------------------------- 그리기 --------------------------- */

  // 화면이 바뀌면 다시 그린다. 회전·창 크기·패널 접힘 모두 여기로 들어온다.
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setResizeTick((n) => n + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !battle) return;

    // **부모가 아니라 캔버스 자신의 상자를 잰다.**
    // 부모(.battle-canvas-wrap)는 그리드 컨테이너라 옆(또는 아래) 패널까지 포함한다.
    // 그걸로 백킹 스토어를 잡으면 그려지는 좌표계와 화면에 보이는 크기가 어긋나
    // 클릭이 엉뚱한 헥스에 떨어진다 — 데스크톱에서도 가로로 280px 어긋나 있었다.
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const hexes = Object.values(battle.hexes);
    // 맵이 화면에 꽉 차도록 헥스 크기를 정한다.
    const size = Math.min((w - 24) / (battle.cols * Math.sqrt(3) + 1), (h - 24) / (battle.rows * 1.5 + 1));
    const pts = hexes.map((hx) => hexToPixel(hx, size));
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    const ox = (w - (maxX - minX)) / 2 - minX;
    const oy = (h - (maxY - minY)) / 2 - minY;

    const reachKeys = reach ? new Set(reach.keys()) : null;
    const targetIds = new Set(targets.map((t) => t.id));
    const wallKeys = new Set(wallTargets.map((t) => `${t.q},${t.r}`));

    for (const hx of hexes) {
      const p = hexToPixel(hx, size);
      const cx = p.x + ox;
      const cy = p.y + oy;
      const corners = hexCorners(cx, cy, size * 0.94);

      ctx.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();

      ctx.fillStyle = TERRAIN_COLOR[hx.terrain];
      // 무너진 성벽은 흙빛으로 바랜다.
      if ((hx.terrain === 'wall' || hx.terrain === 'gate') && (hx.wallHp ?? 0) <= 0) {
        ctx.fillStyle = T.jiEdge; // 무너진 성벽 — 흙으로 돌아간 자리
      }
      ctx.fill();

      const key = `${hx.q},${hx.r}`;
      if (reachKeys?.has(key)) {
        ctx.fillStyle = 'rgba(168,50,50,0.16)'; // 이동 가능 (--jinsa)
        ctx.fill();
      }
      if (wallKeys.has(key)) {
        ctx.fillStyle = 'rgba(168,50,50,0.34)'; // 공격 가능 (--jinsa)
        ctx.fill();
      }

      // 지형 기호 — 색이 아니라 형태로 갈리게 한다
      const mark = TERRAIN_MARK[hx.terrain];
      if (mark) {
        ctx.fillStyle = hx.terrain === 'river' ? 'rgba(221,208,178,0.5)' : 'rgba(36,31,26,0.34)';
        ctx.font = `${Math.max(9, size * 0.42)}px 'Noto Serif KR', 'Batang', serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(mark, cx, cy);
      }

      const isWall = hx.terrain === 'wall' || hx.terrain === 'gate';
      ctx.strokeStyle = isWall ? 'rgba(221,208,178,0.7)' : 'rgba(36,31,26,0.5)';
      ctx.lineWidth = isWall ? 2 : 1;
      ctx.stroke();

      if (hx.terrain === 'gate' && (hx.wallHp ?? 0) > 0) {
        ctx.fillStyle = T.onDark;
        ctx.font = `${Math.max(8, size * 0.3)}px 'Noto Serif KR', 'Batang', serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('성문', cx, cy);
      }
      if (hx.terrain === 'keep') {
        ctx.fillStyle = T.onDark;
        ctx.font = `${Math.max(8, size * 0.3)}px 'Noto Serif KR', 'Batang', serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('천수', cx, cy);
      }

      // 성벽 내구도
      if ((hx.terrain === 'wall' || hx.terrain === 'gate') && (hx.wallHp ?? 0) > 0) {
        const ratio = (hx.wallHp ?? 0) / Math.max(1, hx.maxWallHp ?? 1);
        ctx.fillStyle = T.meok;
        ctx.fillRect(cx - size * 0.5, cy + size * 0.55, size, 3.5);
        ctx.fillStyle = ratio > 0.4 ? T.jiDeep : T.jinsa;
        ctx.fillRect(cx - size * 0.5, cy + size * 0.55, size * ratio, 3.5);
      }
    }

    // 부대
    for (const u of livingUnits(battle)) {
      const p = hexToPixel(u, size);
      const cx = p.x + ox;
      const cy = p.y + oy;
      const faction = u.side === 'attacker' ? battle.attackerFaction : battle.defenderFaction;
      const def = unitDef(u.unitType);

      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.56, 0, Math.PI * 2);
      ctx.fillStyle = factionColor(faction);
      ctx.fill();
      ctx.lineWidth = u.id === selectedId ? 3 : targetIds.has(u.id) ? 2.5 : 1.5;
      // 고른 부대는 진사, 칠 수 있는 적은 수(水). 굵기도 함께 달라 색만으로 갈리지 않는다.
      ctx.strokeStyle = u.id === selectedId ? T.jinsa : targetIds.has(u.id) ? T.su : T.meok;
      ctx.stroke();

      ctx.fillStyle = textOn(factionColor(faction));
      ctx.font = `${Math.max(9, size * 0.36)}px 'Noto Serif KR', 'Batang', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.name.slice(0, 2), cx, cy - size * 0.12);
      ctx.font = `${Math.max(8, size * 0.3)}px 'Noto Serif KR', 'Batang', serif`;
      ctx.fillText(String(Math.round(u.count / 100) / 10) + '천', cx, cy + size * 0.26);

      // 사기 막대
      ctx.fillStyle = T.meok;
      ctx.fillRect(cx - size * 0.5, cy - size * 0.78, size, 3.5);
      ctx.fillStyle = u.morale > 45 ? '#3f6b34' : u.morale > 20 ? T.jiDeep : T.jinsa;
      ctx.fillRect(cx - size * 0.5, cy - size * 0.78, size * (u.morale / 100), 3.5);
    }

    // 마우스가 놓인 칸
    if (hover) {
      const p = hexToPixel(hover, size);
      const corners = hexCorners(p.x + ox, p.y + oy, size * 0.94);
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.strokeStyle = T.jinsa;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // 클릭 좌표 → 헥스 변환에 필요한 값을 캔버스에 매달아 둔다.
    (canvas as HTMLCanvasElement & { _tf?: unknown })._tf = { size, ox, oy };
  }, [battle, revision, selectedId, hover, reach, targets, wallTargets, resizeTick]);

  if (!battle) return null;

  const toHex = (e: React.MouseEvent<HTMLCanvasElement>): Axial | null => {
    const canvas = canvasRef.current as (HTMLCanvasElement & { _tf?: { size: number; ox: number; oy: number } }) | null;
    if (!canvas?._tf) return null;
    const rect = canvas.getBoundingClientRect();
    const { size, ox, oy } = canvas._tf;
    return pixelToHex(e.clientX - rect.left - ox, e.clientY - rect.top - oy, size);
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hex = toHex(e);
    if (!hex) return;
    const unit = livingUnits(battle).find((u) => u.q === hex.q && u.r === hex.r);

    // 내 부대 고르기
    if (unit && unit.side === battle.playerSide) {
      setSelectedId(unit.id);
      return;
    }
    if (!selected || !myTurn || selected.side !== battle.playerSide) return;

    // 적 부대 공격
    if (unit && targets.some((t) => t.id === unit.id)) {
      attack(selected.id, unit.id);
      return;
    }
    // 성벽 공격
    if (wallTargets.some((w) => w.q === hex.q && w.r === hex.r)) {
      attackWall(selected.id, hex);
      return;
    }
    // 이동
    if (reach?.has(`${hex.q},${hex.r}`)) {
      move(selected.id, hex);
    }
  };

  const hoverHex = hover ? battle.hexes[`${hover.q},${hover.r}`] : undefined;
  const mySide = battle.playerSide;
  const myUnits = mySide ? livingUnits(battle, mySide) : [];

  return (
    <div className="battle">
      <div className="battle-head">
        <h2 style={{ fontSize: 18 }}>
          {battle.castleName} {battle.siege ? '공방전' : '야전'}
        </h2>
        <span className="tag">
          {battle.turn} / {battle.maxTurns} 합
        </span>
        <span className="tag">{['봄', '여름', '가을', '겨울'][battle.season]}</span>
        {battle.mountainFortress && <span className="tag">산성 보정</span>}
        <span className="row" style={{ gap: 6 }}>
          <i
            style={{
              width: 10,
              height: 10,
              background: factionColor(battle.attackerFaction),
              display: 'inline-block',
              border: '1px solid #241F1A',
            }}
          />
          {factionName(battle.attackerFaction)} {fmt(sideTroops(battle, 'attacker'))}
          <span className="faint">vs</span>
          <i
            style={{
              width: 10,
              height: 10,
              background: factionColor(battle.defenderFaction),
              display: 'inline-block',
              border: '1px solid #241F1A',
            }}
          />
          {factionName(battle.defenderFaction)} {fmt(sideTroops(battle, 'defender'))}
        </span>
        <div className="spacer" />
        {!battle.finished && (
          <>
            <span className={myTurn ? 'good' : 'muted'}>
              {myTurn ? '아군 차례' : battle.playerSide ? '적군 차례' : '관전'}
            </span>
            <button className="btn small" onClick={endTurn} disabled={!myTurn}>
              차례 종료
            </button>
            <button className="btn small" onClick={delegate}>
              위임 (자동 진행)
            </button>
            <button className="btn small" onClick={withdraw} disabled={!battle.playerSide}>
              퇴각
            </button>
          </>
        )}
        {battle.finished && (
          <button className="btn primary small" onClick={live ? finish : () => setScreen('title')}>
            {live ? '전략맵으로' : '나가기'}
          </button>
        )}
      </div>

      <div className="battle-canvas-wrap">
        <canvas
          ref={canvasRef}
          onClick={onClick}
          // 마우스 전용 이벤트를 쓰면 터치에서 onMouseLeave 가 영영 오지 않아
          // 지형 표시가 마지막으로 누른 칸에 붙박인다. 포인터로 통일한다.
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse') setHover(toHex(e));
          }}
          onPointerLeave={() => setHover(null)}
          onPointerCancel={() => setHover(null)}
        />
        <div className="battle-side">
          {battle.finished && battle.result && (
            <div className="card" style={{ padding: 12, marginBottom: 10 }}>
              <h3 style={{ fontSize: 16 }}>
                {battle.result.winner === 'attacker' ? '공격 측' : '수비 측'} 승리
              </h3>
              <p>
                공격 피해 {fmt(battle.result.attackerLoss)}
                <br />
                수비 피해 {fmt(battle.result.defenderLoss)}
              </p>
              {battle.result.capturedOfficers.length > 0 && (
                <p className="faint">사로잡힌 장수 {battle.result.capturedOfficers.length}명</p>
              )}
            </div>
          )}

          {hoverHex && (
            <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
              {TERRAIN_LABEL[hoverHex.terrain]}
              {hoverHex.wallHp !== undefined && ` · 내구 ${hoverHex.wallHp}/${hoverHex.maxWallHp}`}
            </div>
          )}

          {selected && <UnitCard unit={selected} selected />}

          <div className="section-label" style={{ marginTop: 4 }}>
            아군 부대 {myUnits.length}
          </div>
          {myUnits.map((u) => (
            <div key={u.id} onClick={() => setSelectedId(u.id)} style={{ cursor: 'pointer' }}>
              <UnitCard unit={u} selected={u.id === selectedId} />
            </div>
          ))}

          <hr className="sep" />
          <div className="legend">
            {(Object.keys(TERRAIN_COLOR) as HexTerrain[]).map((t) => (
              <span key={t}>
                <i style={{ background: TERRAIN_COLOR[t] }} />
                {TERRAIN_LABEL[t]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="battle-log">
        {battle.log
          .slice(-60)
          .reverse()
          .map((l, i) => (
            <div key={i}>{l}</div>
          ))}
      </div>
    </div>
  );
}

function UnitCard({ unit, selected }: { unit: BattleUnit; selected?: boolean }) {
  const def = unitDef(unit.unitType);
  return (
    <div className={`unit-card${selected ? ' sel' : ''}`}>
      <div className="row between">
        <b>{def.name}</b>
        <span className="num">{fmt(unit.count)}</span>
      </div>
      {unit.officer && (
        <div className="faint" style={{ fontSize: 11.5 }}>
          {unit.officer.name} — 통{unit.officer.stats.lead} 무{unit.officer.stats.war}
        </div>
      )}
      <div className="faint" style={{ fontSize: 11.5 }}>
        사기 {Math.round(unit.morale)} · 훈련 {Math.round(unit.training)} · 이동 {unit.movesLeft}
        {unit.acted ? ' · 행동함' : ''}
      </div>
      <div className="faint" style={{ fontSize: 11 }}>
        공 {def.attack} / 방 {def.defense} / 사거리 {def.range}
        {def.siege ? ' · 공성병기' : ''}
      </div>
    </div>
  );
}
