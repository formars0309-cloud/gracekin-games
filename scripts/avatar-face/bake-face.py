"""생성 원화의 두 얼굴을 같은 삼각망에 대응시켜 정점 위치·색·홍채 마스크를 굽는다.

python3 bake-face.py face_landmark.tflite (NumPy, OpenCV 5)
원화는 공방용으로 제공된 생성 이미지다. 외부 사진이나 인물 스캔은 사용하지 않았다.
측정에 사용한 Google MediaPipe 가중치는 실행 자산에 포함하지 않는다.
https://storage.googleapis.com/mediapipe-assets/face_landmark.tflite
"""

import base64
import hashlib
from pathlib import Path
import sys

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
MODEL_HASH = '1055cb9d4a9ca8b8c688902a3a5194311138ba256bcc94e336d8373a5f30c814'
PLATE_HASH = 'bbd41a0b3e2f53a80e3fd0aa92c197ad3adf12b0df90df659c5ea9cae44df3e3'
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
        400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
IRISES = [[(288, 437), (519, 437)], [(1051, 457), (1284, 457)]]


def measure(image, network, i):
    left = (16, 783)[i]
    crop = image[120:888, left:left + 768]
    tensor = cv2.dnn.blobFromImage(crop, 1 / 255, (192, 192))
    network.setInput(tensor)
    marks = network.forward().reshape(468, 3) * 4
    marks[:, :2] += [left, 120]
    # 기준망의 하단을 원화에서 확인한 턱끝(각각 861, 854화소)에 맞춘다.
    marks[:, 1] += (30, 25)[i] * np.clip((marks[:, 1] - 733) / 100, 0, 1) ** 1.4
    return marks


def triangulate(points):
    points = np.asarray(points, np.float32)
    subdivision = cv2.Subdiv2D((0, 0, 800, 1024))
    keys = {tuple(p): i for i, p in enumerate(points)}
    for p in points:
        subdivision.insert(tuple(map(float, p)))
    return np.array([[keys[tuple(p)] for p in tri] for tri in subdivision.getTriangleList().reshape(-1, 3, 2)])


def atlas(marks):
    # 좌우 사진의 공통 좌표계. 눈과 입술을 지나는 삼각형끼리 대응한다.
    aligned = marks.copy()
    aligned[1, :, 0] -= 768
    template = aligned[:, :, :2].mean(axis=0)
    return template, triangulate(template)


def interpolated_fields(template, topology, marks):
    # 동일 화소에서 원본 위치 두 쌍과 두 깊이를 읽는 제작용 지도.
    grid = np.zeros((1024, 800, 6), np.float32)
    fields = marks.transpose(1, 0, 2).reshape(-1, 6)
    for ids in topology:
        a, b, c = template[ids]
        x0, y0 = np.floor(template[ids].min(axis=0)).astype(int)
        x1, y1 = np.ceil(template[ids].max(axis=0)).astype(int) + 1
        yy, xx = np.mgrid[y0:y1, x0:x1]
        dx, dy = xx - a[0], yy - a[1]
        bx, by = b - a
        cx, cy = c - a
        det = bx * cy - by * cx
        u, v = (dx * cy - dy * cx) / det, (dy * bx - dx * by) / det
        inside = (u >= 0) & (v >= 0) & (u + v <= 1)
        vals = fields[ids]
        grid[y0:y1, x0:x1][inside] = vals[0] + u[inside, None] * (vals[1] - vals[0]) + v[inside, None] * (vals[2] - vals[0])
    return grid


def smooth_depth(landmarks, uv):
    # 얇은 판 스플라인으로 광대·관자의 넓은 면과 촘촘한 눈꺼풀을 한 곡면에 연결한다.
    # 삼각형별 선형 깊이는 측면광에서 턱과 관자에 줄무늬가 생긴다.
    center = landmarks[:, :2].mean(axis=0)
    anchors = (landmarks[:, :2].astype(float) - center) / 250

    def kernel(x):
        sq = np.sum((x[:, None, :] - anchors[None, :, :]) ** 2, axis=2)
        return .5 * sq * np.log(np.maximum(sq, 1e-16))

    affine = np.column_stack((np.ones(len(anchors)), anchors))
    matrix = np.block([[kernel(anchors) + np.eye(len(anchors)) * .0018, affine],
                       [affine.T, np.zeros((3, 3))]])
    coef = np.linalg.solve(matrix, np.r_[landmarks[:, 2], [0, 0, 0]])
    fitted = []
    for chunk in np.array_split((uv.astype(float) - center) / 250, 16):
        fitted.extend(np.einsum("ij,j->i", kernel(chunk), coef[:-3]) + coef[-3] + np.einsum("ij,j->i", chunk, coef[-2:]))
    return np.array(fitted)


def sample_points(template):
    rim = template[OVAL]
    points = []
    # 경계점부터 넣으면 뒤통수의 첫 단면과 같은 정점을 공유할 수 있다.
    for i, a in enumerate(rim):
        b = rim[(i + 1) % len(rim)]
        for t in (0, .25, .5, .75):
            points.append(a * (1 - t) + b * t)
    boundary_count = len(points)
    rng = np.random.default_rng(173)
    for step, xmin, xmax, ymin, ymax in [(10, 130, 670, 250, 851), (3.5, 180, 630, 358, 485),
                                         (3.4, 295, 516, 671, 762), (4.5, 326, 482, 552, 649)]:
        for row, y in enumerate(np.arange(ymin, ymax, step * .9)):
            for x in np.arange(xmin + step * (row % 2) / 2, xmax, step):
                xy = np.array([x, y]) + rng.uniform(-.17, .17, 2) * step
                if cv2.pointPolygonTest(rim, tuple(xy), True) > 2:
                    points.append(xy)
    pts = np.array(points, np.float32)
    return pts, boundary_count


def sample(image, coords):
    # remap의 한 축 크기 제한을 넘지 않게 1차원 정점 목록은 한 열로 넣는다.
    return cv2.remap(image, coords[:, None, :].astype('f'), None, cv2.INTER_LINEAR)[:, 0]


def baked_face(i, pts, rim_count, template, landmarks, field, image):
    values = sample(field, pts)[:, i * 3:i * 3 + 3].copy()
    # 외곽은 추정 범위의 끝점이라 깊이 지도 대신 정확한 경계 위치를 쓴다.
    for k in range(rim_count):
        j, t = divmod(k, 4)
        values[k] = landmarks[OVAL[j]] * (1 - t / 4) + landmarks[OVAL[(j + 1) % len(OVAL)]] * t / 4
    uv = values[:, :2]
    x = (uv[:, 0] - (403, 1173)[i]) * (.00151, .00146)[i]
    y = (.065, .058)[i] - (uv[:, 1] - (438, 457)[i]) * (.00136, .00136)[i]
    y += (.041, .034)[i] * np.clip((uv[:, 1] - 733) / 128, 0, 1) ** 1.4
    z = .308 - smooth_depth(landmarks, uv) * (.00125, .00118)[i]
    # 이마·턱으로 돌아가는 측면 깊이를 머리와 목의 축에 맞춘다.
    z -= .108 * np.clip((y - .09) / .24, 0, 1) ** 1.3
    z += (.078, .066)[i] * np.exp(-((y + .399) / .082) ** 2) * np.exp(-(x / .19) ** 2)
    # 정면 측정에서 가장자리 두 점의 작은 X 오차가 깊이 경사로 확대된다.
    # 타원의 측두골 구간은 실측 윤곽을 따라 도는 연속 타원 단면에 접합한다.
    heights = np.linspace(-.52, .34, 500)
    nominal = np.interp(heights, [-.49, -.40, -.32, -.21, -.08, .03, .13, .22, .33],
                        [.25, .33, .35, .35, .362, .368, .38, .378, .338])
    for side in [-1, 1]:
        anchors = np.arange(0, rim_count // 2 + 1, 4) * side % rim_count
        order = anchors[np.argsort(y[anchors])]
        def section(v):
            ahead = np.interp(heights, y[order], v[order])
            return np.interp(y, heights, cv2.GaussianBlur(ahead[:, None], (1, 0), 0, sigmaY=8)[:, 0])
        edge_x = np.maximum(.03, section(np.abs(x)))
        edge_z = section(.308 - values[:, 2] * (.00125, .00118)[i]
                         - .108 * np.clip((y - .09) / .24, 0, 1) ** 1.3)
        ratio = np.clip(np.abs(x) / edge_x, 0, 1)
        ellipse = (np.sqrt(1 - .97 * ratio ** 2) - np.sqrt(.03)) / (1 - np.sqrt(.03))
        outer = edge_z + (np.interp(y, heights, nominal) - edge_z) * ellipse
        weight = np.clip((ratio - .52) / .31, 0, 1) * np.clip((side * x - .10) / .13, 0, 1)
        weight = weight ** 2 * (3 - 2 * weight)
        z += weight * (outer - z)
    # 원화의 콧등·입술 높이 차이를 옆에서 과장하지 않도록 코끝 투영 폭을 보정한다.
    z -= (.017, .027)[i] * np.exp(-(x / .097) ** 2 - ((y + .126) / .112) ** 2)
    rgb = sample(cv2.GaussianBlur(image, (0, 0), .85), uv).astype(float)
    rim = template[OVAL]
    edge = np.array([cv2.pointPolygonTest(rim, tuple(map(float, xy)), True) for xy in pts])
    coverage = np.clip((edge - 5) / 32, 0, 1)
    # 희미한 잔머리는 관자 부위에만 지우고, 눈썹 바깥 끝은 보존한다.
    coverage *= np.clip((.366 - np.abs(x)) / .05, 0, 1)
    coverage *= 1 - np.clip((np.abs(x) - .235) / .075, 0, 1) * np.clip((y - .144) / .063, 0, 1)
    base = np.array(([205, 170, 151], [224, 192, 177])[i])
    rgb = base + coverage[:, None] * (rgb - base)
    iris = np.zeros(len(pts))
    for cx, cy in IRISES[i]:
        dx, dy = (uv - [cx, cy]).T
        r = np.hypot(dx, dy)
        # 동공과 반사광을 보존하고 눈꺼풀에 가린 홍채는 염색하지 않는다.
        light = rgb.mean(axis=1)
        mask = np.clip((21 - r) / 3, 0, 1) * np.clip((r - 6) / 4, 0, 1)
        mask *= np.clip((light - 22) / 17, 0, 1) * np.clip((125 - light) / 34, 0, 1)
        mask *= np.clip((dy + (11, 15)[i]) / 3, 0, 1) * np.clip((18 - dy) / 3, 0, 1)
        iris = np.maximum(iris, mask)
    # 공막과 눈썹을 피부 염색에서 분리한다. 원본 점막·동공의 세부 색은 그대로 남긴다.
    def regions(contours, expand):
        mask = np.zeros(image.shape[:2], np.uint8)
        for ids in contours:
            cv2.fillConvexPoly(mask, np.int32(np.round(landmarks[ids, :2])), 255)
        if expand:
            mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (expand, expand)))
        return sample(cv2.GaussianBlur(mask, (0, 0), 2.2), uv) / 255
    eyes = regions([[33, 160, 159, 158, 133, 153, 145, 144],
                    [263, 387, 386, 385, 362, 380, 374, 373]], 0)
    brows = regions([[70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
                     [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]], 13)
    brows *= np.clip((150 - rgb.mean(axis=1)) / 82, 0, 1)
    xyz = np.column_stack((x, y, z))
    return np.round(xyz * 24000).astype('<i2'), np.round(np.column_stack((rgb, iris * 255, eyes * 255, brows * 255))).astype('u1')


def ear_colors(image, i):
    # 원화에서 귀 외륜과 귀 앞쪽의 피부 경계를 짚어 안쪽 오목한 부위까지 채집한다.
    if i == 0:
        heights = [383, 397, 423, 453, 486, 520, 548, 574, 590, 596]
        outer = [88, 79, 75, 77, 82, 90, 102, 116, 132, 145]
        inner = [89, 93, 102, 124, 128, 131, 143, 152, 156, 146]
    else:
        heights = [401, 418, 439, 460, 491, 521, 551, 579, 594, 600]
        outer = [1477, 1481, 1481, 1479, 1471, 1464, 1455, 1441, 1429, 1416]
        inner = [1476, 1473, 1458, 1440, 1430, 1423, 1416, 1409, 1406, 1415]
    v, u = np.mgrid[0:41, 0:29]
    u = u / 28
    y = heights[0] + (heights[-1] - heights[0]) * v / 40
    a, b = np.interp(y, heights, outer), np.interp(y, heights, inner)
    xy = np.dstack((a + (b - a) * u, y)).reshape(-1, 2)
    colors = sample(cv2.GaussianBlur(image, (0, 0), 1.1), xy).astype(float)
    neutral = np.array(([205, 170, 151], [224, 192, 177])[i])
    coverage = np.clip(np.sin(np.pi * u) * 5, 0, 1) * np.clip(np.sin(np.pi * v / 40) * 4, 0, 1)
    return np.round(neutral + .88 * coverage.reshape(-1, 1) * (colors - neutral)).astype('u1')


def main():
    model = Path(sys.argv[1])
    source = HERE / 'face-plate.png'
    for path, expected in ((model, MODEL_HASH), (source, PLATE_HASH)):
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'제작 입력 지문이 다릅니다: {path.name}')
    image = cv2.cvtColor(cv2.imread(str(source)), cv2.COLOR_BGR2RGB)
    network = cv2.dnn.readNetFromTFLite(str(model))
    marks = np.array([measure(image, network, i) for i in range(2)])
    template, topo = atlas(marks)
    grid = interpolated_fields(template, topo, marks)
    pts, rim_count = sample_points(template)
    faces = triangulate(pts)
    # 외곽 직선 위의 부동소수점 오차로 생긴 폭 없는 삼각형은 두피 접합부와 겹친다.
    faces = faces[np.any(faces >= rim_count, axis=1)]
    # 영상의 아래쪽이 +Y이므로 앞(+Z)을 바라보게 감김 방향을 뒤집는다.
    faces = faces[:, [0, 2, 1]]
    data = {}
    for i, name in enumerate(('youth', 'maiden')):
        xyz, colors = baked_face(i, pts, rim_count, template, marks[i], grid, image)
        data[name + 'Positions'] = xyz
        data[name + 'Colors'] = colors
        data[name + 'Ear'] = ear_colors(image, i)
    data['triangles'] = faces.astype('<u2')
    text = ['// 생성 파일. 제작 입력과 재생성 방법은 scripts/avatar-face/bake-face.py에 기록한다.', f'export const rimCount = {rim_count};']
    for name, arr in data.items():
        encoded = base64.b64encode(arr.tobytes()).decode()
        text.append(f'export const {name} =\n  ' + ' +\n  '.join(repr(encoded[i:i + 120]) for i in range(0, len(encoded), 120)) + ';')
    (HERE.parents[1] / 'assets/avatar/art/face-data.js').write_text('\n'.join(text) + '\n')
    print(f'앞얼굴 정점 {len(pts)}, 삼각형 {len(faces)}, 경계 {rim_count}')


if __name__ == '__main__':
    main()
