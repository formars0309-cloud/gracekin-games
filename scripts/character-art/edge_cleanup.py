"""기준 피부가 묻은 부품 경계의 RGB를 정리하고 알파 윤곽은 보존한다."""
import numpy as np
from scipy import ndimage as ndi


def restore_outline(part, reference, hair=False):
    """머리는 경계 전체, 종족 부속은 피부 접점의 유사색만 선 색으로 바꾼다.

    화소를 지우는 대신 가까운 원본의 어두운 선 색을 사용하므로 가는 머리와
    귀 뿌리의 알파를 보존한다. 1024판과 축소한 512판에 각각 적용한다.
    """
    result = part.copy()
    scale = max(1, part.shape[1] / 512)
    opaque = part[..., 3] > 0
    distance = ndi.distance_transform_edt(opaque)
    border = opaque & (distance <= 3.5 * scale)
    rgb = part[..., :3].astype(np.float32)
    hi, lo = rgb.max(-1), rgb.min(-1)
    saturation = (hi - lo) / np.maximum(hi, 1)
    lines = (part[..., 3] >= 200) & (hi <= (118 if hair else 160)) & (saturation >= .12)
    # 투명 경계의 혼합색 자체를 참조 선으로 사용하지 않는다.
    lines &= (rgb[..., 0] >= rgb[..., 1]) & (rgb[..., 1] >= rgb[..., 2])
    if np.any(lines):
        nearest_distance, indices = ndi.distance_transform_edt(~lines, return_indices=True)
    else:
        nearest_distance = np.full(opaque.shape, np.inf)
        indices = np.zeros((2, *opaque.shape), dtype=int)
    if hair:
        selected = border
    else:
        # 고정 피부 용인은 청록색 몸을 기준으로 비교하므로 크림색 뿔은 유지된다.
        ref_alpha = reference[..., 3] > 128
        ref_distance, ref_indices = ndi.distance_transform_edt(~ref_alpha, return_indices=True)
        ref_rgb = reference[..., :3][tuple(ref_indices)].astype(np.float32)
        ref_hi, ref_lo = ref_rgb.max(-1), ref_rgb.min(-1)
        warm_skin = (ref_rgb[..., 0] > ref_rgb[..., 1]) & (ref_rgb[..., 1] > ref_rgb[..., 2])
        warm_skin &= (ref_hi > 155) & ((ref_hi - ref_lo) / np.maximum(ref_hi, 1) > .16)
        # 노란 크림색 뿔은 피부보다 R-G 차이가 작다. 몸에 겹친 뿔 뿌리도 보존한다.
        warm_skin &= (ref_rgb[..., 0] - ref_rgb[..., 1]) >= .5 * (ref_rgb[..., 0] - ref_rgb[..., 2])
        similar = np.abs(rgb - ref_rgb).max(-1) <= 72
        selected = border & warm_skin & similar & (ref_distance <= 3 * scale)
    # 피부 유사 경계에서만 가장 가까운 선 또는 최후의 선 색을 쓴다.
    close = nearest_distance <= 14 * scale
    replacement = part[..., :3][tuple(indices)]
    result[selected, :3] = replacement[selected]
    result[selected & ~close, :3] = [66, 39, 29]
    return result
