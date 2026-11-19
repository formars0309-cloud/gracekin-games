"""납품 파일의 알파·회색조·용량과 정렬 기록을 실제 디코딩해 검사한다."""
import json
from pathlib import Path

import numpy as np
from PIL import Image


def audit(root=Path('assets/character'), report=Path('reports/2026-11-19-캐릭터-그림')):
    manifest = json.loads((root / 'manifest.json').read_text())
    masks, layers = set(), set()
    for group in ['races', 'hair', 'outfits']:
        for entry in manifest[group].values():
            for key, value in entry.items():
                if isinstance(value, str) and value.startswith('parts/'):
                    (masks if key.lower().endswith('mask') else layers).add(value)
    for relative in sorted(layers | masks):
        path = root / relative
        with Image.open(path) as image:
            assert image.size == (512, 768), relative
            assert path.stat().st_size <= 150_000, relative
            if relative in masks:
                pixels = np.array(image.convert('RGB'))
                assert np.array_equal(pixels[..., 0], pixels[..., 1]), relative
                assert np.array_equal(pixels[..., 1], pixels[..., 2]), relative
                assert pixels.min() == 0 and pixels.max() == 255, relative
                assert np.count_nonzero(pixels[..., 0]) >= 100, relative
            else:
                assert 'A' in image.getbands(), relative
                alpha = np.array(image.getchannel('A'))
                assert alpha.min() == 0 and alpha.max() == 255, relative
                assert np.count_nonzero(alpha) >= 100, relative
                assert not np.any(alpha[0]) and not np.any(alpha[-1]), relative
                assert not np.any(alpha[:, 0]) and not np.any(alpha[:, -1]), relative
    alignment = json.loads((report / '정렬-검사.json').read_text())
    assert len(alignment) == 10
    for value in alignment.values():
        assert value['maxPx'] <= 2
        assert value['deliveredLowerAlphaMismatchPixels'] == 0
    files = sorted((root / 'parts').rglob('*'))
    files = [p for p in files if p.is_file()]
    art_bytes = sum(p.stat().st_size for p in files)
    proof_bytes = sum(p.stat().st_size for p in report.glob('*.jpg'))
    assert len(files) == len(layers | masks)
    assert art_bytes + (root / 'manifest.json').stat().st_size <= 6_000_000
    assert proof_bytes <= 3_000_000
    result = {'parts': len(files), 'layers': len(layers), 'masks': len(masks),
              'partBytes': art_bytes, 'largestPartBytes': max(p.stat().st_size for p in files),
              'proofSheets': len(list(report.glob('*.jpg'))), 'proofBytes': proof_bytes,
              'sourceLowerMaxPx': max(x['maxPx'] for x in alignment.values()),
              'deliveredLowerAlphaMismatchPixels': 0}
    (report / '납품-검사.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    audit()
