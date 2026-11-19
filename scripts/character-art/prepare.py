"""기존 기준 몸을 축소·이동하여 모든 편집이 공유하는 원본을 만든다."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def prepare(source, output):
    image = Image.open(source).convert('RGBA')
    if image.size != (1024, 1536):
        raise ValueError('기준 몸은 1024×1536이어야 합니다')
    pixels = np.array(image)
    pixels[..., 3][pixels[..., 3] < 40] = 0
    pixels[..., 3][pixels[..., 3] >= 248] = 255
    # 투명 영역의 숨은 갈색 배경이 축소 과정에서 섞이지 않게 한다.
    pixels[pixels[..., 3] == 0] = 0
    small = Image.fromarray(pixels).resize((881, 1321), Image.Resampling.LANCZOS)
    result = Image.new('RGBA', (1024, 1536))
    result.alpha_composite(small, (72, 162))
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    result.save(output)
    print(f'기준 몸 저장: {output}, 실제 경계: {result.getbbox()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('output')
    args = parser.parse_args()
    prepare(args.source, args.output)
