/**
 * StrategyMap.tsx — 전략맵 (기획서 §9 / 시스템 상세계획 §4 ①)
 *
 * SVG 로 그린다. 거점 노드 + 인접선(이동 그래프) + 세력 색 + 계절 표현.
 * 실제 위성 지형 대신 프로토타입에서는 지역 윤곽을 단순화한 배경을 쓴다.
 */

import { useMemo } from 'react';
import { CASTLES, castleDef, factionColor, factionName, officerName } from '../core/data';
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

const CASTLE_SHAPE: Record<string, number> = {
  capital: 15,
  major: 12,
  mountain_fortress: 12,
  port: 11,
};

export function StrategyMap({ state, selected, onSelect, marchTargets }: Props) {
  // 인접선은 한 번만 계산하면 된다 (거점 그래프는 고정).
  const edges = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ a: (typeof CASTLES)[number]; b: (typeof CASTLES)[number] }> = [];
    for (const c of CASTLES) {
      for (const nb of c.neighbors) {
        const key = c.id < nb ? `${c.id}|${nb}` : `${nb}|${c.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const other = CASTLES.find((x) => x.id === nb);
        if (other) out.push({ a: c, b: other });
      }
    }
    return out;
  }, []);

  const frozen = riversFrozen(state.season);
  const armies = Object.values(state.armies);

  return (
    <svg viewBox="60 60 760 760" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="soft">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* 지역 윤곽 — 요동·한반도를 아주 성기게 암시한다 */}
      <g opacity="0.5" fill="none" stroke="#2b2219" strokeWidth="1.5">
        <path d="M110 90 Q 210 60 320 110 T 430 250 Q 470 330 430 420" />
        <path d="M430 420 Q 400 520 440 620 T 420 760 Q 560 810 700 790 T 790 640 Q 760 520 690 470 T 560 430 Q 480 430 430 420" />
      </g>

      {/* 계절 표시 */}
      <text x="800" y="96" textAnchor="end" fill="#7d715c" fontSize="15" fontFamily="serif">
        {state.year}년 {['봄', '여름', '가을', '겨울'][state.season]}
        {frozen ? ' · 강이 얼었다' : ''}
      </text>

      {/* 인접선 */}
      <g>
        {edges.map(({ a, b }) => {
          const oa = state.castles[a.id]?.owner;
          const ob = state.castles[b.id]?.owner;
          const same = oa && oa === ob;
          return (
            <line
              key={`${a.id}-${b.id}`}
              x1={a.position.x}
              y1={a.position.y}
              x2={b.position.x}
              y2={b.position.y}
              stroke={same ? factionColor(oa) : '#3a2f24'}
              strokeOpacity={same ? 0.45 : 0.7}
              strokeWidth={same ? 2 : 1.2}
              strokeDasharray={same ? undefined : '3 4'}
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
                  strokeWidth="2"
                  strokeDasharray="5 4"
                  opacity="0.85"
                />
              )}
              <polygon
                points={`${x},${y - 8} ${x + 7},${y + 5} ${x - 7},${y + 5}`}
                fill={factionColor(army.faction)}
                stroke="#14100d"
                strokeWidth="1.2"
              />
              <text x={x} y={y + 17} textAnchor="middle" fontSize="9.5" fill="#b8a888">
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
              {def.type === 'mountain_fortress' ? (
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

              <text
                x={def.position.x}
                y={def.position.y - r - 7}
                textAnchor="middle"
                fontSize="13"
                fontFamily="serif"
                fill="#e8dcc4"
                stroke="#100d0a"
                strokeWidth="3"
                paintOrder="stroke"
              >
                {def.name}
              </text>
              <text
                x={def.position.x}
                y={def.position.y + r + 15}
                textAnchor="middle"
                fontSize="10.5"
                fill="#b8a888"
                stroke="#100d0a"
                strokeWidth="2.6"
                paintOrder="stroke"
              >
                {c.owner ? fmtTroops(c.troops) : '무주공산'}
              </text>
            </g>
          );
        })}
      </g>

      {/* 범례 */}
      <g transform="translate(80, 762)">
        {Object.values(state.factions)
          .filter((f) => f.alive)
          .map((f, i) => (
            <g key={f.id} transform={`translate(${i * 92}, 0)`}>
              <rect width="10" height="10" y="-9" fill={factionColor(f.id)} rx="2" />
              <text x="15" y="0" fontSize="12" fill="#b8a888">
                {factionName(f.id)}
              </text>
            </g>
          ))}
      </g>
    </svg>
  );
}
