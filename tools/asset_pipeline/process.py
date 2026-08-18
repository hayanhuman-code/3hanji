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

    return [p1, p2, p3, p4]


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--swap-only", action="store_true",
                    help="진영색 팔레트 스왑과 미리보기만 재실행")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

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

    print("\n=== 진영색 팔레트 스왑 ===")
    for r in run_faction_swaps():
        print(f"  {r['name']:<36} 색수 {r['colors']}")

    print("\n=== 미리보기 생성 ===")
    for p in make_previews():
        print(f"  {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
