/**
 * StrategyMap.tsx — 전략맵 (기획서 §9 / 시스템 상세계획 §4 ①)
 *
 * SVG 로 그린다. 거점 노드 + 인접선(이동 그래프) + 세력 색 + 계절 표현.
 * 실제 위성 지형 대신 프로토타입에서는 지역 윤곽을 단순화한 배경을 쓴다.
 */

import { CASTLES, MAP, ROUTES, castleDef, factionColor, factionName, officerName } from '../core/data';
import { armyTroops } from '../core/state';
import { riversFrozen } from '../core/formulas';
import type { GameState } from '../core/types';
import { fmtTroops } from '../core/util';

interface Props {
  state: GameState;
  selected: string | null;
  onSelect: (id: string) => void;
  /** 출진 목표를 고르는 중이면 후보 거점 집합 */
  marchTargets?: Set<string> | null;
}

/**
 * 좌표계는 mapdata.json 과 같은 1760×2049 공간이다.
 * 거점이 실제로 놓인 범위만 잘라 낸다(요서~우산국, 부여성~탐라).
 * 줌·팬과 실제 지형선은 다음 단계에서 붙인다.
 */
const VIEW_BOX = '400 300 1170 1720';

const CASTLE_SHAPE: Record<string, number> = {
  capital: 13,
  major: 11,
  fort: 10,
  port: 10,
};

/** 76 거점의 이름을 다 쓰면 겹친다. 등급이 높은 것과 선택한 것만 쓴다. */
const NAMED_TYPES = new Set(['capital', 'major']);

export function StrategyMap({ state, selected, onSelect, marchTargets }: Props) {
  const frozen = riversFrozen(state.season);
  const armies = Object.values(state.armies);

  return (
    <svg viewBox={VIEW_BOX} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 해안선·하천 — 실제 지리에서 뽑은 윤곽 */}
      <g pointerEvents="none">
        <path d={MAP.land} fill="#1b1712" stroke="#3a3026" strokeWidth="1.6" />
        <path d={MAP.islets} fill="#1b1712" stroke="#3a3026" strokeWidth="1.2" />
        <path d={MAP.lakes} fill="#141c20" stroke="#2c3a40" strokeWidth="1" />
        {Object.entries(MAP.rivers).map(([name, d]) => (
          <path key={name} d={d} fill="none" stroke="#33454c" strokeWidth="1.6" />
        ))}
        {Object.entries(MAP.ranges).map(([name, d]) => (
          <path key={name} d={d} fill="none" stroke="#4a3f31" strokeWidth="1.2" />
        ))}
      </g>

      {/* 계절 표시 */}
      <text x="1540" y="360" textAnchor="end" fill="#7d715c" fontSize="26" fontFamily="serif">
        {state.year}년 {['봄', '여름', '가을', '겨울'][state.season]}
        {frozen ? ' · 강이 얼었다' : ''}
      </text>

      {/* 길 — 육로와 수로. 지도 파이프라인이 지형을 피해 그린 곡선을 그대로 쓴다. */}
      <g fill="none" pointerEvents="none">
        {ROUTES.map((r) => {
          const oa = state.castles[r.a]?.owner;
          const ob = state.castles[r.b]?.owner;
          const same = oa && oa === ob;
          return (
            <path
              key={`${r.a}-${r.b}`}
              d={r.d}
              stroke={same ? factionColor(oa) : r.sea ? '#3d5a63' : '#4a3d2e'}
              strokeOpacity={same ? 0.5 : 0.8}
              strokeWidth={r.sea ? 1.6 : 2.4}
              strokeDasharray={r.sea ? '2 7' : undefined}
            />
          );
        })}
      </g>

      {/* 행군 중인 부대 */}
      <g>
        {armies.map((army) => {
          const at = castleDef(army.location);
          const next = army.path[0] ? castleDef(army.path[0]) : null;
          const dx = next ? (next.position.x - at.position.x) * 0.28 : 0;
          const dy = next ? (next.position.y - at.position.y) * 0.28 : -22;
          const x = at.position.x + dx;
          const y = at.position.y + dy;
          return (
            <g key={army.id}>
              {next && (
                <line
                  x1={at.position.x}
                  y1={at.position.y}
                  x2={next.position.x}
                  y2={next.position.y}
                  stroke={factionColor(army.faction)}
                  strokeWidth="3"
                  strokeDasharray="7 5"
                  opacity="0.85"
                />
              )}
              <polygon
                points={`${x},${y - 11} ${x + 9},${y + 7} ${x - 9},${y + 7}`}
                fill={factionColor(army.faction)}
                stroke="#14100d"
                strokeWidth="1.2"
              />
              <text x={x} y={y + 24} textAnchor="middle" fontSize="16" fill="#b8a888">
                {officerName(army.commander)} {fmtTroops(armyTroops(army))}
              </text>
            </g>
          );
        })}
      </g>

      {/* 거점 */}
      <g>
        {CASTLES.map((def) => {
          const c = state.castles[def.id];
          if (!c) return null;
          const r = CASTLE_SHAPE[def.type] ?? 12;
          const color = factionColor(c.owner);
          const isSel = selected === def.id;
          const isTarget = marchTargets?.has(def.id);
          const besieged = !!c.besiegedBy;

          return (
            <g
              key={def.id}
              onClick={() => onSelect(def.id)}
              style={{ cursor: 'pointer' }}
              opacity={marchTargets && !isTarget ? 0.4 : 1}
            >
              {(isSel || isTarget) && (
                <circle cx={def.position.x} cy={def.position.y} r={r + 16} fill="url(#glow)" />
              )}

              {/* 등급별 모양: 도성=이중원, 산성=삼각, 항구=마름모, 대성=원 */}
              {def.type === 'fort' ? (
                <polygon
                  points={`${def.position.x},${def.position.y - r} ${def.position.x + r},${def.position.y + r * 0.8} ${def.position.x - r},${def.position.y + r * 0.8}`}
                  fill={color}
                  stroke={isSel ? '#e8dcc4' : '#14100d'}
                  strokeWidth={isSel ? 2.4 : 1.6}
                />
              ) : def.type === 'port' ? (
                <polygon
                  points={`${def.position.x},${def.position.y - r} ${def.position.x + r},${def.position.y} ${def.position.x},${def.position.y + r} ${def.position.x - r},${def.position.y}`}
                  fill={color}
                  stroke={isSel ? '#e8dcc4' : '#14100d'}
                  strokeWidth={isSel ? 2.4 : 1.6}
                />
              ) : (
                <>
                  <circle
                    cx={def.position.x}
                    cy={def.position.y}
                    r={r}
                    fill={color}
                    stroke={isSel ? '#e8dcc4' : '#14100d'}
                    strokeWidth={isSel ? 2.4 : 1.6}
                  />
                  {def.type === 'capital' && (
                    <circle
                      cx={def.position.x}
                      cy={def.position.y}
                      r={r - 5}
                      fill="none"
                      stroke="#14100d"
                      strokeWidth="1.6"
                    />
                  )}
                </>
              )}

              {besieged && (
                <circle
                  cx={def.position.x}
                  cy={def.position.y}
                  r={r + 7}
                  fill="none"
                  stroke="#b0432f"
                  strokeWidth="1.8"
                  strokeDasharray="3 3"
                />
              )}

              {(NAMED_TYPES.has(def.type) || isSel || isTarget) && (
                <>
                  <text
                    x={def.position.x}
                    y={def.position.y - r - 8}
                    textAnchor="middle"
                    fontSize="19"
                    fontFamily="serif"
                    fill="#e8dcc4"
                    stroke="#100d0a"
                    strokeWidth="4"
                    paintOrder="stroke"
                  >
                    {def.name}
                  </text>
                  <text
                    x={def.position.x}
                    y={def.position.y + r + 20}
                    textAnchor="middle"
                    fontSize="16"
                    fill="#b8a888"
                    stroke="#100d0a"
                    strokeWidth="3.4"
                    paintOrder="stroke"
                  >
                    {c.owner ? fmtTroops(c.troops) : '무주공산'}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </g>

      {/* 범례 */}
      <g transform="translate(430, 1985)">
        {Object.values(state.factions)
          .filter((f) => f.alive)
          .map((f, i) => (
            <g key={f.id} transform={`translate(${i * 130}, 0)`}>
              <rect width="16" height="16" y="-14" fill={factionColor(f.id)} rx="2" />
              <text x="22" y="0" fontSize="19" fill="#b8a888">
                {factionName(f.id)}
              </text>
            </g>
          ))}
      </g>
    </svg>
  );
}
