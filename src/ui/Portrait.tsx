/**
 * Portrait.tsx — 인물 초상(肖像).
 *
 * 인물이 310명이다. 다 그리면 프로젝트가 죽고, 안 그리면 이름 첫 글자만 남는다.
 * 그래서 `docs/design-tokens.md` §6.4 의 3급 전략 가운데 **3급(프로그래밍 생성)**
 * 을 먼저 세운다 — 실루엣 + 세력 문양 + 관직색을, 인물 id 에서 결정론적으로 만든다.
 * 나중에 1·2급 그림이 들어오면 이 자리를 그림으로 갈아 끼우면 된다
 * (`hasDrawnPortrait` 한 군데만 고치면 된다).
 *
 * 무엇이 무엇을 말하는가 (문서 원칙 ② — 형태가 정보를 담고 색은 보조다):
 *   옷 색   = 세력       — 목록을 훑을 때 누구 사람인지가 먼저 보인다
 *   관모 형태 = 역할      — 투구(무장) · 관(문관) · 절풍(왕족) · 민머리(승려) · 두건(장인)
 *   조우(새깃) = 군주      — 왕만 두 깃을 세운다
 *   바탕 문양 = 세력       — 삼족오 · 연화 · 금관 · 철정
 *
 * 나머지(얼굴 폭, 수염, 어깨 너비)는 id 해시로 갈린다. 같은 사람은 언제 봐도 같은
 * 얼굴이어야 하므로 난수를 쓰지 않는다.
 */

import { memo } from 'react';
import { T } from './tokens';
import type { FactionId, OfficerDef } from '../core/types';

/** 세력색. `data.ts` 의 factionColor 와 같은 값이지만 무소속(null)도 받는다. */
const ROBE: Record<string, string> = {
  goguryeo: T.goguryeo,
  baekje: T.baekje,
  silla: T.silla,
  gaya: T.gaya,
};

/**
 * FNV-1a. 같은 id 면 언제나 같은 값 — 초상이 새로고침마다 바뀌면 안 된다.
 *
 * 돌려준 값은 부호 없는 32비트다. 꺼내 쓸 때도 반드시 `>>>` 로 밀어야 한다.
 * `>>` 로 밀면 최상위 비트가 선 절반(310명 중 170명)이 음수가 되고, 음수 % n
 * 이 음수로 나와 갈래가 한쪽으로 쏠린다.
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 세력 문양 — 바탕에 옅게 깔리는 표식.
 * 38px 로 줄었을 때 형태가 남아야 하므로 획을 극단적으로 줄였다.
 * 삼족오를 새 모양으로 그리면 그 크기에서는 얼룩이 된다.
 */
function crest(faction: FactionId | null) {
  switch (faction) {
    case 'goguryeo':
      // 삼족오 — 해(원) 안의 세 발
      return (
        <>
          <circle cx={24} cy={26} r={13} />
          <path d="M24 39 L20 47 M24 39 L24 48 M24 39 L28 47" strokeWidth={2.4} fill="none" />
        </>
      );
    case 'baekje':
      // 연화문 — 여덟 꽃잎 대신 네 잎 + 씨방
      return (
        <>
          <circle cx={24} cy={27} r={4.5} />
          <path d="M24 9 Q31 20 24 22 Q17 20 24 9 Z" />
          <path d="M24 45 Q31 34 24 32 Q17 34 24 45 Z" />
          <path d="M6 27 Q17 34 19 27 Q17 20 6 27 Z" />
          <path d="M42 27 Q31 34 29 27 Q31 20 42 27 Z" />
        </>
      );
    case 'silla':
      // 금관 — 出자형 세움장식
      return (
        <path
          d="M8 46 L8 20 L14 20 L14 10 L20 10 L20 20 L28 20 L28 10 L34 10 L34 20 L40 20 L40 46 Z"
          fillRule="evenodd"
        />
      );
    case 'gaya':
      // 철정(덩이쇠) — 가운데가 잘록한 판상 철기 둘
      return (
        <>
          <path d="M10 14 L38 14 L32 27 L38 40 L10 40 L16 27 Z" />
        </>
      );
    default:
      return null;
  }
}

/** 관모 — 역할이 형태를 정한다. y 는 정수리(≈13) 기준. */
function headgear(role: OfficerDef['role'], ruler: boolean, seed: number) {
  const ink = T.meok;
  switch (role) {
    case 'monk':
      // 승려 — 쓰지 않는다. 민머리 자체가 표식이다.
      return null;
    case 'artisan':
      // 장인 — 머리를 감싼 두건. 뒤로 묶은 끝자락이 한 가닥 내려온다.
      return (
        <>
          <path d="M13 20 Q13 7 24 7 Q35 7 35 20 L35 22 L13 22 Z" fill={ink} />
          <path d="M35 19 L41 26 L36 26 Z" fill={ink} />
        </>
      );
    case 'civil':
      // 문관 — 납작한 관(冠). 이마 위로 곧게 선 앞면.
      return (
        <>
          <path d="M14 19 L14 9 L34 9 L34 19 Z" fill={ink} />
          <path d="M11 18 L37 18 L37 21.5 L11 21.5 Z" fill={ink} />
        </>
      );
    case 'royal':
      // 왕족 — 절풍(고깔). 군주는 조우(새깃) 둘을 세운다.
      return (
        <>
          {ruler && (
            <path d="M14 12 Q10 2 15 0 Q16 7 18 11 Z M34 12 Q38 2 33 0 Q32 7 30 11 Z" fill={ink} />
          )}
          <path d="M24 1 L34 19 L14 19 Z" fill={ink} />
          <path d="M11 18 L37 18 L37 21.5 L11 21.5 Z" fill={ink} />
        </>
      );
    default: {
      // 무장 — 둥근 투구에 볼가리개. 해시로 정수리 장식이 갈린다.
      const spike = seed % 3 === 0;
      return (
        <>
          {spike && <path d="M24 0 L26.5 7 L21.5 7 Z" fill={ink} />}
          {/* 정수리는 속을 비우지 않는다 — 비우면 투구가 아니라 머리띠로 읽힌다 */}
          <path d="M12 21 Q12 5 24 5 Q36 5 36 21 Z" fill={ink} />
          <path d="M10.5 18 L37.5 18 L37.5 21.5 L10.5 21.5 Z" fill={ink} />
          {/* 볼가리개 — 얼굴을 덮지 않고 귀 바깥으로만 내려온다 */}
          <path
            d="M10.5 21.5 L14 21.5 L14 31 L10.5 29 Z M37.5 21.5 L34 21.5 L34 31 L37.5 29 Z"
            fill={ink}
          />
        </>
      );
    }
  }
}

/** 수염 — 해시로 갈리되, 나이가 있으면 긴 쪽이 나오게 기울인다. */
function beard(kind: number) {
  const ink = T.meok;
  switch (kind) {
    case 0:
      return null; // 무수염 — 젊은 장수
    case 1:
      // 콧수염만
      return <path d="M19 32 Q24 34 29 32 L29 34.5 Q24 36.5 19 34.5 Z" fill={ink} />;
    case 2:
      // 짧은 턱수염
      return (
        <>
          <path d="M19 32 Q24 34 29 32 L29 34.5 Q24 36.5 19 34.5 Z" fill={ink} />
          <path d="M19.5 37 Q24 43 28.5 37 Q24 40.5 19.5 37 Z" fill={ink} />
        </>
      );
    default:
      // 긴 수염 — 가슴까지 내려온다
      return (
        <>
          <path d="M19 32 Q24 34 29 32 L29 34.5 Q24 36.5 19 34.5 Z" fill={ink} />
          <path d="M17.5 36 Q24 40 30.5 36 Q29.5 48 24 52 Q18.5 48 17.5 36 Z" fill={ink} />
        </>
      );
  }
}

interface Props {
  def: OfficerDef;
  /** 폭(px). 높이는 6:7 비율로 따라온다. */
  size?: number;
  /** 이미 행동을 마친 인물 등, 흐리게 보일 때 */
  dim?: boolean;
}

export const Portrait = memo(function Portrait({ def, size = 44, dim }: Props) {
  const h = hash(def.id);
  const robe = ROBE[def.faction ?? ''] ?? T.meokMid;

  // 얼굴 폭과 어깨 너비는 사람마다 조금씩 다르다. 무력이 높으면 어깨가 넓다 —
  // 능력치를 그림이 말하게 하는 유일한 자리다.
  const faceW = 8.6 + ((h >>> 3) % 5) * 0.34;
  const build = 0.86 + Math.min(1, def.stats.war / 100) * 0.28;
  const sx = 24 - 22 * build; // 어깨 바깥선
  // 나이가 있으면 긴 수염 쪽으로 기운다. 승려는 수염을 두지 않는다.
  const old = (def.age ?? 40) >= 45;
  const beardKind = def.role === 'monk' ? 0 : ((h >>> 7) % 4) + (old ? 1 : 0);

  return (
    <svg
      className={`portrait-svg${dim ? ' dim' : ''}`}
      width={size}
      height={Math.round((size * 7) / 6)}
      viewBox="0 0 48 56"
      role="img"
      aria-label={`${def.name} 초상`}
    >
      {/* 바탕 — 지(紙). 그 위에 세력 문양을 옅게 깐다 */}
      <rect x={0} y={0} width={48} height={56} fill={T.jiDeep} />
      {/* 문양은 viewBox 밖으로 나가는 부분이 저절로 잘린다 — clipPath 를 두면
          같은 id 가 화면에 수십 개 생기므로 그리는 순서로 해결한다 */}
      <g fill={robe} stroke={robe} opacity={0.15}>
        {crest(def.faction)}
      </g>

      {/* 옷 — 세력색. 목록을 훑을 때 가장 먼저 읽히는 정보다 */}
      <path
        d={`M${sx} 56 L${sx} 51 Q${sx} 45 ${sx + 7} 43 L18 40 L30 40 L${48 - sx - 7} 43 Q${48 - sx} 45 ${48 - sx} 51 L${48 - sx} 56 Z`}
        fill={robe}
        stroke={T.meok}
        strokeWidth={1.2}
      />
      {/* 깃 — 왼섶을 위로 여민다 */}
      <path d="M24 40 L18.5 45 L24 54 L29.5 45 Z" fill={T.ji} stroke={T.meok} strokeWidth={1} />

      {/* 목 */}
      <path d="M20.5 34 L27.5 34 L27.5 43 L20.5 43 Z" fill={T.ji} stroke={T.meok} strokeWidth={1} />
      {/* 얼굴 */}
      <ellipse cx={24} cy={26} rx={faceW} ry={11.2} fill={T.ji} stroke={T.meok} strokeWidth={1.2} />
      {/* 눈 — 점 두 개. 선을 더 넣으면 38px 에서 뭉갠다 */}
      <path
        d={`M${24 - faceW * 0.46} 27.5 h3 M${24 + faceW * 0.46 - 3} 27.5 h3`}
        stroke={T.meok}
        strokeWidth={1.6}
        strokeLinecap="butt"
      />
      {beard(beardKind)}
      {headgear(def.role, def.ruler, h >>> 11)}

      {/* 테두리 — 문서 §7, 직각에 오프셋만. 안쪽 한 겹을 더 둘러 액자로 읽히게 한다 */}
      <rect x={0.75} y={0.75} width={46.5} height={54.5} fill="none" stroke={T.meok} strokeWidth={1.5} />
      <rect
        x={3}
        y={3}
        width={42}
        height={50}
        fill="none"
        stroke={T.meok}
        strokeWidth={0.6}
        opacity={0.45}
      />
    </svg>
  );
});
