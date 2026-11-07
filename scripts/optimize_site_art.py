#!/usr/bin/env python3
"""보관한 원본에서 사이트 그림을 다시 변환한다(Pillow 필요).

첫 실행은 원본을 저장소 밖에 복사한다. 재실행은 그 보관본을 사용하므로
손실 압축이 누적되지 않는다. 경로 변경과 옛 파일 삭제는 별도로 검수한다.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ORIGINALS = Path('/Users/app/orca/archives/gracekin-games/art-originals-20261107')
# 스프라이트의 3×2 비율과 레이스의 자르기·테두리 좌표는 그대로 유지한다.
ASSETS = [
    ('currency/grain.png', 'currency/grain.webp', 96, 90),
    ('slimeline/title.png', 'slimeline/title.webp', 1034, 90),
    ('gyeongguk/title.png', 'gyeongguk/title.webp', 1166, 90),
    ('slime-front.png', 'slime-front.webp', 560, 88),
    ('slime-bg.jpg', 'slime-bg.webp', None, 82),
    ('gyeongguk-key.jpg', 'gyeongguk-key.webp', None, 82),
    ('slimeline/hero.webp', 'slimeline/hero.webp', None, 85),
    ('gyeongguk/hero.webp', 'gyeongguk/hero.webp', None, 85),
    ('slimeline/tiles.webp', 'slimeline/tiles.webp', None, 82),
    ('gyeongguk/tiles.webp', 'gyeongguk/tiles.webp', None, 80),
    ('gyeongguk/tiles.webp', 'gyeongguk/tiles-small.webp', 792, 82),
    ('gyeongguk/card-lubu.webp', 'gyeongguk/card-lubu.webp', 640, 82),
    ('gyeongguk/card-diaochan.webp', 'gyeongguk/card-diaochan.webp', 640, 82),
    ('gyeongguk/card-zhugeliang.webp', 'gyeongguk/card-zhugeliang.webp', 640, 82),
    ('slime-race/art/owl-host.png', 'slime-race/art/owl-host.webp', 224, 88),
    ('slime-race/art/clay/backdrop.webp', 'slime-race/art/clay/backdrop.webp', None, 85),
    ('slime-race/art/clay/lane.webp', 'slime-race/art/clay/lane.webp', None, 85),
    ('slime-race/art/clay/title-plaque.png', 'slime-race/art/clay/title-plaque.webp', None, 85),
    ('slime-race/art/clay/panel.png', 'slime-race/art/clay/panel.webp', None, 85),
    ('slime-race/art/clay/button.png', 'slime-race/art/clay/button.webp', None, 85),
    ('slime-race/art/clay/button-gold.png', 'slime-race/art/clay/button-gold.webp', None, 85),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--originals', type=Path, default=ORIGINALS, help='저장소 밖 원본 보관 폴더')
    parser.add_argument('--report', type=Path, help='변환 결과 JSON 저장 경로')
    args = parser.parse_args()
    originals = args.originals.resolve()
    if originals.is_relative_to(ROOT):
        parser.error('원본은 저장소 밖에 보관해야 합니다.')
    report = []
    for old, new, width, quality in ASSETS:
        source = originals / 'assets' / old
        current, target = ROOT / 'assets' / old, ROOT / 'assets' / new
        if not source.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(current, source)
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original)
            before_size = image.size
            if width and image.width > width:
                image = image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
            image.save(target, 'WEBP', quality=quality, method=6, exact=True)
            report.append({'before': str(current.relative_to(ROOT)), 'after': str(target.relative_to(ROOT)),
                           'before_bytes': source.stat().st_size, 'after_bytes': target.stat().st_size,
                           'before_size': before_size, 'after_size': image.size, 'quality': quality})
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    for row in report:
        print(f"{row['after']}: {row['before_bytes']:,} → {row['after_bytes']:,} 바이트")


if __name__ == '__main__':
    main()
