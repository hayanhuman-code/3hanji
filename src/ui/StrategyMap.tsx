/**
 * StrategyMap.tsx — 전략맵 (기획서 §9 / 시스템 상세계획 §4 ①)
 *
 * 실제 경위도를 투영한 지도 위에 거점 76개를 놓는다. 조작(확대·이동·핀치)은
 * MapStage 가, 변환은 useMapView 가 맡고, 여기서는 레이어를 쌓고
 * 화면에 고정되어야 하는 것(줌 위젯·계절·범례)을 HTML 로 얹는다.
 *
 * 층 순서는 아래에서 위로: 땅 → 영향권 → 길 → 부대 → 거점.
 */

import { useEffect, useRef } from 'react';
import { CASTLES, castleDef, factionColor, factionName } from '../core/data';
import { riversFrozen } from '../core/formulas';
import type { GameState } from '../core/types';
import { ArmyMarkers } from './map/ArmyMarkers';
import { CastleMarkers } from './map/CastleMarkers';
import { MapStage } from './map/MapStage';
import { Routes } from './map/Routes';
import { Terrain } from './map/Terrain';
import { Territory } from './map/Territory';
import { useMapView } from './map/useMapView';

/**
 * 실제로 쓰는 범위. 지도 캔버스는 1760×2049 이지만 거점은 그 일부에만 있다
 * (요서~우산국, 부여성~탐라). 캔버스 전체를 기준으로 맞추면 빈 바다가 절반이다.
 */
const PAD = 90;
const CONTENT = (() => {
  const xs = CASTLES.map((c) => c.position.x);
  const ys = CASTLES.map((c) => c.position.y);
  const x = Math.min(...xs) - PAD;
  const y = Math.min(...ys) - PAD;
  return { x, y, w: Math.max(...xs) + PAD - x, h: Math.max(...ys) + PAD - y };
})();

interface Props {
  state: GameState;
  selected: string | null;
  onSelect: (id: string) => void;
  /** 출진 목표를 고르는 중이면 도달 가능한 거점 집합 */
  marchTargets?: Set<string> | null;
}

export function StrategyMap({ state, selected, onSelect, marchTargets }: Props) {
  const api = useMapView(CONTENT);
  const { centerOn, ensureVisible, zoomCenter, fit, zoom } = api;

  // 첫 진입에는 내 도성으로 데려간다. 76 거점 전체를 보여 줘 봐야 어디가
  // 내 땅인지 알 수 없다.
  const homed = useRef(false);
  useEffect(() => {
    if (homed.current || !selected) return;
    homed.current = true;
    const def = castleDef(selected);
    centerOn(def.position.x, def.position.y);
  }, [selected, centerOn]);

  // 선택이 바뀌면 — 인물 패널에서 건너뛰는 경우를 포함해 — 화면 안으로 당긴다.
  useEffect(() => {
    if (!homed.current || !selected) return;
    const def = castleDef(selected);
    ensureVisible(def.position.x, def.position.y);
  }, [selected, ensureVisible]);

  const frozen = riversFrozen(state.season);
  const alive = Object.values(state.factions).filter((f) => f.alive);

  return (
    <>
      <MapStage api={api} onSelect={onSelect}>
        <Terrain season={state.season} />
        <Territory state={state} />
        <Routes state={state} />
        <ArmyMarkers state={state} />
        <CastleMarkers api={api} state={state} selected={selected} marchTargets={marchTargets} />
      </MapStage>

      {/* --- 화면에 고정되는 것들. 지도를 옮겨도 따라가지 않는다. --- */}

      <div className="map-hud zoom">
        <button onClick={() => zoomCenter(1.35)} aria-label="확대">
          ＋
        </button>
        <div className="lv">{zoom}%</div>
        <button onClick={() => zoomCenter(1 / 1.35)} aria-label="축소">
          －
        </button>
        <button onClick={fit} aria-label="전체 보기">
          전체
        </button>
      </div>

      <div className="map-hud when">
        {state.year}년 {['봄', '여름', '가을', '겨울'][state.season]}
        {frozen && <em> · 강이 얼었다</em>}
      </div>

      <div className="map-hud legend">
        {alive.map((f) => (
          <span key={f.id}>
            <i style={{ background: factionColor(f.id) }} />
            {factionName(f.id)}
            <em>{Object.values(state.castles).filter((c) => c.owner === f.id).length}</em>
          </span>
        ))}
      </div>

      {marchTargets && (
        <div className="map-hud march-hint">
          출진할 곳을 지도에서 고르십시오 · 후보 {marchTargets.size}
        </div>
      )}
    </>
  );
}
