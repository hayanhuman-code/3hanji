#!/usr/bin/env python3
"""samhanji asset pipeline — AI 생성 원본 → 게임용 픽셀아트 에셋 후처리.

사용법:
    python tools/asset_pipeline/process.py              # 전체 일괄 처리
    python tools/asset_pipeline/process.py --swap-only  # 진영색 스왑 + 미리보기만 재실행

입력:  tools/asset_pipeline/raw/       (AI 생성 원본 PNG)
출력:  tools/asset_pipeline/processed/ (게임용 에셋 + 미리보기)

게임 코드와 독립된 도구이며, 의존성은 Pillow + numpy 뿐이다.
(rembg가 설치되어 있으면 배경 제거 폴백으로만 사용)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# 설정부
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "raw"
OUT_DIR = ROOT / "processed"
FACTION_DIR = OUT_DIR / "factions"
WORK_DIR = OUT_DIR / "_work"  # 배경 제거된 원본 해상도 중간물 (--swap-only 캐시)

# 파일명 접두사 → (목표 크기, 카테고리)
TARGET_SIZES = {
    "tile_": ((32, 32), "tile"),
    "obj_": ((32, 32), "object"),
    "unit_": ((32, 32), "unit"),
    "portrait_": ((96, 96), "portrait"),  # 현재 에셋 없음 — 규칙만 준비
}
# 접두사 규칙의 예외 (가로로 넓은 구조물 등)
SIZE_OVERRIDES = {
    "obj_gate": (64, 32),
}

# [타일] 중앙 크롭: 바깥 8%씩 잘라내고 중앙 84%만 사용 (AI 가장자리 테두리 제거)
TILE_EDGE_TRIM = 0.08

# 색상 양자화: 이미지당 최대 색상 수 (디더링 없음)
QUANT_COLORS = 32

# [유닛/오브젝트] 배경 제거 — 회색 단색 배경(RGB 145 부근).
# 테두리 픽셀에서 배경색을 자동 추정하되, 추정 실패 시 BG_REFERENCE 사용.
BG_REFERENCE = (145, 145, 145)
BG_THRESHOLD = 40          # 배경으로 간주할 색 거리 (유클리드)
BG_BORDER_STD_MAX = 12.0   # 테두리 표준편차가 이보다 크면 자동 추정 포기
BG_RESIDUE_LIMIT = 0.02    # 제거 후 테두리 잔존 불투명 비율 — 초과 시 rembg 폴백

# [유닛] 진영색 팔레트 스왑 ------------------------------------------------
# 치환 기준색: 갑옷·의복의 갈색/보라 계열 (원본 유닛에서 실측한 값)
SWAP_SOURCE = [
    # 갑옷 갈색/회갈색 계열 (보병·궁병·기병 공용)
    (131, 116, 109),
    (116, 103, 98),
    (104, 88, 83),
    (94, 70, 61),
    (85, 67, 60),
    (82, 68, 64),
    (72, 66, 64),
    (66, 50, 46),
    (65, 55, 51),
    (59, 45, 40),
    (55, 49, 48),
    (42, 36, 34),
    (30, 19, 15),
    (28, 16, 12),
    # 책사 도포 보라 계열
    (48, 28, 40),
    (45, 27, 39),
    (10, 5, 7),
]
# 스왑에서 보호할 색 (피부·무기·윤곽선) — SWAP_SOURCE보다 가까우면 치환 금지
SWAP_EXCLUDE = [
    # 피부
    (232, 190, 158),
    (210, 160, 125),
    (180, 130, 100),
    (162, 141, 133),
    # 무기 목재 (채도 높은 갈색 — 창 자루 등)
    (97, 61, 42),
    (60, 38, 25),
    (45, 28, 20),
    # 윤곽선/그림자 (근흑색)
    (5, 3, 3),
    (16, 10, 8),
]
# 특정 유닛에만 추가로 보호할 색 (파일명 stem 기준)
SWAP_EXCLUDE_EXTRA = {
    # 말: 채도 높은 적갈색 + 다리 회갈색 + 회색 발굽
    "unit_cavalry": [
        (93, 57, 41),
        (91, 60, 47),
        (86, 56, 43),
        (85, 56, 44),
        (77, 59, 53),
        (71, 49, 41),
        (70, 48, 41),
        (61, 43, 36),
        (46, 40, 39),
        (96, 93, 92),
        (84, 64, 57),
        (46, 26, 17),
    ],
}
SWAP_THRESHOLD = 34   # 이 거리 이내로 SWAP_SOURCE에 근접해야 치환
SWAP_LUMA_MIN = 26    # 이보다 어두운 픽셀은 치환하지 않음 (윤곽선·짙은 그림자 보호)
SWAP_MIN_CHROMA = 5   # 채널 편차(max-min)가 이 미만인 무채색 픽셀은 치환하지 않음
                      # (배경 회색과 윤곽선 사이의 AA 혼합 픽셀 보호)

# 진영별 명암 램프 (어두운 → 밝은 4단계). 원본 픽셀 밝기에 따라 단계 선택.
FACTIONS = {
    "goguryeo": [  # 검정 (조의선인 컨셉) — 순수 검정 금지, 짙은 회흑색까지만
        # 원안(#1a1a1f 시작)은 숲 타일 위에서 묻혀서 전체를 한 단계 밝게 시프트
        (0x2E, 0x2E, 0x36),
        (0x4A, 0x4A, 0x55),
        (0x6E, 0x6E, 0x7D),
        (0x92, 0x92, 0xA5),
    ],
    "baekje": [  # 자주색 (자색 도포 컨셉)
        (0x3D, 0x1F, 0x4D),
        (0x5C, 0x2E, 0x73),
        (0x7D, 0x44, 0x99),
        (0xA0, 0x66, 0xBF),
    ],
    "silla": [  # 금색 (금관 컨셉)
        (0x6E, 0x52, 0x14),
        (0x9C, 0x7A, 0x1F),
        (0xC9, 0xA5, 0x2E),
        (0xE8, 0xC9, 0x5A),
    ],
}
# 밝기 → 램프 단계 매핑에 쓰는 원본 밝기 범위 (SWAP_SOURCE 명암 폭 기준)
SWAP_LUMA_RANGE = (8.0, 125.0)

# [성벽 부품] obj_wall_* 전용 처리 ---------------------------------------
# 원본은 여백이 많아 그대로 축소하면 이어붙일 때 끊긴다. 배경 제거 후
# 내용물 bbox 를 완전히 잘라내고, 코너의 팔 두께를 실측해 가로/세로 벽을
# 같은 두께의 띠로 만들어 코너와 같은 변(하단/우측)에 정렬한다.
#
# 가로벽: 좌우 끝의 마감 기둥을 잘라 중앙 반복 구간만 (좌우가 칸 경계에 닿음)
WALL_H_SPAN = (0.065, 0.935)   # bbox 가로 사용 구간 (비율)
# 세로벽: 위아래 지붕 끝단 장식을 잘라 중앙 반복 구간만 (상하가 칸 경계에 닿음)
WALL_V_BAND = (0.175, 0.775)   # bbox 세로 사용 구간 (비율)
WALL_T_DEFAULT = 9             # 코너 실측 실패 시 벽 두께(px, 32 기준)

# [오토타일] 지형 경계 전환 타일 ----------------------------------------
# AI 로 경계 타일을 따로 만들지 않는다. 기존 타일 두 장을 마스크로 합성해
# 코드가 만든다 — 그래야 색과 화풍이 어긋날 여지가 없다.
#
# 우선순위: 낮은 쪽 위에 높은 쪽이 얹힌다 (물이 가장 위 = 물가가 가장 또렷)
TERRAIN_PRIORITY = [
    "grass", "road", "sand", "forest", "hill", "ridge", "mountain",
    "ford", "swamp", "river",
]
# 전환 패턴 — 4방위 비트마스크 16가지(0=전환 없음)에 대각 전용 4가지를 더한다.
#   0~15 : N=1, E=2, S=4, W=8 조합
#   16~19: NE, SE, SW, NW (대각만 높은 지형일 때의 모서리 물림)
AUTOTILE_PATTERNS = 20
AT_DEPTH = 9.0      # 높은 지형이 파고드는 기본 깊이(px, 32 기준)
AT_JITTER = 3.2     # 경계 들쭉날쭉함의 진폭(px). 0 이면 직선
AT_DITHER = 2.2     # 경계 주변 흩뿌림 띠의 폭(px) — 픽셀 단위 침식감
AT_CORNER_R = 13.0  # 대각 패턴의 모서리 반지름(px)
AT_SEED = 20260819  # 시드 고정 — 같은 조합은 언제 돌려도 같은 결과
# 실제 맵에서 맞닿는 지형 쌍만 만든다 (없으면 전체 조합으로 되돌아간다)
BATTLEMAPS_JSON = ROOT.parent.parent / "src" / "data" / "battlemaps.json"
BATTLEMAP_TILE_CODE = {
    ".": "grass", "r": "road", "f": "forest", "h": "hill",
    "m": "mountain", "~": "river", "=": "ford", "S": "sand", "B": "bridge",
    # 험지(X)는 바위 능선 타일을, 늪(M)은 늪 타일을 쓴다 (src/ui/field/sprites.ts)
    "X": "ridge", "M": "swamp",
}

# [타일] 배경화 톤 다운 — 지형은 무대, 유닛이 주인공 --------------------
# 원본 processed/tile_*.png 는 보존하고 processed/toned/ 에 별도 출력한다.
TONE_SATURATION = 0.70   # 채도 배율 (-30%)
TONE_CONTRAST = 0.65     # 명암 대비 배율 (-35%, 중심 128 기준)
TONE_BRIGHTNESS = 6      # 밝기 가산 (0~255) — 아주 미세하게 밝은 쪽으로
TONE_BLACK_FLOOR = 30    # 완전 검정 완화: 밝기가 이보다 어두운 픽셀을 끌어올림
# 파일별 톤 오버라이드 — 기본값에서 벗어나야 하는 타일만 적어 둔다.
# 없는 키는 위 기본값을 그대로 쓴다.
TONE_OVERRIDES: dict[str, dict[str, float]] = {
    # 여울이 다른 타일보다 혼자 밝고 하얗게 튄다. 명도를 한 단계 낮추고
    # 채도를 올려 늪·강과 같은 물빛 계열로 읽히게 한다.
    "tile_ford": {"saturation": 1.05, "brightness": -44},
}

# 미리보기 확대 배율
PREVIEW_SCALE = 4
# 가독성 미리보기(_visibility_preview.png): 이 지형들 3x3 위에 3진영 유닛 배치
VISIBILITY_TILES = ["tile_forest", "tile_mountain"]
VISIBILITY_UNIT = "unit_infantry"


# ---------------------------------------------------------------------------
# 처리 단계 (함수별 분리)
# ---------------------------------------------------------------------------

def center_crop_tile(im: Image.Image, trim: float = TILE_EDGE_TRIM) -> Image.Image:
    """[타일 전용] 바깥 trim 비율만큼 잘라내고 중앙만 남긴다."""
    w, h = im.size
    dx, dy = int(round(w * trim)), int(round(h * trim))
    return im.crop((dx, dy, w - dx, h - dy))


def crop_to_content(im: Image.Image, aspect: tuple[int, int]) -> Image.Image:
    """비정사각 원본을 내용물(불투명 영역) 중심으로 목표 비율에 맞게 크롭.

    내용물 bbox를 목표 비율로 감싸는 최소 사각형을 잡고, 원본 밖으로
    나가는 부분은 투명 패딩으로 채운다. RGBA 전제.
    """
    a = np.array(im)
    alpha = a[..., 3]
    ys, xs = np.nonzero(alpha > 0)
    if len(xs) == 0:  # 내용물이 없으면 그대로
        return im
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    bw, bh = x1 - x0, y1 - y0
    ar_w, ar_h = aspect
    # bbox를 덮는 최소 aspect 사각형
    if bw * ar_h >= bh * ar_w:
        cw, ch = bw, int(np.ceil(bw * ar_h / ar_w))
    else:
        ch, cw = bh, int(np.ceil(bh * ar_w / ar_h))
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    left, top = cx - cw // 2, cy - ch // 2
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    canvas.paste(im, (-left, -top))
    return canvas


def downscale(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """NEAREST 방식으로 목표 크기로 축소."""
    return im.resize(size, Image.Resampling.NEAREST)


def quantize(im: Image.Image, colors: int = QUANT_COLORS) -> Image.Image:
    """이미지당 colors색 이하로 양자화 (디더링 없음). 알파는 그대로 유지."""
    has_alpha = im.mode == "RGBA"
    rgb = im.convert("RGB")
    q = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT,
                     dither=Image.Dither.NONE)
    out = q.convert("RGB")
    if has_alpha:
        out = out.convert("RGBA")
        out.putalpha(im.getchannel("A"))
        # 완전 투명 픽셀은 색을 0으로 통일 (파일 크기·색 수 안정화)
        a = np.array(out)
        a[a[..., 3] == 0] = 0
        out = Image.fromarray(a, "RGBA")
    return out


def _content_bbox(im: Image.Image) -> Image.Image:
    """불투명 내용물의 바운딩 박스로 완전히 잘라낸다."""
    a = np.array(im)
    ys, xs = np.nonzero(a[..., 3] > 0)
    if len(xs) == 0:
        return im
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


# 코너에서 실측한 팔 두께(px, 32 기준). 코너를 먼저 처리해 채운다.
_wall_arm: dict[str, int] = {}


def process_wall_piece(im: Image.Image, stem: str, size: tuple[int, int]) -> Image.Image:
    """[성벽 부품 전용] bbox 크롭 → 반복 구간 절취 → 코너와 두께·정렬 맞춤.

    - corner: bbox 를 그대로 32×32 로. 팔 두께(하단 h팔·우측 v팔)를 실측해 둔다
    - h: 끝 기둥을 잘라낸 중앙 구간을 (32 × 팔두께) 로 눌러 타일 하단에 정렬
    - v: 지붕 끝단을 잘라낸 중앙 구간을 (팔두께 × 32) 로 눌러 타일 우측에 정렬
    이렇게 하면 코너의 하단 변은 h와, 우측 변은 v와 두께가 맞는다.
    """
    im = _content_bbox(im)
    w, h = size

    # 성벽은 극단적 축소(1300→32px 급)라 NEAREST 는 벽돌 무늬가 점멸한다.
    # 부품에 한해 면적평균(BOX)으로 눌러 결을 남기고, 양자화로 색을 정리한다.
    # BOX 가 만든 반투명 경계는 이진화해 픽셀아트의 딱 떨어지는 변을 지킨다.
    def shrink(img: Image.Image, sz: tuple[int, int]) -> Image.Image:
        a = np.array(img.resize(sz, Image.Resampling.BOX))
        a[..., 3] = np.where(a[..., 3] >= 128, 255, 0)
        a[a[..., 3] == 0] = 0
        return Image.fromarray(a, "RGBA")

    if stem == "obj_wall_corner":
        out = quantize(shrink(im, size))
        a = np.array(out)
        # 안쪽 단면에서 팔 두께를 실측 (가장자리 열은 테이퍼가 있어 피한다)
        th_ = _wall_arm["h"] = max(2, int((a[:, 3, 3] > 0).sum()))
        tv_ = _wall_arm["v"] = max(2, int((a[3, :, 3] > 0).sum()))
        # 팔 끝 2열/2행을 안쪽 단면으로 복제 — 직선벽과의 이음 단면을 일치시킨다
        a[-th_:, 0] = a[-th_:, 2]
        a[-th_:, 1] = a[-th_:, 2]
        a[0, -tv_:] = a[2, -tv_:]
        a[1, -tv_:] = a[2, -tv_:]
        return Image.fromarray(a, "RGBA")

    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    if stem == "obj_wall_h":
        t = _wall_arm.get("h", WALL_T_DEFAULT)
        x0, x1 = (int(im.width * f) for f in WALL_H_SPAN)
        # 끝 기둥의 상하 돌출이 bbox 에 남긴 투명 여백을 다시 잘라낸다
        band = _content_bbox(im.crop((x0, 0, x1, im.height)))
        band = quantize(shrink(band, (w, t)))
        canvas.paste(band, (0, h - t))  # 코너의 h팔과 같은 하단 정렬
    else:  # obj_wall_v
        t = _wall_arm.get("v", WALL_T_DEFAULT)
        y0, y1 = (int(im.height * f) for f in WALL_V_BAND)
        # 지붕 처마 폭이 bbox 에 남긴 좌우 투명 여백을 다시 잘라낸다
        band = _content_bbox(im.crop((0, y0, im.width, y1)))
        band = quantize(shrink(band, (t, h)))
        canvas.paste(band, (w - t, 0))  # 코너의 v팔과 같은 우측 정렬
    return canvas


def tone_down_tile(im: Image.Image, stem: str = "") -> Image.Image:
    """[타일 전용] 배경화 필터 — 채도·대비를 낮추고 살짝 밝힌다.

    유닛 스프라이트와의 시각적 위계를 만들기 위한 후처리다. 검은 픽셀은
    TONE_BLACK_FLOOR 까지 끌어올려 어두운 지형에서도 윤곽이 뜨지 않게 한다.
    타일 하나가 혼자 튀면 TONE_OVERRIDES 에 그 파일만 값을 적어 둔다.
    """
    o = TONE_OVERRIDES.get(stem, {})
    saturation = o.get("saturation", TONE_SATURATION)
    contrast = o.get("contrast", TONE_CONTRAST)
    brightness = o.get("brightness", TONE_BRIGHTNESS)
    black_floor = o.get("black_floor", TONE_BLACK_FLOOR)

    a = np.array(im.convert("RGB")).astype(float)
    luma = a @ np.array([0.299, 0.587, 0.114])
    # 채도: 픽셀을 자기 밝기(회색)와 섞는다
    a = luma[..., None] + (a - luma[..., None]) * saturation
    # 대비: 중심 128 기준으로 눌러 준다
    a = 128 + (a - 128) * contrast
    # 밝기: 미세 가산
    a = a + brightness
    # 검정 완화: 밝기 하한 아래 픽셀을 균등 가산으로 끌어올림
    luma2 = a @ np.array([0.299, 0.587, 0.114])
    lift = np.clip(black_floor - luma2, 0, None)
    a = a + lift[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype("uint8"), "RGB")


def run_tone_down() -> list[dict]:
    """processed/tile_*.png 전체에 배경화 필터를 걸어 processed/toned/ 에 출력."""
    toned_dir = OUT_DIR / "toned"
    toned_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for path in sorted(OUT_DIR.glob("tile_*.png")):
        out = tone_down_tile(Image.open(path), path.stem)
        out_path = toned_dir / path.name
        out.save(out_path)
        results.append({"name": path.name, "colors": count_colors(out)})
    return results


def _edge_jitter(rng: np.random.Generator, n: int, amp: float) -> np.ndarray:
    """가장자리를 따라가는 들쭉날쭉한 깊이 변화.

    양 끝을 0 으로 맞춘다 — 같은 방향으로 전환이 이어지는 옆 타일과 만나는
    자리에서 깊이가 어긋나면 타일 경계에 계단이 생기기 때문이다.
    """
    walk = np.cumsum(rng.normal(0, 1, n))
    walk -= np.linspace(walk[0], walk[-1], n)  # 양 끝을 0 으로
    peak = np.abs(walk).max()
    return walk / peak * amp if peak > 1e-6 else walk


def autotile_mask(pattern: int, size: int, rng: np.random.Generator) -> np.ndarray:
    """전환 패턴의 알파 마스크(0~255). 높은 지형이 어디까지 파고드는가.

    각 활성 변에서 안쪽으로 파고드는 깊이를 부호 있는 값으로 재고, 여러 변이
    겹치면 가장 깊은 값을 쓴다. 경계선 부근 AT_DITHER 폭에서는 픽셀을
    확률적으로 흩뿌려 픽셀아트 특유의 침식감을 만든다.
    """
    ys, xs = np.mgrid[0:size, 0:size]
    signed = np.full((size, size), -1e6)

    def blend(v: np.ndarray) -> None:
        np.maximum(signed, v, out=signed)

    if pattern < 16:
        if pattern & 1:  # N
            blend(AT_DEPTH + _edge_jitter(rng, size, AT_JITTER)[xs] - ys)
        if pattern & 2:  # E
            blend(AT_DEPTH + _edge_jitter(rng, size, AT_JITTER)[ys] - (size - 1 - xs))
        if pattern & 4:  # S
            blend(AT_DEPTH + _edge_jitter(rng, size, AT_JITTER)[xs] - (size - 1 - ys))
        if pattern & 8:  # W
            blend(AT_DEPTH + _edge_jitter(rng, size, AT_JITTER)[ys] - xs)
    else:  # 16~19 — 대각 모서리에서 둥글게 물린다
        cx, cy = [(size - 1, 0), (size - 1, size - 1), (0, size - 1), (0, 0)][pattern - 16]
        r = np.hypot(xs - cx, ys - cy)
        # 각도에 따라 반지름을 흔들어 원이 아니라 침식된 모서리로 보이게
        ang = np.arctan2(ys - cy, xs - cx)
        wob = _edge_jitter(rng, 64, AT_JITTER)
        idx = ((ang + np.pi) / (2 * np.pi) * 63).astype(int).clip(0, 63)
        blend(AT_CORNER_R + wob[idx] - r)

    alpha = np.zeros((size, size), dtype=np.uint8)
    alpha[signed >= AT_DITHER] = 255
    band = (signed > -AT_DITHER) & (signed < AT_DITHER)
    if band.any():
        # 경계에 가까울수록 채워질 확률이 높다 (0 부근에서 반반)
        p = 0.5 + signed[band] / (2 * AT_DITHER)
        alpha[band] = np.where(rng.random(band.sum()) < p, 255, 0)
    return alpha


def run_autotiles(verbose: bool = True) -> int:
    """지형 쌍마다 전환 타일을 만들어 processed/autotile/ 에 낸다.

    파일 하나는 「낮은 지형 위에 높은 지형이 마스크만큼 얹힌」 32×32 불투명
    타일이다. 렌더러는 이 타일을 기본 타일 대신 그린다.
    """
    out_dir = OUT_DIR / "autotile"
    out_dir.mkdir(parents=True, exist_ok=True)
    toned = OUT_DIR / "toned"

    def tile_of(name: str) -> Image.Image | None:
        for p in (toned / f"tile_{name}.png", OUT_DIR / f"tile_{name}.png"):
            if p.exists():
                return Image.open(p).convert("RGBA")
        return None

    pairs = sorted(adjacent_terrain_pairs())
    rank = {t: i for i, t in enumerate(TERRAIN_PRIORITY)}
    made = 0
    for n, (a, b) in enumerate(pairs, 1):
        lo, hi = (a, b) if rank.get(a, -1) < rank.get(b, -1) else (b, a)
        im_lo, im_hi = tile_of(lo), tile_of(hi)
        if not im_lo or not im_hi:
            if verbose:
                print(f"  건너뜀: {lo}↔{hi} (타일 없음)")
            continue
        size = im_lo.width
        base = np.array(im_lo)[..., :3]
        over = np.array(im_hi.resize((size, size), Image.Resampling.NEAREST))[..., :3]
        for pattern in range(1, AUTOTILE_PATTERNS):
            # 시드는 쌍과 패턴에서만 나온다 — 언제 몇 번을 돌려도 같은 그림
            seed = (AT_SEED + hash((lo, hi, pattern)) % 1_000_003) % (2**32)
            rng = np.random.default_rng(seed)
            m = autotile_mask(pattern, size, rng)[..., None] > 0
            px = np.where(m, over, base).astype("uint8")
            img = quantize(Image.fromarray(px, "RGB"))
            img.save(out_dir / f"{lo}_{hi}_{pattern:02d}.png")
            made += 1
        if verbose:
            print(f"  [{n}/{len(pairs)}] {lo}→{hi} "
                  f"{AUTOTILE_PATTERNS - 1}패턴  (누적 {made})")
    return made


def adjacent_terrain_pairs() -> set[tuple[str, str]]:
    """전장 데이터에서 실제로 맞닿는 지형 쌍을 모은다.

    쓰이지 않는 조합까지 만들면 파일만 수백 장 늘어난다. 데이터를 못 읽으면
    우선순위 목록의 모든 조합으로 되돌아간다.
    """
    import itertools
    import json

    try:
        maps = json.loads(BATTLEMAPS_JSON.read_text())["maps"]
    except (OSError, KeyError, ValueError):
        return set(itertools.combinations(TERRAIN_PRIORITY, 2))

    pairs: set[tuple[str, str]] = set()
    for m in maps.values():
        rows = m["tiles"]
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                a = BATTLEMAP_TILE_CODE.get(ch)
                if not a:
                    continue
                for dx, dy in ((1, 0), (0, 1)):
                    nx, ny = x + dx, y + dy
                    if ny >= len(rows) or nx >= len(rows[ny]):
                        continue
                    b = BATTLEMAP_TILE_CODE.get(rows[ny][nx])
                    if b and b != a and a in TERRAIN_PRIORITY and b in TERRAIN_PRIORITY:
                        pairs.add(tuple(sorted((a, b))))  # type: ignore[arg-type]
    return pairs


def estimate_bg_color(a: np.ndarray) -> tuple[int, int, int]:
    """테두리 픽셀에서 배경색을 추정. 단색이 아니면 BG_REFERENCE로 폴백."""
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]).astype(float)
    if border[:, :3].std(axis=0).max() > BG_BORDER_STD_MAX:
        return BG_REFERENCE
    return tuple(int(v) for v in np.median(border[:, :3], axis=0))


def remove_background(im: Image.Image, name: str,
                      threshold: float = BG_THRESHOLD) -> tuple[Image.Image, str]:
    """[유닛/오브젝트 전용] 회색 단색 배경 제거 → 투명 PNG.

    배경색과의 유클리드 거리가 threshold 이내이면서 이미지 테두리에
    연결된 픽셀만 제거한다(플러드필). 스프라이트 내부의 비슷한 회색은
    보존된다. 제거가 지저분하면 rembg로 폴백.
    """
    rgb = np.array(im.convert("RGB")).astype(float)
    bg = estimate_bg_color(np.array(im.convert("RGB")))
    dist = np.sqrt(((rgb - np.array(bg)) ** 2).sum(axis=-1))
    near_bg = dist <= threshold

    # 테두리에서 시작해 near_bg 영역으로만 전파 (벡터화 플러드필)
    reach = np.zeros_like(near_bg)
    reach[0, :] = near_bg[0, :]
    reach[-1, :] = near_bg[-1, :]
    reach[:, 0] = near_bg[:, 0]
    reach[:, -1] = near_bg[:, -1]
    while True:
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]
        grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= near_bg
        if (grown == reach).all():
            break
        reach = grown

    out = np.array(im.convert("RGBA"))
    out[reach, 3] = 0
    result = Image.fromarray(out, "RGBA")

    # 품질 점검: 테두리에 불투명 픽셀이 많이 남으면 지저분한 것 → rembg 폴백
    alpha = out[..., 3]
    border_alpha = np.concatenate(
        [alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]])
    residue = float((border_alpha > 0).mean())
    if residue > BG_RESIDUE_LIMIT:
        try:
            from rembg import remove as rembg_remove  # type: ignore
            result = rembg_remove(im.convert("RGBA"))
            return result, f"bg:rembg(잔존 {residue:.0%})"
        except ImportError:
            print(f"  경고: {name} 배경 잔존 {residue:.0%}, "
                  f"rembg 미설치로 폴백 생략")
    return result, f"bg:flood(기준색 {bg})"


def _nearest(colors: np.ndarray, pixels: np.ndarray,
             chunk: int = 1 << 17) -> tuple[np.ndarray, np.ndarray]:
    """pixels(N,3)마다 colors(M,3) 중 최근접 인덱스와 거리를 반환.

    원본 해상도 이미지도 다루므로 청크 단위로 계산한다.
    """
    idx = np.empty(len(pixels), dtype=int)
    dist = np.empty(len(pixels))
    c2 = (colors ** 2).sum(axis=1)
    for s in range(0, len(pixels), chunk):
        p = pixels[s:s + chunk]
        d2 = (p ** 2).sum(axis=1)[:, None] - 2 * p @ colors.T + c2[None, :]
        i = d2.argmin(axis=1)
        idx[s:s + chunk] = i
        dist[s:s + chunk] = np.sqrt(np.maximum(
            d2[np.arange(len(p)), i], 0.0))
    return idx, dist


def faction_swap(im: Image.Image, ramp: list[tuple[int, int, int]],
                 stem: str = "",
                 threshold: float = SWAP_THRESHOLD) -> Image.Image:
    """[유닛 전용] 갑옷·의복 색을 진영 램프로 치환.

    각 픽셀을 SWAP_SOURCE·SWAP_EXCLUDE(+유닛별 추가 보호색) 전체와
    비교해 최근접이 SWAP_SOURCE이고 거리가 threshold 이내일 때만,
    픽셀 밝기에 맞는 램프 단계로 치환한다. 피부·말·무기는 EXCLUDE가,
    윤곽선·짙은 그림자는 SWAP_LUMA_MIN이 지킨다.
    양자화로 색이 병합되기 전, 원본 해상도에서 수행해야 정확하다.
    """
    a = np.array(im.convert("RGBA"))
    opaque = a[..., 3] > 0
    px = a[opaque][:, :3].astype(float)

    src = np.array(SWAP_SOURCE, dtype=float)
    exc = np.array(SWAP_EXCLUDE + SWAP_EXCLUDE_EXTRA.get(stem, []), dtype=float)
    both = np.vstack([src, exc])
    idx, dist = _nearest(both, px)

    luma = px @ np.array([0.299, 0.587, 0.114])
    chroma = px.max(axis=1) - px.min(axis=1)
    swap = ((idx < len(src)) & (dist <= threshold)
            & (luma >= SWAP_LUMA_MIN) & (chroma >= SWAP_MIN_CHROMA))

    lo, hi = SWAP_LUMA_RANGE
    t = np.clip((luma - lo) / (hi - lo), 0.0, 1.0)
    step = np.round(t * (len(ramp) - 1)).astype(int)
    ramp_arr = np.array(ramp, dtype=np.uint8)

    new_px = a[opaque][:, :3].copy()
    new_px[swap] = ramp_arr[step[swap]]
    out = a.copy()
    out[opaque, :3] = new_px
    return Image.fromarray(out, "RGBA")


# ---------------------------------------------------------------------------
# 파일 단위 처리
# ---------------------------------------------------------------------------

def classify(stem: str) -> tuple[tuple[int, int], str] | None:
    if stem in SIZE_OVERRIDES:
        prefix = next((p for p in TARGET_SIZES if stem.startswith(p)), None)
        return SIZE_OVERRIDES[stem], TARGET_SIZES[prefix][1] if prefix else "object"
    for prefix, (size, cat) in TARGET_SIZES.items():
        if stem.startswith(prefix):
            return size, cat
    return None


def count_colors(im: Image.Image) -> int:
    a = np.array(im.convert("RGBA"))
    vis = a[a[..., 3] > 0][:, :3]
    if len(vis) == 0:
        return 0
    return len(np.unique(vis, axis=0))


def process_one(path: Path) -> dict | None:
    stem = path.stem
    spec = classify(stem)
    if spec is None:
        print(f"  건너뜀: {path.name} (파일명 규칙 불일치)")
        return None
    size, cat = spec
    im = Image.open(path)
    orig_size = im.size
    steps = []

    if cat == "tile":
        im = center_crop_tile(im.convert("RGB"))
        steps.append(f"crop:중앙{int((1 - 2 * TILE_EDGE_TRIM) * 100)}%")
        im = downscale(im, size)
        steps.append(f"scale:{size[0]}x{size[1]}")
        im = quantize(im)
        steps.append(f"quant:{QUANT_COLORS}")
    elif stem.startswith("obj_wall_"):  # 성벽 부품 — 이어붙임 정합 전용 처리
        im, bg_note = remove_background(im.convert("RGBA"), path.name)
        steps.append(bg_note)
        im = process_wall_piece(im, stem, size)
        steps.append("wall:bbox크롭+정합")
    else:  # object / unit / portrait
        im, bg_note = remove_background(im.convert("RGBA"), path.name)
        steps.append(bg_note)
        if cat == "unit":  # 진영 스왑용 원본 해상도 중간물 캐시
            WORK_DIR.mkdir(parents=True, exist_ok=True)
            im.save(WORK_DIR / path.name)
        im = crop_to_content(im, size)
        steps.append("crop:내용물중심")
        im = downscale(im, size)
        steps.append(f"scale:{size[0]}x{size[1]}")
        im = quantize(im)
        steps.append(f"quant:{QUANT_COLORS}")

    out_path = OUT_DIR / path.name
    im.save(out_path)
    return {"name": path.name, "stem": stem, "category": cat,
            "orig_size": orig_size, "size": size,
            "colors": count_colors(im), "steps": steps, "out": out_path}


def run_faction_swaps() -> list[dict]:
    """유닛별 3진영 변형 생성.

    양자화 전 원본 해상도 중간물(_work/)에서 스왑해야 말·갑옷처럼
    양자화로 병합되는 색을 구분할 수 있다. 스왑 후 base와 동일한
    크롭→축소→양자화를 거친다.
    """
    FACTION_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for path in sorted(OUT_DIR.glob("unit_*.png")):
        work_path = WORK_DIR / path.name
        if work_path.exists():
            base = Image.open(work_path).convert("RGBA")
        else:  # 캐시 없으면 raw에서 배경 제거부터 다시
            raw_path = RAW_DIR / path.name
            if not raw_path.exists():
                print(f"  건너뜀: {path.name} (raw/_work 원본 없음)")
                continue
            base, _ = remove_background(
                Image.open(raw_path).convert("RGBA"), path.name)
            WORK_DIR.mkdir(parents=True, exist_ok=True)
            base.save(work_path)
        spec = classify(path.stem)
        size = spec[0] if spec else (32, 32)
        for faction, ramp in FACTIONS.items():
            out = faction_swap(base, ramp, stem=path.stem)
            out = quantize(downscale(crop_to_content(out, size), size))
            out_path = FACTION_DIR / f"{path.stem}_{faction}.png"
            out.save(out_path)
            results.append({"name": out_path.name, "colors": count_colors(out)})
    return results


# ---------------------------------------------------------------------------
# 미리보기
# ---------------------------------------------------------------------------

def _scale(im: Image.Image, factor: int = PREVIEW_SCALE) -> Image.Image:
    return im.resize((im.width * factor, im.height * factor),
                     Image.Resampling.NEAREST)


CHECKER = (90, 90, 90), (120, 120, 120)


def _on_checker(im: Image.Image) -> Image.Image:
    """투명 배경 확인용 체커보드 위에 합성."""
    bg = Image.new("RGB", im.size, CHECKER[0])
    tile = 8
    a = np.array(bg)
    for y in range(0, im.height, tile):
        for x in range(0, im.width, tile):
            if (x // tile + y // tile) % 2:
                a[y:y + tile, x:x + tile] = CHECKER[1]
    bg = Image.fromarray(a)
    bg.paste(im, (0, 0), im.convert("RGBA"))
    return bg


def _label_row(cells: list[Image.Image], pad: int = 8) -> Image.Image:
    h = max(c.height for c in cells)
    w = sum(c.width for c in cells) + pad * (len(cells) + 1)
    row = Image.new("RGB", (w, h + pad * 2), (30, 30, 30))
    x = pad
    for c in cells:
        row.paste(c, (x, pad + (h - c.height) // 2))
        x += c.width + pad
    return row


def _stack_rows(rows: list[Image.Image]) -> Image.Image:
    w = max(r.width for r in rows)
    h = sum(r.height for r in rows)
    out = Image.new("RGB", (w, h), (30, 30, 30))
    y = 0
    for r in rows:
        out.paste(r, (0, y))
        y += r.height
    return out


def make_previews() -> list[Path]:
    processed = sorted(OUT_DIR.glob("*.png"))
    processed = [p for p in processed if not p.name.startswith("_")]

    # 1) 전후 비교
    rows = []
    for p in processed:
        raw_path = RAW_DIR / p.name
        after = _on_checker(_scale(Image.open(p).convert("RGBA")))
        cells = []
        if raw_path.exists():
            before = Image.open(raw_path).convert("RGB")
            before.thumbnail((after.height, after.height),
                             Image.Resampling.NEAREST)
            cells.append(before)
        cells.append(after)
        rows.append(_label_row(cells))
    preview = _stack_rows(rows)
    p1 = OUT_DIR / "_preview.png"
    preview.save(p1)

    # 2) 타일 3x3 이어붙임 (이음새 확인)
    rows = []
    for p in processed:
        if not p.name.startswith("tile_"):
            continue
        t = Image.open(p).convert("RGB")
        grid = Image.new("RGB", (t.width * 3, t.height * 3))
        for gy in range(3):
            for gx in range(3):
                grid.paste(t, (gx * t.width, gy * t.height))
        rows.append(_label_row([_scale(grid)]))
    p2 = OUT_DIR / "_tiling_preview.png"
    _stack_rows(rows).save(p2)

    # 3) 유닛별 원본 + 3진영
    rows = []
    for p in processed:
        if not p.name.startswith("unit_"):
            continue
        cells = [_on_checker(_scale(Image.open(p).convert("RGBA")))]
        for faction in FACTIONS:
            fp = FACTION_DIR / f"{p.stem}_{faction}.png"
            if fp.exists():
                cells.append(_on_checker(_scale(Image.open(fp).convert("RGBA"))))
        rows.append(_label_row(cells))
    p3 = OUT_DIR / "_faction_preview.png"
    _stack_rows(rows).save(p3)

    # 4) 어두운 지형 위 가독성 확인: 지형 3x3 배경 + 3진영 보병
    rows = []
    for tile_name in VISIBILITY_TILES:
        tile_path = OUT_DIR / f"{tile_name}.png"
        if not tile_path.exists():
            continue
        t = Image.open(tile_path).convert("RGB")
        bg = Image.new("RGB", (t.width * 3, t.height * 3))
        for gy in range(3):
            for gx in range(3):
                bg.paste(t, (gx * t.width, gy * t.height))
        x = 0
        for faction in FACTIONS:
            fp = FACTION_DIR / f"{VISIBILITY_UNIT}_{faction}.png"
            if not fp.exists():
                continue
            u = Image.open(fp).convert("RGBA")
            bg.paste(u, (x, (bg.height - u.height) // 2), u)
            x += u.width
        rows.append(_label_row([_scale(bg)]))
    p4 = OUT_DIR / "_visibility_preview.png"
    if rows:
        _stack_rows(rows).save(p4)

    p5 = make_wall_assembly_preview()
    p6 = make_autotile_preview()
    return [p for p in (p1, p2, p3, p4, p5, p6) if p]


def autotile_pick(grid: list[list[str]], x: int, y: int,
                  rank: dict[str, int]) -> tuple[str, int] | None:
    """이 칸에 얹을 전환 타일 (상대 지형, 패턴 번호). 없으면 None.

    렌더러(src/ui/field/autotile.ts)와 같은 규칙이다. 여기 둔 이유는
    미리보기로 규칙 자체를 눈으로 확인하기 위해서다.
    """
    h, w = len(grid), len(grid[0])
    mine = grid[y][x]
    at = lambda cx, cy: grid[cy][cx] if 0 <= cx < w and 0 <= cy < h else mine
    my_rank = rank.get(mine, -1)

    # 이웃 중 나보다 우선순위가 높은 지형들 — 가장 높은 하나만 얹는다
    best, best_rank = None, my_rank
    for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1)):
        t = at(x + dx, y + dy)
        r = rank.get(t, -1)
        if r > best_rank:
            best, best_rank = t, r
    if best is None:
        return None

    mask = 0
    for bit, (dx, dy) in enumerate(((0, -1), (1, 0), (0, 1), (-1, 0))):
        if at(x + dx, y + dy) == best:
            mask |= 1 << bit
    if mask:
        return best, mask
    for i, (dx, dy) in enumerate(((1, -1), (1, 1), (-1, 1), (-1, -1))):
        if at(x + dx, y + dy) == best:
            return best, 16 + i
    return None


def make_autotile_preview() -> Path | None:
    """오토타일 검증 — 손으로 그린 작은 지형도를 전환 타일로 그려 본다.

    풀↔숲·풀↔산·풀↔강이 한 화면에 나오게 짜 두었다. 규칙이 어긋나면
    경계에 직선이 남거나 모서리가 비므로 바로 보인다.
    """
    art = [
        "gggggggggfffffffgggg",
        "ggggggggffffffffgggg",
        "gggggggfffffffgggggg",
        "ggmmggggffffgggggggg",
        "gmmmmgggggggggggwwgg",
        "gmmmmmggggggggwwwwgg",
        "ggmmmgggggggggwwwggg",
        "gggggggggggggwwwgggg",
        "ggggffffggggwwwwgggg",
        "gggffffffgggwwwggggg",
        "ggggffffgggggwwggggg",
        "gggggggggggggwwggggg",
    ]
    code = {"g": "grass", "f": "forest", "m": "mountain", "w": "river"}
    grid = [[code[c] for c in row] for row in art]
    rank = {t: i for i, t in enumerate(TERRAIN_PRIORITY)}
    toned = OUT_DIR / "toned"
    auto = OUT_DIR / "autotile"

    def base_tile(name: str) -> Image.Image | None:
        for p in (toned / f"tile_{name}.png", OUT_DIR / f"tile_{name}.png"):
            if p.exists():
                return Image.open(p).convert("RGB")
        return None

    h, w = len(grid), len(grid[0])
    t = 32
    plain = Image.new("RGB", (w * t, h * t))
    autotiled = Image.new("RGB", (w * t, h * t))
    for y in range(h):
        for x in range(w):
            b = base_tile(grid[y][x])
            if not b:
                return None
            plain.paste(b, (x * t, y * t))
            drawn = b
            pick = autotile_pick(grid, x, y, rank)
            if pick:
                other, pattern = pick
                lo, hi = sorted((grid[y][x], other), key=lambda n: rank.get(n, -1))
                p = auto / f"{lo}_{hi}_{pattern:02d}.png"
                if p.exists():
                    drawn = Image.open(p).convert("RGB")
            autotiled.paste(drawn, (x * t, y * t))

    gap = 10
    scale = 2
    canvas = Image.new("RGB", (plain.width * scale, plain.height * 2 * scale + gap), (30, 30, 30))
    canvas.paste(plain.resize((plain.width * scale, plain.height * scale), Image.Resampling.NEAREST), (0, 0))
    canvas.paste(
        autotiled.resize((autotiled.width * scale, autotiled.height * scale), Image.Resampling.NEAREST),
        (0, plain.height * scale + gap),
    )
    p = OUT_DIR / "_autotile_preview.png"
    canvas.save(p)
    return p


def make_wall_assembly_preview() -> Path | None:
    """성벽 부품 검증 — 녹색 배경 위에 ㅁ자 성곽 한 채를 조립한다.

    코너 원본(팔이 왼쪽·위로 뻗는 우하 코너)을 뒤집어 네 모서리를 만들고,
    벽 띠가 항상 성곽 바깥쪽 변에 붙도록 가로벽은 북쪽 변에서 상하 반전,
    세로벽은 서쪽 변에서 좌우 반전한다. 끊김·어긋남이 보이면
    WALL_H_SPAN·WALL_V_BAND 를 조정한다.
    """
    def load(name: str) -> Image.Image | None:
        p = OUT_DIR / f"{name}.png"
        return Image.open(p).convert("RGBA") if p.exists() else None

    wh, wv, wc = load("obj_wall_h"), load("obj_wall_v"), load("obj_wall_corner")
    if not (wh and wv and wc):
        return None
    gate, tower = load("obj_gate"), load("obj_tower")

    cols, rows_n, t = 7, 5, 32
    grass_path = OUT_DIR / "toned" / "tile_grass.png"
    grass = Image.open(grass_path).convert("RGBA") if grass_path.exists() else None
    board = Image.new("RGBA", (cols * t, rows_n * t), (96, 150, 96, 255))
    if grass:
        for gy in range(rows_n):
            for gx in range(cols):
                board.paste(grass, (gx * t, gy * t))

    FLIP_H = Image.Transpose.FLIP_LEFT_RIGHT
    FLIP_V = Image.Transpose.FLIP_TOP_BOTTOM
    corner = {  # (칸 x, 칸 y) → 변형된 코너
        (cols - 1, rows_n - 1): wc,                       # 우하 — 원본 방향
        (0, rows_n - 1): wc.transpose(FLIP_H),            # 좌하
        (cols - 1, 0): wc.transpose(FLIP_V),              # 우상
        (0, 0): wc.transpose(Image.Transpose.ROTATE_180),  # 좌상
    }
    top_h = wh.transpose(FLIP_V)   # 북쪽 변 — 띠를 바깥(위)으로
    west_v = wv.transpose(FLIP_H)  # 서쪽 변 — 띠를 바깥(왼쪽)으로

    def put(img: Image.Image, gx: int, gy: int) -> None:
        board.paste(img, (gx * t, gy * t), img)

    for gx in range(1, cols - 1):
        put(top_h, gx, 0)
        put(wh, gx, rows_n - 1)
    for gy in range(1, rows_n - 1):
        put(west_v, 0, gy)
        put(wv, cols - 1, gy)
    for (gx, gy), img in corner.items():
        put(img, gx, gy)
    if gate:  # 남쪽 변 한가운데 성문 (2칸 폭)
        board.paste(gate, ((cols // 2 - 1) * t, (rows_n - 1) * t), gate)
    if tower:  # 북서 코너 위에 망루
        put(tower, 0, 0)

    p = OUT_DIR / "_wall_assembly_preview.png"
    _scale(board.convert("RGB")).save(p)
    return p


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--swap-only", action="store_true",
                    help="진영색 팔레트 스왑과 미리보기만 재실행")
    ap.add_argument("--tone-only", action="store_true",
                    help="타일 배경화 톤 다운(processed/toned/)만 재실행")
    ap.add_argument("--autotile-only", action="store_true",
                    help="지형 경계 전환 타일(processed/autotile/)만 재생성")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.tone_only:
        print("=== 타일 톤 다운 (toned/) ===")
        for r in run_tone_down():
            print(f"  toned/{r['name']:<24} 색수 {r['colors']}")
        return 0

    if args.autotile_only:
        print("=== 오토타일 전환 타일 생성 ===")
        n = run_autotiles()
        print(f"  총 {n}장 → {OUT_DIR / 'autotile'}")
        p = make_autotile_preview()
        if p:
            print(f"  {p}")
        return 0

    if not args.swap_only:
        raw_files = sorted(RAW_DIR.glob("*.png"))
        if not raw_files:
            print(f"입력 없음: {RAW_DIR}")
            return 1
        print(f"=== 처리 시작: {len(raw_files)}개 파일 ===")
        summaries = []
        for path in raw_files:
            r = process_one(path)
            if r:
                summaries.append(r)
        print()
        print(f"{'파일':<24} {'분류':<9} {'원본':>10} {'출력':>8} "
              f"{'색수':>4}  적용 단계")
        for r in summaries:
            ow, oh = r["orig_size"]
            w, h = r["size"]
            print(f"{r['name']:<24} {r['category']:<9} {ow:>4}x{oh:<5} "
                  f"{w:>3}x{h:<4} {r['colors']:>4}  {' → '.join(r['steps'])}")

        print("\n=== 타일 톤 다운 (toned/) ===")
        for r in run_tone_down():
            print(f"  toned/{r['name']:<24} 색수 {r['colors']}")

        print("\n=== 오토타일 전환 타일 생성 ===")
        print(f"  총 {run_autotiles()}장 → {OUT_DIR / 'autotile'}")

    print("\n=== 진영색 팔레트 스왑 ===")
    for r in run_faction_swaps():
        print(f"  {r['name']:<36} 색수 {r['colors']}")

    print("\n=== 미리보기 생성 ===")
    for p in make_previews():
        print(f"  {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
