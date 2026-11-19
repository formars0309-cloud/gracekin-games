"""s1·s6 머리 8종과 종족 부속의 확대 합성 확인판을 만든다."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from pipeline import compose, RACES


def proofs(root, report, before=None):
    manifest = json.loads((root / 'manifest.json').read_text())
    font = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 22)
    background = '#282032'

    def sheet(name, rows, crop, cell, columns=4):
        result = Image.new('RGB', (cell[0] * columns, cell[1] * ((len(rows) + columns - 1) // columns)), background)
        draw = ImageDraw.Draw(result)
        for i, (label, race, hair, skin) in enumerate(rows):
            colors = {'hair': 0, 'eye': 0, 'skin': skin, 'accent': 0}
            part = compose(root, manifest, race, hair, 'guardian', colors)
            part = part.crop(crop)
            ratio = min(cell[0] / part.width, (cell[1] - 36) / part.height)
            part = part.resize((round(part.width * ratio), round(part.height * ratio)), Image.Resampling.LANCZOS)
            x, y = i % columns * cell[0], i // columns * cell[1]
            draw.text((x + 10, y + 5), label, font=font, fill='#f5e8d3')
            result.paste(part, (x + (cell[0] - part.width) // 2, y + 36), part)
        result.save(report / f'{name}.jpg', quality=82, optimize=True)

    for start in [1, 5]:
        rows = [(f'h{i} · s{skin + 1}', 'human', f'h{i}', skin)
                for i in range(start, start + 4) for skin in [0, 5]]
        sheet(f'2차-머리-{start}-{start + 3}-피부접점', rows, (125, 110, 385, 365), (440, 476))
    # 뒤층의 끝·옆면까지 확인한다. 정면 머리 확인판과 검사 범위가 겹치지 않는다.
    rows = [(f'h{i} 뒤층 · s{skin + 1}', 'human', f'h{i}', skin)
            for i in [2, 4, 5, 8] for skin in [0, 5]]
    sheet('2차-긴머리-뒤층', rows, (95, 70, 425, 570), (330, 536))
    rows = [(f'{name} · s{skin + 1}' + ('(고정)' if race in ['dragon', 'moon'] else ''), race, 'h1', skin)
            for race, name in RACES.items() for skin in [0, 5]]
    sheet('2차-종족-귀와뿔', rows, (100, 0, 410, 350), (350, 431))
    rows = [(f'{RACES[race]} 뒤층 · s{skin + 1}', race, 'h8', skin)
            for race in ['cat', 'fox', 'bear', 'dragon', 'fairy'] for skin in [0, 5]]
    sheet('2차-종족-꼬리와날개', rows, (45, 300, 475, 680), (430, 416))
    if before:
        old = json.loads((before / 'manifest.json').read_text())
        canvas = Image.new('RGB', (1000, 540), background)
        for i, (label, directory, art) in enumerate([('수정 전 · h1 · s6', before, old), ('수정 후 · h1 · s6', root, manifest)]):
            part = compose(directory, art, 'human', 'h1', 'guardian', {'hair': 0, 'eye': 0, 'skin': 5, 'accent': 0})
            part = part.crop((140, 160, 365, 355)).resize((500, 433), Image.Resampling.LANCZOS)
            canvas.paste(part, (i * 500, 50), part)
            ImageDraw.Draw(canvas).text((i * 500 + 12, 10), label, font=font, fill='#f5e8d3')
        canvas.save(report / '2차-h1-수정전후.jpg', quality=85, optimize=True)
    total = sum(path.stat().st_size for path in report.glob('*.jpg'))
    assert total <= 3_000_000, f'검수판 합계가 3MB를 초과했습니다: {total}'
    print(f'확대 확인판 5종 생성, 전체 JPG 합계 {total:,}바이트')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('assets/character'))
    parser.add_argument('--report', type=Path, default=Path('reports/2026-11-19-캐릭터-그림'))
    parser.add_argument('--before', type=Path)
    args = parser.parse_args()
    proofs(args.root, args.report, args.before)
