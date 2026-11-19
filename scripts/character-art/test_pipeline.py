"""색 이동식과 분리 알고리즘의 회귀 검증."""
import colorsys
import unittest

import numpy as np
from PIL import Image

from pipeline import extract, recolor


class ColorTest(unittest.TestCase):
    def test_lines_neutral_transparent_and_unmasked_are_preserved(self):
        pixels = np.array([[[30, 20, 10, 255], [180, 180, 180, 255],
                            [190, 95, 48, 0], [190, 95, 48, 255],
                            [190, 95, 48, 255]]], dtype='uint8')
        mask = Image.fromarray(np.array([[255, 255, 255, 0, 255]], dtype='uint8'))
        result = np.array(recolor(Image.fromarray(pixels), mask, [50, 120, 200]))
        np.testing.assert_array_equal(result[0, :4], pixels[0, :4])
        np.testing.assert_array_equal(result[..., 3], pixels[..., 3])
        np.testing.assert_array_equal(result[0, 4], [50, 120, 200, 255])

    def test_median_normalization_and_partial_mask(self):
        pixels = np.array([[[200, 100, 50, 255], [160, 80, 40, 255],
                            [120, 60, 30, 255]]], dtype='uint8')
        mask = Image.fromarray(np.array([[255, 255, 128]], dtype='uint8'))
        result = np.array(recolor(Image.fromarray(pixels), mask, [50, 120, 180]))
        # 중앙 명도 160/255, 채도 .75. 목표 명도에 원래 명암 비율을 곱한다.
        np.testing.assert_array_equal(result[0, 1], [50, 120, 180, 255])
        th, ts, tv = colorsys.rgb_to_hsv(50 / 255, 120 / 255, 180 / 255)
        shifted = np.array(colorsys.hsv_to_rgb(th, ts, tv * 120 / 160)) * 255
        expected = np.floor(pixels[0, 2, :3] * (1 - 128 / 255) + shifted * (128 / 255) + .5)
        np.testing.assert_array_equal(result[0, 2, :3], expected)

    def test_empty_mask(self):
        pixels = np.array([[[80, 40, 20, 255]]], dtype='uint8')
        result = recolor(Image.fromarray(pixels), Image.new('L', (1, 1)), [255, 0, 0])
        np.testing.assert_array_equal(np.array(result), pixels)

    def test_low_target_saturation_uses_floor(self):
        pixels = np.array([[[200, 100, 50, 255]]], dtype='uint8')
        result = np.array(recolor(Image.fromarray(pixels), Image.new('L', (1, 1), 255), [200, 200, 200]))
        np.testing.assert_array_equal(result[0, 0], [200, 192, 192, 255])

    def test_extraction_does_not_copy_unchanged_grey_border(self):
        base = np.full((40, 40, 4), [140, 140, 140, 255], dtype='uint8')
        edited = base.copy()
        edited[10:30, 10:30] = [80, 40, 20, 255]
        result = extract(base, edited, np.ones((40, 40), bool), minimum=10)
        self.assertTrue(np.all(result[12:28, 12:28, 3] == 255))
        self.assertTrue(np.all(result[:10, :, 3] == 0))
        self.assertTrue(np.all(result[:, :10, 3] == 0))


if __name__ == '__main__':
    unittest.main()
