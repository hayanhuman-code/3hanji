/**
 * FieldSim.tsx — 전투 시뮬레이터 단독 페이지.
 *
 * 전략맵과 붙이지 않는다. 편성과 전장을 바꿔 가며 수십 판을 빠르게 돌려 봐야
 * 밸런싱이 되기 때문이다(기획서 §9 「먼저 만들 것」). 전략 레이어와의 연결은
 * 나중에 붙인다 — 그때도 이 화면은 그대로 남아 밸런스를 재는 자리가 된다.
 *
 * 화면은 두 단계다.  편성(3열·예비대) → 전투(배속·개입)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { OFFICERS, factionName } from '../../core/data';
import { ROW_LABEL, STANCE, TIER_CAP, TIER_NAME } from '../../core/field/balance';
import { BATTLEFIELD_IDS, battlefield, fieldSummary } from '../../core/field/battlefield';
import {
  SCHEMES,
  castScheme,
  commitReserve,
  moveTo,
  pursue,
  releaseOrders,
  schemeError,
  setStance,
  withdraw,
  type SchemeId,
} from '../../core/field/orders';
import { createField, validateEntries } from '../../core/field/setup';
import { runToEnd, step, unitTitle } from '../../core/field/sim';
import type {
  FieldEntry,
  FieldSetup,
  FieldState,
  Row,
  Stance,
  Tier,
} from '../../core/field/types';
import { MAX_UNITS, TICKS_PER_SEC } from '../../core/field/types';
import { TROOPS, TROOP_LABEL, TROOP_MARK, type FactionId, type Troop } from '../../core/types';
import { useGame } from '../store';
import { FieldCanvas } from './FieldCanvas';

const FACTIONS: FactionId[] = ['goguryeo', 'baekje', 'silla', 'gaya'];
const ROWS: Row[] = ['front', 'mid', 'rear'];
const SPEEDS = [1, 2, 4, 8] as const;

const STATS = new Map(OFFICERS.map((o) => [o.id, o.stats]));
const statsOf = (id: string) => STATS.get(id) ?? { lead: 60, war: 60, int: 60 };
const intOf = (id: string) => statsOf(id).int;

/** 그 계열이 제자리로 삼는 열 */
const HOME_ROW: Record<Troop, Row> = { inf: 'front', cav: 'mid', arc: 'rear', str: 'rear' };

function defaultTiers(): Record<Troop, Tier> {
  return { inf: 2, cav: 2, arc: 2, str: 2 };
}

/** 세력에서 좋은 순으로 뽑아 자동 편성한다 — 밸런스를 재려면 빨리 채워야 한다 */
function autoArmy(faction: FactionId, count: number, troops: number): FieldEntry[] {
  const mix: Troop[] = ['inf', 'inf', 'cav', 'arc', 'inf', 'cav', 'str', 'inf', 'arc', 'cav', 'inf', 'str'];
  const used = new Set<string>();
  const out: FieldEntry[] = [];
  for (let i = 0; i < count; i++) {
    const t = mix[i % mix.length];
    const o = OFFICERS.filter((x) => x.faction === faction && x.troop === t && !used.has(x.id)).sort(
      (a, b) => b.stats.lead + b.stats.war - (a.stats.lead + a.stats.war)
    )[0];
    if (!o) continue;
    used.add(o.id);
    out.push({ officer: o.id, troops, row: HOME_ROW[t], reserve: i >= count - 2 && count >= 6 });
  }
  return out;
}

export function FieldSim() {
  const setScreen = useGame((s) => s.setScreen);
  const notify = useGame((s) => s.notify);

  /* ---------------- 편성 ---------------- */
  const [fieldId, setFieldId] = useState('hanseong');
  const [season, setSeason] = useState<0 | 1 | 2 | 3>(0);
  const [atkF, setAtkF] = useState<FactionId>('goguryeo');
  const [defF, setDefF] = useState<FactionId>('silla');
  const [atkTiers, setAtkTiers] = useState<Record<Troop, Tier>>(defaultTiers);
  const [defTiers, setDefTiers] = useState<Record<Troop, Tier>>(defaultTiers);
  const [troopsEach, setTroopsEach] = useState(4000);
  const [count, setCount] = useState(8);
  const [atk, setAtk] = useState<FieldEntry[]>(() => autoArmy('goguryeo', 8, 4000));
  const [def, setDef] = useState<FieldEntry[]>(() => autoArmy('silla', 8, 4000));
  const [seed, setSeed] = useState(20260817);

  /* ---------------- 전투 ---------------- */
  const [state, setState] = useState<FieldState | null>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const [running, setRunning] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const raf = useRef<number | null>(null);
  const carry = useRef(0);
  const last = useRef(0);

  const rebuild = useCallback(() => {
    setAtk(autoArmy(atkF, count, troopsEach));
    setDef(autoArmy(defF, count, troopsEach));
  }, [atkF, defF, count, troopsEach]);

  /* 배속 — 틱을 더 도는 것일 뿐이다. 렌더는 언제나 프레임마다 한 번 (§4.9) */
  useEffect(() => {
    if (!state || !running || state.phase === 'done') return;
    const loop = (now: number) => {
      if (!last.current) last.current = now;
      const dt = Math.min(0.25, (now - last.current) / 1000);
      last.current = now;
      carry.current += dt * TICKS_PER_SEC * speed;
      let n = Math.floor(carry.current);
      carry.current -= n;
      // 한 프레임에 너무 많이 돌면 화면이 멎는다. 상한을 둔다
      n = Math.min(n, 400);
      for (let i = 0; i < n && state.phase !== 'done'; i++) step(state, statsOf);
      setTick(state.tick);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      last.current = 0;
    };
  }, [state, running, speed]);

  const begin = () => {
    const e1 = validateEntries(atk);
    const e2 = validateEntries(def);
    if (e1 || e2) {
      notify(e1 ?? e2);
      return;
    }
    const setup: FieldSetup = {
      fieldId,
      seed,
      season,
      siege: battlefield(fieldId).tiles.some((r) => r.includes('W')),
      playerSide: 'attacker',
      attackerFaction: atkF,
      defenderFaction: defF,
      tiers: { attacker: atkTiers, defender: defTiers },
      attacker: atk,
      defender: def,
    };
    const st = createField(setup);
    setState(st);
    setTick(0);
    setSelected(null);
    setRunning(true);
    carry.current = 0;
    last.current = 0;
  };

  const settle = () => {
    if (!state) return;
    runToEnd(state, statsOf);
    setTick(state.tick);
    setRunning(false);
  };

  /* ---------------- 편성 화면 ---------------- */
  if (!state) {
    const f = battlefield(fieldId);
    return (
      <div className="field-setup">
        <div className="field-setup-inner">
          <div className="row between" style={{ marginBottom: 18 }}>
            <h1 style={{ fontSize: 26 }}>
              전투 시뮬레이터 <span className="faint" style={{ fontSize: 13 }}>戰場</span>
            </h1>
            <button className="btn ghost" onClick={() => setScreen('title')}>
              나가기
            </button>
          </div>

          <p className="faint" style={{ marginBottom: 20, maxWidth: 680, fontSize: 12 }}>
            전략맵과 분리된 화면입니다. 편성과 전장을 바꿔 가며 반복해 돌려 보는 곳이고,
            같은 씨앗이면 언제나 같은 결과가 납니다.
          </p>

          <div className="section-label" style={{ marginTop: 0 }}>전장</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <select className="btn" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
              {BATTLEFIELD_IDS.map((id) => (
                <option key={id} value={id}>
                  {battlefield(id).name}
                </option>
              ))}
            </select>
            <span className="faint">{fieldSummary(f)} · 7×5km</span>
            <select
              className="btn"
              value={season}
              onChange={(e) => setSeason(Number(e.target.value) as 0 | 1 | 2 | 3)}
            >
              {['봄', '여름 (수계 강함)', '가을 (화계 강함)', '겨울 (소모 큼)'].map((s, i) => (
                <option key={i} value={i}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="section-label">양측</div>
          <div className="field-sides">
            {(
              [
                ['attacker', atkF, setAtkF, atkTiers, setAtkTiers] as const,
                ['defender', defF, setDefF, defTiers, setDefTiers] as const,
              ]
            ).map(([side, fac, setFac, tiers, setTiers]) => (
              <div key={side} className="card" style={{ padding: 12 }}>
                <div className="row between">
                  <b>{side === 'attacker' ? '공격 측' : '수비 측'}</b>
                  <select
                    className="btn small"
                    value={fac}
                    onChange={(e) => setFac(e.target.value as FactionId)}
                  >
                    {FACTIONS.map((x) => (
                      <option key={x} value={x}>
                        {factionName(x)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="faint" style={{ fontSize: 11, margin: '8px 0 4px' }}>
                  국가 병종 단계 — 나라가 강해지면 그 장수가 이끄는 병종이 좋아진다
                </div>
                {TROOPS.map((t) => (
                  <div key={t} className="tier-row">
                    <span>
                      <i className="mark">{TROOP_MARK[t]}</i> {TROOP_LABEL[t]}
                    </span>
                    <span className="tier-btns">
                      {([1, 2, 3, 4] as Tier[]).map((n) => {
                        const cap = TIER_CAP[fac][t];
                        const locked = n > cap;
                        return (
                          <button
                            key={n}
                            className={`btn small${tiers[t] === n ? ' on' : ''}`}
                            disabled={locked}
                            title={locked ? `${factionName(fac)}는 ${t} 계열을 ${cap}단계까지만 올립니다` : TIER_NAME[t][n]}
                            onClick={() => setTiers({ ...tiers, [t]: n })}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </span>
                    <span className="faint num">{TIER_NAME[t][tiers[t]]}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="section-label">편성</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <label className="faint">
              부대 수
              <input
                type="number"
                min={1}
                max={MAX_UNITS}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(MAX_UNITS, Number(e.target.value))))}
                style={{ width: 56, marginLeft: 6 }}
              />
            </label>
            <label className="faint">
              부대별 병력
              <input
                type="number"
                min={500}
                step={500}
                value={troopsEach}
                onChange={(e) => setTroopsEach(Math.max(500, Number(e.target.value)))}
                style={{ width: 80, marginLeft: 6 }}
              />
            </label>
            <label className="faint">
              씨앗
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                style={{ width: 110, marginLeft: 6 }}
              />
            </label>
            <button className="btn small" onClick={rebuild}>
              자동 편성
            </button>
          </div>

          <div className="field-armies">
            {([['공격', atk, setAtk], ['수비', def, setDef]] as const).map(([label, list, setList]) => (
              <div key={label}>
                <div className="section-label" style={{ marginTop: 14 }}>
                  {label} {list.length}부대 · {list.reduce((s, e) => s + e.troops, 0).toLocaleString()}명
                </div>
                <div className="entry-list">
                  {list.map((e, i) => {
                    const o = OFFICERS.find((x) => x.id === e.officer)!;
                    const fit = HOME_ROW[o.troop] === e.row;
                    return (
                      <div key={e.officer} className={`entry${e.reserve ? ' reserve' : ''}`}>
                        <b>
                          {o.name}
                          <i className="troop">{TROOP_MARK[o.troop]}</i>
                        </b>
                        <span className="tabs">
                          {ROWS.map((r) => (
                            <button
                              key={r}
                              className={e.row === r ? 'on' : ''}
                              onClick={() => {
                                const next = [...list];
                                next[i] = { ...e, row: r };
                                setList(next);
                              }}
                            >
                              {ROW_LABEL[r]}
                            </button>
                          ))}
                        </span>
                        <button
                          className={`btn small${e.reserve ? ' on' : ''}`}
                          title="예비대는 전선에 서지 않는다. 전황을 보고 투입한다"
                          onClick={() => {
                            const next = [...list];
                            next[i] = { ...e, reserve: !e.reserve };
                            setList(next);
                          }}
                        >
                          예비
                        </button>
                        {!fit && (
                          <span className="bad" style={{ fontSize: 10.5 }}>
                            열이 안 맞음
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="row" style={{ marginTop: 22 }}>
            <button className="btn primary" onClick={begin}>
              전투 시작
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- 전투 화면 ---------------- */
  const sel = state.units.find((u) => u.id === selected && !u.dead) ?? null;
  const mine = state.units.filter((u) => u.side === 'attacker' && !u.dead);
  const theirs = state.units.filter((u) => u.side === 'defender' && !u.dead);
  const sum = (list: typeof mine) => Math.round(list.reduce((s, u) => s + u.troops, 0));
  const hours = Math.floor(state.tick / 3600);
  const mins = Math.floor((state.tick % 3600) / 60);
  const PHASE: Record<string, string> = {
    march: '행군',
    clash: '접전',
    waver: '동요',
    pursuit: '추격·퇴각',
    done: '종료',
  };

  return (
    <div className="field">
      <div className="field-head">
        {/* 읽는 것과 누르는 것을 나눠 둔다. 폰에서 두 줄로 갈라지는 자리다 */}
        <div className="field-info">
          <b style={{ fontSize: 16 }}>{state.field.name}</b>
          <span className="tag">{PHASE[state.phase]}</span>
          <span className="tag num">
            {hours}시간 {String(mins).padStart(2, '0')}분
          </span>
          <span className="row" style={{ gap: 6 }}>
            <i className="swatch" style={{ background: `var(--f-${state.attackerFaction})` }} />
            {factionName(state.attackerFaction)} <b className="num">{sum(mine).toLocaleString()}</b>
            <span className="faint">vs</span>
            <i className="swatch" style={{ background: `var(--f-${state.defenderFaction})` }} />
            {factionName(state.defenderFaction)}{' '}
            <b className="num">{sum(theirs).toLocaleString()}</b>
          </span>
        </div>
        <div className="spacer" />
        {/* 폰에서는 이 띠만 옆으로 밀린다 — 머리가 세 줄로 자라 화면을 먹지 않게 */}
        <div className="field-ctl">
          {state.phase !== 'done' ? (
            <>
              <button className="btn small" onClick={() => setRunning((v) => !v)}>
                {running ? '일시정지' : '재개'}
              </button>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  className={`btn small${speed === s ? ' on' : ''}`}
                  onClick={() => setSpeed(s)}
                >
                  {s}×
                </button>
              ))}
              <button
                className="btn small"
                onClick={settle}
                title="같은 시뮬레이션을 렌더링 없이 끝까지 돌린다"
              >
                즉시결판
              </button>
            </>
          ) : (
            <button className="btn primary small" onClick={() => setState(null)}>
              편성으로
            </button>
          )}
        </div>
      </div>

      <div className="field-body">
        <FieldCanvas
          state={state}
          tick={tick}
          selected={selected}
          onSelectUnit={setSelected}
          onPickPoint={(x, y) => {
            if (sel && sel.side === 'attacker') {
              moveTo(state, sel.id, x, y);
              setTick(state.tick + 0.001);
            } else setSelected(null);
          }}
        />

        <div className="field-side">
          {state.result && (
            <div className="card" style={{ padding: 10, marginBottom: 10 }}>
              <h3 style={{ fontSize: 15 }}>
                {state.result.winner === null
                  ? '무승부'
                  : `${state.result.winner === 'attacker' ? '공격 측' : '수비 측'} 승리`}
              </h3>
              <p className="num">
                공격 손실 {state.result.attackerLoss.toLocaleString()}
                <br />
                수비 손실 {state.result.defenderLoss.toLocaleString()}
              </p>
            </div>
          )}

          <div className="section-label" style={{ marginTop: 0 }}>전군 태세</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {(Object.keys(STANCE) as Stance[]).map((s) => (
              <button
                key={s}
                className="btn small"
                title={STANCE[s].desc}
                onClick={() => {
                  setStance(state, 'attacker', s);
                  setTick(state.tick + 0.001);
                }}
              >
                {STANCE[s].name}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 4, marginTop: 6 }}>
            <button className="btn small" onClick={() => { pursue(state, 'attacker', true); setTick(state.tick + 0.001); }}>
              추격
            </button>
            <button className="btn small" onClick={() => { pursue(state, 'attacker', false); setTick(state.tick + 0.001); }}>
              정지
            </button>
            <button className="btn small ghost" onClick={() => { withdraw(state, 'attacker'); setTick(state.tick + 0.001); }}>
              전군 퇴각
            </button>
          </div>

          <div className="section-label">아군 부대</div>
          <div className="unit-list-v">
            {state.units
              .filter((u) => u.side === 'attacker' && !u.dead)
              .map((u) => (
                <button
                  key={u.id}
                  className={`unit-row${selected === u.id ? ' sel' : ''}${u.reserve ? ' reserve' : ''}`}
                  onClick={() => setSelected(u.id)}
                >
                  <i className="troop">{u.navy ? '船' : TROOP_MARK[u.troop]}</i>
                  <span className="nm">{u.name}</span>
                  <span className="num">{Math.round(u.troops).toLocaleString()}</span>
                  <span className={`bar ${u.morale < 40 ? 'low' : ''}`}>
                    <i style={{ width: `${Math.max(0, u.morale)}%` }} />
                  </span>
                  {u.reserve && <em className="faint">예비</em>}
                  {u.routed && <em className="bad">붕괴</em>}
                </button>
              ))}
          </div>

          {sel && sel.side === 'attacker' && (
            <>
              <div className="section-label">{sel.name} — {unitTitle(sel)}</div>
              <div className="faint" style={{ fontSize: 11 }}>
                사기 {Math.round(sel.morale)} · 피로 {Math.round(sel.fatigue)} · {ROW_LABEL[sel.row]}
                {sel.orderPoint && ' · 지점 이동 중'}
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {(Object.keys(STANCE) as Stance[]).map((s) => (
                  <button
                    key={s}
                    className={`btn small${sel.stance === s ? ' on' : ''}`}
                    onClick={() => { setStance(state, 'attacker', s, sel.id); setTick(state.tick + 0.001); }}
                  >
                    {STANCE[s].name}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                {sel.reserve && (
                  <button
                    className="btn small primary"
                    onClick={() => { commitReserve(state, sel.id); setTick(state.tick + 0.001); }}
                  >
                    예비대 투입
                  </button>
                )}
                <button className="btn small" onClick={() => { releaseOrders(state, sel.id); setTick(state.tick + 0.001); }}>
                  명령 해제
                </button>
                <button className="btn small ghost" onClick={() => { withdraw(state, 'attacker', sel.id); setTick(state.tick + 0.001); }}>
                  퇴각
                </button>
              </div>
              <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>
                빈 땅을 누르면 그리로 보냅니다 — 고지 선점·여울 차단
              </div>

              {sel.troop === 'str' && (
                <>
                  <div className="section-label">계략</div>
                  {(Object.keys(SCHEMES) as SchemeId[]).map((id) => {
                    const err = schemeError(state, sel, id, atkTiers);
                    const target = state.units.find((u) => u.side === 'defender' && !u.dead);
                    return (
                      <div key={id} className="row" style={{ gap: 6, marginBottom: 3 }}>
                        <button
                          className="btn small"
                          disabled={!!err || !target}
                          title={SCHEMES[id].desc}
                          onClick={() => {
                            const t = selectedFoe(state, selected) ?? target;
                            if (!t) return;
                            const e = castScheme(state, sel.id, id, t.id, atkTiers, intOf);
                            if (e) notify(e);
                            setTick(state.tick + 0.001);
                          }}
                        >
                          {SCHEMES[id].name}
                        </button>
                        <span className="faint" style={{ fontSize: 10.5 }}>
                          {err ?? SCHEMES[id].desc}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          <div className="section-label">전투 기록</div>
          <div className="field-log">
            {state.log
              .slice(-60)
              .reverse()
              .map((l, i) => (
                <div key={i} className={l.big ? 'big' : ''}>
                  <span className="when num">
                    {Math.floor(l.tick / 3600)}:{String(Math.floor((l.tick % 3600) / 60)).padStart(2, '0')}
                  </span>
                  {l.text}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 고른 것이 적이면 그 적을, 아니면 null */
function selectedFoe(st: FieldState, id: string | null) {
  const u = st.units.find((x) => x.id === id);
  return u && u.side === 'defender' && !u.dead ? u : null;
}

