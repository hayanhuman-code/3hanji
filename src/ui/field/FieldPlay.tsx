/**
 * FieldPlay.tsx — 전투를 보고 개입하는 화면.
 *
 * 단독 시뮬레이터와 실제 전략 턴의 전투가 **같은 컴포넌트**를 쓴다.
 * 다른 것은 판이 어디서 왔는지와 끝났을 때 어디로 가는지 둘뿐이고,
 * 그 둘만 prop 으로 받는다. 두 벌로 두면 「시뮬레이터에서는 되는데 실전에서는
 * 안 되는」 차이가 생긴다.
 *
 * 배속은 §4.9 그대로다 — **틱을 더 많이 도는 것**이지 다른 공식이 아니다.
 * 그래서 8배속으로 본 판과 1배속으로 본 판의 결과가 한 톨도 다르지 않다.
 */

import { useEffect, useRef, useState } from 'react';
import { factionName } from '../../core/data';
import { ROW_LABEL, STANCE } from '../../core/field/balance';
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
import {
  SIEGE_SCHEMES,
  castSiegeScheme,
  infiltrate,
  setSiegeMode,
  siegeSchemeError,
  type SiegeSchemeId,
} from '../../core/field/siege';
import { step, unitTitle, type StatsLookup } from '../../core/field/sim';
import { RngCursor } from '../../core/rng';
import type { FieldState, Side, Stance, Tier } from '../../core/field/types';
import { TICKS_PER_SEC } from '../../core/field/types';
import { TROOP_MARK, type Troop } from '../../core/types';
import { FieldCanvas } from './FieldCanvas';
import { fxEnabled, setFxEnabled } from './effects';

const SPEEDS = [1, 2, 4, 8] as const;

const PHASE_LABEL: Record<string, string> = {
  march: '행군',
  clash: '접전',
  waver: '동요',
  pursuit: '추격·퇴각',
  done: '종료',
};

export interface FieldPlayProps {
  state: FieldState;
  statsOf: StatsLookup;
  /** 지력 조회 — 계략 성공 판정에 쓴다 */
  intOf: (id: string) => number;
  /** 플레이어가 맡은 쪽. null 이면 관전만 */
  side: Side | null;
  /** 그쪽의 병종 단계 — 계략 조건 검사에 쓴다 */
  tiers: Record<Troop, Tier>;
  /** 판이 바뀌었다고 바깥에 알린다 (코어가 제자리에서 고치므로 필요) */
  onTouch?: () => void;
  /** 즉시결판. 없으면 이 화면이 직접 끝까지 돌린다 */
  onSettle: () => void;
  /** 끝난 뒤 나가는 단추 */
  finishLabel: string;
  onFinish: () => void;
  /** 안내 문구 */
  notify?: (msg: string) => void;
}

export function FieldPlay({
  state,
  statsOf,
  intOf,
  side,
  tiers,
  onTouch,
  onSettle,
  finishLabel,
  onFinish,
  notify,
}: FieldPlayProps) {
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const [running, setRunning] = useState(true);
  const [fx, setFx] = useState(fxEnabled());
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(state.tick);
  const raf = useRef<number | null>(null);
  const carry = useRef(0);
  const last = useRef(0);
  /**
   * 명령을 내려도 틱은 안 올라간다. 그런데 화면은 판이 바뀐 것을 알아야 하므로
   * 다시 그릴 구실이 따로 필요하다. (시뮬레이션 쪽 난수는 전부 시드에서 나온다 —
   * 여기 Math.random 을 쓰면 그 규칙이 흐려지므로 세는 값으로 둔다)
   */
  const nudge = useRef(0);

  /** 명령을 내린 뒤 — 코어를 제자리에서 고쳤으니 화면에 알린다 */
  const changed = () => {
    nudge.current += 1;
    setTick(state.tick + nudge.current * 1e-4);
    onTouch?.();
  };

  /* 배속 — 틱을 더 도는 것일 뿐이다. 렌더는 언제나 프레임마다 한 번 (§4.9) */
  useEffect(() => {
    if (!running || state.phase === 'done') return;
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
      if (state.phase === 'done') onTouch?.();
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      last.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, running, speed]);

  const mySide: Side = side ?? 'attacker';
  const sel = state.units.find((u) => u.id === selected && !u.dead) ?? null;
  const mine = state.units.filter((u) => u.side === mySide && !u.dead);
  const theirs = state.units.filter((u) => u.side !== mySide && !u.dead);
  const troopsOf = (list: typeof mine) => Math.round(list.reduce((s, u) => s + u.troops, 0));
  const hours = Math.floor(state.tick / 3600);
  const mins = Math.floor((state.tick % 3600) / 60);
  const atk = state.attackerFaction;
  const def = state.defenderFaction;
  const sg = state.siegeState;
  const warden = state.siegeCtx;
  const riverside = state.field.hasRiver;

  return (
    <div className="field">
      <div className="field-head">
        {/* 읽는 것과 누르는 것을 나눠 둔다. 폰에서 두 줄로 갈라지는 자리다 */}
        <div className="field-info">
          <b style={{ fontSize: 16 }}>{state.field.name}</b>
          <span className="tag">{PHASE_LABEL[state.phase]}</span>
          <span className="tag num">
            {hours}시간 {String(mins).padStart(2, '0')}분
          </span>
          <span className="row" style={{ gap: 6 }}>
            <i className="swatch" style={{ background: `var(--f-${atk})` }} />
            {factionName(atk)}{' '}
            <b className="num">
              {troopsOf(mySide === 'attacker' ? mine : theirs).toLocaleString()}
            </b>
            <span className="faint">vs</span>
            <i className="swatch" style={{ background: `var(--f-${def})` }} />
            {factionName(def)}{' '}
            <b className="num">
              {troopsOf(mySide === 'defender' ? mine : theirs).toLocaleString()}
            </b>
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
                className={`btn small${fx ? ' on' : ''}`}
                title="타격·화살·투석 등 전투 연출을 켜고 끈다"
                onClick={() => {
                  setFxEnabled(!fx);
                  setFx(!fx);
                }}
              >
                이펙트
              </button>
              <button
                className="btn small"
                title="같은 시뮬레이션을 렌더링 없이 끝까지 돌린다"
                onClick={() => {
                  setRunning(false);
                  onSettle();
                  setTick(state.tick);
                }}
              >
                즉시결판
              </button>
            </>
          ) : (
            <button className="btn primary small" onClick={onFinish}>
              {finishLabel}
            </button>
          )}
        </div>
      </div>

      <div className="field-body">
        <FieldCanvas
          state={state}
          tick={tick}
          speed={speed}
          selected={selected}
          onSelectUnit={setSelected}
          onPickPoint={(x, y) => {
            // 빈 땅을 누르면 고른 아군 부대를 그리로 보낸다 — 고지 선점·여울 차단
            if (side && sel && sel.side === side) {
              moveTo(state, sel.id, x, y);
              changed();
            } else setSelected(null);
          }}
        />

        <div className="field-side">
          {state.result && (
            <div className="card" style={{ padding: 10, marginBottom: 10 }}>
              <h3 style={{ fontSize: 15 }}>
                {state.result.winner === null
                  ? '무승부 — 해가 저물었다'
                  : `${factionName(state.result.winner === 'attacker' ? atk : def)} 승리`}
              </h3>
              <p className="num">
                공격 손실 {state.result.attackerLoss.toLocaleString()}
                <br />
                수비 손실 {state.result.defenderLoss.toLocaleString()}
              </p>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn primary small" onClick={onFinish}>
                  {finishLabel}
                </button>
              </div>
            </div>
          )}

          {/*
            공성전의 첫 판단은 태세가 아니라 **어떻게 들어갈 것인가**다 (§6.3).
            그래서 성 상태와 네 수단을 태세보다 위에 둔다.
          */}
          {side === 'attacker' && sg && !sg.breached && (
            <>
              <div className="section-label" style={{ marginTop: 0 }}>
                성 — {state.field.name}
              </div>
              <div className="siege-gauge">
                <span>성문</span>
                <span className="bar">
                  <i style={{ width: `${(sg.gateHp / Math.max(1, sg.gateMax)) * 100}%` }} />
                </span>
                <span className="num">{Math.round(sg.gateHp).toLocaleString()}</span>
              </div>
              <div className="siege-gauge">
                <span>성벽</span>
                <span className="bar">
                  <i style={{ width: `${(sg.wallHp / Math.max(1, sg.wallMax)) * 100}%` }} />
                </span>
                <span className="num">{Math.round(sg.wallHp).toLocaleString()}</span>
              </div>
              <div className="siege-gauge">
                <span>병량</span>
                <span className={`bar ${sg.grain <= 0 ? 'low' : ''}`}>
                  <i style={{ width: `${(sg.grain / Math.max(1, sg.grainMax)) * 100}%` }} />
                </span>
                <span className="num">{Math.round(sg.grain).toLocaleString()}</span>
              </div>
              {/*
                포위는 명령이 아니라 자리다 — 「포위」를 눌러도 길이 안 끊겼으면
                병량은 한 톨도 안 준다. 그 사실을 여기서 보여 주지 않으면
                플레이어는 왜 아무 일도 안 일어나는지 알 길이 없다.
              */}
              <div className="siege-gauge">
                <span>봉쇄</span>
                <span className="num" style={{ marginLeft: 'auto' }}>
                  {sg.encircled ? '길이 모두 끊겼다' : '아직 길이 있다'}
                </span>
              </div>

              <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  className={`btn small${sg.mode === 'assault' ? ' on' : ''}`}
                  title="성문을 친다. 빠르지만 비싸다 — 보병 4단계의 공성병기가 정석이다"
                  onClick={() => {
                    setSiegeMode(state, sg, 'assault');
                    changed();
                  }}
                >
                  강공
                </button>
                <button
                  className={`btn small${sg.mode === 'encircle' ? ' on' : ''}`}
                  title="성문으로 드는 길목에 부대를 세워 막는다. 길이 다 끊겨야 병량이 마른다 — 성문이 둘뿐인 산성은 막히고, 사방이 열린 평산성은 열두 부대로도 안 막힌다"
                  onClick={() => {
                    setSiegeMode(state, sg, 'encircle');
                    changed();
                  }}
                >
                  포위
                </button>
                <button
                  className="btn small"
                  disabled={sg.infiltrated}
                  title="첩자를 넣어 성문을 연다. 한 번뿐이고, 야심가가 지키는 성일수록 잘 통한다"
                  onClick={() => {
                    const rng = new RngCursor(state.rngCursor);
                    infiltrate(state, sg, warden.wardenChr, warden.wardenTrait, rng);
                    state.rngCursor = rng.seed;
                    changed();
                  }}
                >
                  내응
                </button>
              </div>

              <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {(Object.keys(SIEGE_SCHEMES) as SiegeSchemeId[]).map((id) => {
                  const err = siegeSchemeError(state, sg, id, tiers.str, riverside);
                  return (
                    <button
                      key={id}
                      className="btn small"
                      disabled={!!err}
                      title={err ?? SIEGE_SCHEMES[id].desc}
                      onClick={() => {
                        const e = castSiegeScheme(state, sg, id, tiers.str, riverside, 0.85);
                        if (e) notify?.(e);
                        changed();
                      }}
                    >
                      {SIEGE_SCHEMES[id].name}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {side && (
            <>
              <div className="section-label">전군 태세</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                {(Object.keys(STANCE) as Stance[]).map((s) => (
                  <button
                    key={s}
                    className="btn small"
                    title={STANCE[s].desc}
                    onClick={() => {
                      setStance(state, side, s);
                      changed();
                    }}
                  >
                    {STANCE[s].name}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 4, marginTop: 6 }}>
                <button
                  className="btn small"
                  title="무너진 적을 쫓는다. 섬멸하면 이득이 크지만 진형이 흐트러진다"
                  onClick={() => {
                    pursue(state, side, true);
                    changed();
                  }}
                >
                  추격
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    pursue(state, side, false);
                    changed();
                  }}
                >
                  정지
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    withdraw(state, side);
                    changed();
                  }}
                >
                  전군 퇴각
                </button>
              </div>
            </>
          )}

          <div className="section-label">{side ? '아군 부대' : '공격 측'}</div>
          <div className="unit-list-v">
            {mine.map((u) => (
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

          {side && sel && sel.side === side && (
            <>
              <div className="section-label">
                {sel.name} — {unitTitle(sel)}
              </div>
              <div className="faint" style={{ fontSize: 11 }}>
                사기 {Math.round(sel.morale)} · 피로 {Math.round(sel.fatigue)} · {ROW_LABEL[sel.row]}
                {sel.orderPoint && ' · 지점 이동 중'}
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {(Object.keys(STANCE) as Stance[]).map((s) => (
                  <button
                    key={s}
                    className={`btn small${sel.stance === s ? ' on' : ''}`}
                    title={STANCE[s].desc}
                    onClick={() => {
                      setStance(state, side, s, sel.id);
                      changed();
                    }}
                  >
                    {STANCE[s].name}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                {sel.reserve && (
                  <button
                    className="btn small primary"
                    onClick={() => {
                      commitReserve(state, sel.id);
                      changed();
                    }}
                  >
                    예비대 투입
                  </button>
                )}
                <button
                  className="btn small"
                  title="찍어 준 목표와 지점을 지운다. 다시 계열 규칙대로 움직인다"
                  onClick={() => {
                    releaseOrders(state, sel.id);
                    changed();
                  }}
                >
                  명령 해제
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    withdraw(state, side, sel.id);
                    changed();
                  }}
                >
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
                    const err = schemeError(state, sel, id, tiers);
                    // 적을 골라 두었으면 그 적에게, 아니면 가장 가까운 적에게
                    const picked = state.units.find(
                      (u) => u.id === selected && u.side !== side && !u.dead
                    );
                    const nearest = theirs
                      .slice()
                      .sort(
                        (a, b) =>
                          Math.hypot(a.x - sel.x, a.y - sel.y) - Math.hypot(b.x - sel.x, b.y - sel.y)
                      )[0];
                    const target = picked ?? nearest;
                    return (
                      <div key={id} className="row" style={{ gap: 6, marginBottom: 3 }}>
                        <button
                          className="btn small"
                          disabled={!!err || !target}
                          title={SCHEMES[id].desc}
                          onClick={() => {
                            if (!target) return;
                            const e = castScheme(state, sel.id, id, target.id, tiers, intOf);
                            if (e) notify?.(e);
                            changed();
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
                <div key={`${l.tick}-${i}`} className={l.big ? 'big' : ''}>
                  <span className="when num">
                    {Math.floor(l.tick / 3600)}:
                    {String(Math.floor((l.tick % 3600) / 60)).padStart(2, '0')}
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
