"""실제 WebP 경계를 디코딩해 기준 피부색 잔존을 검사한다(Pillow만 필요)."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


def contaminated_edges(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    body = Image.open(root / manifest['races']['human']['body']).convert('RGBA')
    skin = Image.open(root / manifest['races']['human']['skinMask']).convert('L')
    vicinity = skin.filter(ImageFilter.MaxFilter(7))
    body_pixels, nearby = body.load(), vicinity.load()
    counts = {}
    for entry in manifest['hair'].values():
        for field in ['front', 'back']:
            relative = entry[field]
            if not relative:
                continue
            image = Image.open(root / relative).convert('RGBA')
            # 실제 알파의 안쪽 2화소와 가닥 사이 틈의 경계도 검사한다.
            binary = image.getchannel('A').point(lambda a: 255 if a else 0)
            boundary = ImageChops.subtract(binary, binary.filter(ImageFilter.MinFilter(5)))
            pixels, edge = image.load(), boundary.load()
            count = 0
            for y in range(768):
                for x in range(512):
                    if not edge[x, y] or not nearby[x, y]:
                        continue
                    r, g, b, alpha = pixels[x, y]
                    br, bg, bb, _ = body_pixels[x, y]
                    if alpha >= 16 and r > 170 and g > 110 and b > 70:
                        if max(abs(r - br), abs(g - bg), abs(b - bb)) <= 100:
                            count += 1
            counts[relative] = count
    accessories = {}
    for entry in manifest['races'].values():
        ref = Image.open(root / entry['body']).convert('RGBA').load()
        for field in ['ears', 'back']:
            relative = entry[field]
            if not relative:
                continue
            image = Image.open(root / relative).convert('RGBA')
            binary = image.getchannel('A').point(lambda a: 255 if a else 0)
            boundary = ImageChops.subtract(binary, binary.filter(ImageFilter.MinFilter(5)))
            pixels, edge = image.load(), boundary.load()
            count = 0
            for y in range(768):
                for x in range(512):
                    if not edge[x, y]:
                        continue
                    r, g, b, alpha = pixels[x, y]
                    br, bg, bb, ba = ref[x, y]
                    if (alpha >= 16 and r > 170 and g > 110 and b > 70 and ba >= 128
                            and br > 155 and br > bg > bb and br - bb > 40
                            and br - bg >= .5 * (br - bb)):
                        if max(abs(r - br), abs(g - bg), abs(b - bb)) <= 58:
                            count += 1
            accessories[relative] = count
    return counts, accessories


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('assets/character'))
    parser.add_argument('--measure-only', action='store_true')
    args = parser.parse_args()
    counts, accessories = contaminated_edges(args.root)
    print(json.dumps({'layers': len(counts), 'skinColoredEdgePixels': sum(counts.values()),
                      'perLayer': counts, 'accessoryLayers': len(accessories),
                      'skinColoredAccessoryEdgePixels': sum(accessories.values()),
                      'perAccessory': accessories}, ensure_ascii=False))
    if not args.measure_only and (any(counts.values()) or any(accessories.values())):
        raise SystemExit('짙은 피부 합성 시 머리 가장자리에 기준 피부색 화소가 남아 있습니다')
