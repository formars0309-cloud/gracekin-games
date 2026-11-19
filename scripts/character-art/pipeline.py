"""편집 원본에서 부품·명시 마스크·팔레트·검수판을 재현한다.

원본은 저장소 밖에 두며, 생성 API를 호출하지 않는다.
"""
import argparse
import colorsys
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi
from edge_cleanup import restore_outline

SIZE = (1024, 1536)
DELIVERY = (512, 768)
RACES = dict(human='들판의 아이', elf='숲 엘프', dwarf='산 드워프', cat='고양이 수인',
             fox='여우 수인', rabbit='토끼 수인', bear='곰 수인', dragon='작은 용인',
             fairy='별 요정', moon='달그림자족')
HAIR = ['헝클어진 짧은 머리', '긴 생머리', '단정한 단발', '높은 포니테일',
        '양 갈래 땋은 머리', '뻗친 머리', '둥근 보브', '긴 웨이브']
JOBS = dict(guardian='수호기사', windblade='바람검사', monk='무도가', shadow='그림자걸음',
            ranger='숲길잡이', runesmith='룬대장장이', arcanist='룬술사',
            alchemist='연금술사', healer='별빛치유사', bard='음유시인')
LONG_HAIR = {2, 4, 5, 8}


def hsv(rgb):
    """RGB와 HSV의 범위는 모두 0~1이다."""
    hi, lo = rgb.max(-1), rgb.min(-1)
    delta = hi - lo
    safe = np.maximum(delta, 1e-9)
    r, g, b = np.moveaxis(rgb, -1, 0)
    h = np.where(hi == r, ((g - b) / safe) % 6,
                 np.where(hi == g, (b - r) / safe + 2, (r - g) / safe + 4)) / 6
    return h, np.where(hi > 0, delta / np.maximum(hi, 1e-9), 0), hi


def hsv_rgb(h, s, v):
    sector = np.floor(h * 6)
    f = h * 6 - sector
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    choices = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    out = np.zeros((*h.shape, 3), dtype=np.float32)
    for i, channels in enumerate(choices):
        region = sector.astype(int) % 6 == i
        out[region] = np.stack(channels, -1)[region]
    return out


def recolor(image, mask, target):
    """계약 4-3: 원래 선·무채색을 제외한 화소를 중앙값 기준으로 옮긴다.

    중앙값은 마스크>0이며 알파>0인 유효 유채색 화소에서 구한다.
    짝수 개 화소의 중앙값은 가운데 두 값의 산술평균이다.
    마스크는 알파와 별도인 회색조 0~255이며 원본 RGB에 선형 혼합한다.
    """
    pixels = np.asarray(image.convert('RGBA')).astype(np.float32) / 255
    amount = np.asarray(mask.convert('L')).astype(np.float32) / 255
    _, s, v = hsv(pixels[..., :3])
    eligible = (amount > 0) & (pixels[..., 3] > 0) & (v > .22) & (s > .12)
    if not np.any(eligible):
        return image.copy()
    ht, st, vt = colorsys.rgb_to_hsv(*[c / 255 for c in target])
    new_s = np.clip(s / float(np.median(s[eligible])) * max(st, .04), 0, 1)
    new_v = np.clip(v / float(np.median(v[eligible])) * vt, 0, 1)
    rgb = hsv_rgb(np.full(s.shape, ht), new_s, new_v)
    mix = (amount * eligible)[..., None]
    pixels[..., :3] = pixels[..., :3] * (1 - mix) + rgb * mix
    return Image.fromarray(np.floor(np.clip(pixels, 0, 1) * 255 + .5).astype('uint8'))


def load(path):
    image = Image.open(path).convert('RGBA')
    if image.size != SIZE:
        raise ValueError(f'원본 크기 오류: {path}: {image.size}')
    a = np.array(image)
    a[..., 3][a[..., 3] < 40] = 0
    a[..., 3][a[..., 3] >= 248] = 255
    a[a[..., 3] == 0] = 0
    return a


def on_grey(a):
    alpha = a[..., 3:4].astype(np.float32) / 255
    return a[..., :3] * alpha + 128 * (1 - alpha)


def region(points=None, box=None, ellipse=None):
    im = Image.new('L', SIZE)
    draw = ImageDraw.Draw(im)
    if points:
        draw.polygon(points, fill=255)
    if box:
        draw.rectangle(box, fill=255)
    if ellipse:
        draw.ellipse(ellipse, fill=255)
    return np.asarray(im) > 0


def clean(mask, minimum=90):
    labels, count = ndi.label(mask)
    areas = np.bincount(labels.ravel())
    keep = np.flatnonzero(areas >= minimum)
    keep = keep[keep != 0]
    return np.isin(labels, keep) if count else np.zeros(mask.shape, bool)


def layer(a, selected):
    out = a.copy()
    out[..., 3] = np.minimum(out[..., 3], np.clip(selected * 255, 0, 255).astype('uint8'))
    out[out[..., 3] == 0] = 0
    return out


def extract(base, edited, allowed, minimum=90):
    """편집 차이에서 연결된 새 부품을 찾아 원본 색으로 떼어 낸다."""
    diff = np.abs(on_grey(edited) - on_grey(base)).max(-1)
    new = (base[..., 3] == 0) & (edited[..., 3] > 0)
    seed = ((diff > 34) | new) & allowed & (edited[..., 3] > 0)
    seed = clean(ndi.binary_opening(seed), minimum)
    seed = ndi.binary_fill_holes(ndi.binary_closing(seed, iterations=2))
    # 기준 몸과 색이 같은 경계 화소를 제외해야 회색 속옷 테두리가 안 묻는다.
    selected = ndi.binary_dilation(seed, iterations=2) & allowed & ((diff > 12) | new)
    selected &= edited[..., 3] > 0
    return layer(edited, selected)


def palette(prefix, rows):
    return [{'id': f'{prefix}{i + 1}', 'label': name, 'rgb': rgb}
            for i, (name, rgb) in enumerate(rows)]


PALETTES = {
    'hair': palette('c', [('밤색', [124, 74, 44]), ('먹빛', [48, 40, 51]),
                        ('꿀금색', [222, 177, 78]), ('구리빛', [186, 86, 49]),
                        ('은빛', [190, 197, 210]), ('잿빛', [111, 123, 143]),
                        ('장밋빛', [208, 128, 159]), ('자두빛', [129, 87, 153]),
                        ('바다빛', [69, 139, 158]), ('이끼빛', [116, 141, 90])]),
    'eye': palette('e', [('잎빛', [91, 151, 66]), ('호박빛', [177, 113, 49]),
                       ('하늘빛', [78, 139, 196]), ('보랏빛', [146, 98, 181]),
                       ('장밋빛', [183, 94, 129]), ('회청빛', [115, 143, 158])]),
    'skin': palette('s', [('복숭아빛', [244, 186, 148]), ('크림빛', [250, 218, 188]),
                        ('살구빛', [226, 159, 114]), ('꿀빛', [201, 135, 87]),
                        ('호두빛', [158, 99, 64]), ('밤빛', [112, 70, 49])]),
    'accent': palette('a', [('숲빛', [100, 127, 66]), ('바다빛', [58, 127, 151]),
                          ('남청빛', [72, 85, 150]), ('자수정빛', [134, 83, 159]),
                          ('다홍빛', [185, 78, 63]), ('장밋빛', [193, 110, 139]),
                          ('황금빛', [193, 147, 59]), ('청록빛', [58, 141, 127])]),
}


def alignment(base, edited):
    """장식 없는 발·종아리 ROI의 양방향 윤곽 거리를 원본 화소로 잰다."""
    area = region(box=(300, 1250, 659, 1467))
    a, b = base[..., 3] > 128, edited[..., 3] > 128
    ea = (a ^ ndi.binary_erosion(a)) & area
    eb = (b ^ ndi.binary_erosion(b)) & area
    distances = np.concatenate([ndi.distance_transform_edt(~ea)[eb],
                                ndi.distance_transform_edt(~eb)[ea]])
    if not len(distances):
        raise ValueError('정렬 검사 영역에 몸 윤곽이 없습니다')
    return {'roi': [300, 1250, 660, 1468], 'samples': len(distances),
            'maxPx': round(float(distances.max()), 4),
            'meanPx': round(float(distances.mean()), 4)}


def body_masks(body):
    """마스크는 정본의 수동 지정 해부 영역에서 한 번만 확정한다."""
    h, s, v = hsv(body[..., :3].astype(np.float32) / 255)
    eyes = region(ellipse=(399, 487, 459, 566)) | region(ellipse=(544, 485, 607, 566))
    eyes &= (h > .17) & (h < .46) & (s > .15)
    skin = region(box=(240, 250, 740, 1467))
    skin &= (h < .13) & (s > .16) & (v > .25) & (body[..., 3] > 0)
    # 눈 주변의 피부를 직사각형째 빼면 짙은 피부에서 밝은 띠가 남는다.
    # 실제 눈썹 모양만 지정하고 그 안의 어두운 갈색 화소만 제외한다.
    brows = region(points=[(369, 434), (398, 425), (427, 429), (448, 447),
                           (457, 464), (420, 449), (387, 437)])
    brows |= region(points=[(532, 463), (546, 441), (573, 429), (602, 425),
                            (630, 434), (597, 437), (560, 451)])
    skin &= ~(brows & (v < .68) & (s > .42))
    skin &= v > .38
    return skin, eyes


def accent_mask(job, art):
    """옷의 수동 지정 천 영역과 제외 구역에 색 범위를 보조로 적용한다.

    저채도 올리브·하늘색도 영역 안에서 채도 0.035부터 포함한다.
    팔레트를 적용한 결과에서 영역을 재추론하지 않는다.
    """
    ranges = {'guardian': (.52, .78), 'windblade': (.38, .61), 'monk': (.035, .14),
              'shadow': (.60, .88), 'ranger': (.14, .32), 'runesmith': (.005, .065),
              'arcanist': (.68, .89), 'alchemist': (.36, .62), 'healer': (.46, .67),
              'bard': (.88, 1.05)}
    h, s, v = hsv(art[..., :3].astype(np.float32) / 255)
    lo, hi = ranges[job]
    if hi > 1:
        selected_color = (h >= lo) | (h <= hi - 1)
    else:
        selected_color = (h >= lo) & (h <= hi)
    selected = region(points=[(347, 686), (462, 677), (535, 677), (658, 705),
                              (660, 834), (616, 881), (641, 1124), (360, 1124),
                              (381, 881), (336, 834)])
    # 허리띠를 직사각형째 빼지 않고 장식 자체의 색과 실제 윤곽으로 구별한다.
    if job == 'runesmith':
        selected &= ~region(points=[(405, 878), (463, 897), (579, 880),
                                    (601, 930), (468, 946), (398, 920)])
        selected &= ~region(points=[(390, 908), (447, 921), (436, 990), (374, 996)])
        selected &= ~region(box=(514, 883, 619, 1008))
    if job == 'monk':
        selected &= s > .35
    selected &= selected_color & (s > .035) & (v > .15) & (art[..., 3] > 0)
    return selected


def save_art(root, relative, pixels, mask=False, edge_reference=None, hair=False, delivery_reference=None):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.webp.tmp')
    if mask:
        im = Image.fromarray(np.clip(pixels * 255, 0, 255).astype('uint8'))
        im = im.resize(DELIVERY, Image.Resampling.LANCZOS)
        im.save(temporary, 'WEBP', lossless=True, method=6)
    else:
        if edge_reference is not None:
            pixels = restore_outline(pixels, edge_reference, hair=hair)
        im = Image.fromarray(pixels).resize(DELIVERY, Image.Resampling.LANCZOS)
        if edge_reference is not None:
            reference = delivery_reference if delivery_reference is not None else np.array(
                Image.fromarray(edge_reference).resize(DELIVERY, Image.Resampling.LANCZOS))
            im = Image.fromarray(restore_outline(np.array(im), reference, hair=hair))
            # 색 손실 압축의 크로마 번짐이 정리한 경계에 피부색을 다시 섞지 않게 한다.
            im.save(temporary, 'WEBP', lossless=True, method=6, exact=True)
        else:
            im.save(temporary, 'WEBP', quality=88, method=6, exact=True)
    temporary.replace(path)
    if path.stat().st_size > 150_000:
        raise ValueError(f'파일 예산 초과: {path}')
    return relative


def build(work, root, report):
    base = load(work / 'base.png')
    manifest = {'v': 1, 'canvas': {'w': 512, 'h': 768},
                'portrait': {'x': 108, 'y': 80, 'size': 296},
                'order': ['back', 'hairBack', 'body', 'outfit', 'hairFront', 'ears'],
                'races': {}, 'hair': {}, 'outfits': {}, 'palettes': PALETTES}
    metrics = {}
    skin, eye = body_masks(base)
    for race in RACES:
        source = base if race == 'human' else load(work / f'{race}.png')
        metrics[race] = alignment(base, source)
        if metrics[race]['maxPx'] > 2:
            raise ValueError(f'{race} 재편집 필요: {metrics[race]}')
        body = base.copy()
        if race in {'elf', 'fairy'}:
            # 뾰족한 귀는 몸의 일부이며 동물 귀·뿔과 달리 머리 아래에 놓인다.
            area = region(box=(265, 508, 382, 614)) | region(box=(620, 508, 738, 614))
            body[area] = source[area]
        elif race == 'dwarf':
            area = region(box=(353, 423, 647, 475)) | region(box=(481, 551, 522, 580))
            body[area] = source[area]
        elif race in {'dragon', 'moon'}:
            # 알파·의복은 공유 정본을 보존하고 노출된 종족 피부만 편집본에서 옮긴다.
            area = (skin | region(box=(340, 260, 675, 654))) & (base[..., 3] > 0)
            body[area, :3] = source[area, :3]
            body[..., 3] = base[..., 3]
        race_skin, _ = body_masks(body)
        entry = {'body': save_art(root, f'parts/body/{race}.webp', body),
                 'skinMask': None if race in {'dragon', 'moon'} else save_art(root, f'parts/body/{race}-skin.webp', race_skin & (body[..., 3] > 0), True),
                 'eyeMask': save_art(root, f'parts/body/{race}-eye.webp', eye, True),
                 'back': None, 'ears': None}
        delivery_body = np.array(Image.open(root / entry['body']).convert('RGBA'))
        if race in {'cat', 'fox', 'rabbit', 'bear', 'dragon'}:
            art = extract(base, source, region(box=(240, 20, 780, 367)), 150)
            if race == 'dragon':
                # 비늘 두피와 뿔은 모두 차분으로 잡히므로 크림색 뿔의 윤곽을 직접 지정한다.
                horns = region(points=[(335, 278), (362, 273), (370, 301),
                                       (388, 316), (384, 351), (359, 372), (338, 358)])
                horns |= region(points=[(645, 276), (669, 278), (679, 322),
                                        (670, 357), (646, 371), (625, 353), (626, 321)])
                horn_hue, _, horn_value = hsv(source[..., :3].astype(np.float32) / 255)
                horns &= (horn_hue < .2) & (horn_value > .12)
                horns = ndi.binary_fill_holes(horns)
                art = layer(art, horns)
            # 큰 머리카락과 겹치는 귀 뿌리도 남기되 민머리 색은 차분에서 제거한다.
            entry['ears'] = save_art(root, f'parts/race/{race}-ears.webp', art, edge_reference=body, delivery_reference=delivery_body)
        if race in {'cat', 'fox', 'bear', 'dragon', 'fairy'}:
            allowed = region(box=(100, 675, 940, 1360))
            # 뒤층에는 기준 몸 바깥의 새 윤곽만 넣는다. 날개가 팔을 덮지 않는다.
            outside = base[..., 3] == 0
            outer = clean((source[..., 3] > 80) & outside & allowed, 150)
            outer = ndi.binary_dilation(outer, iterations=2) & outside & allowed
            entry['back'] = save_art(root, f'parts/race/{race}-back.webp', layer(source, outer), edge_reference=body, delivery_reference=delivery_body)
        metrics[race]['deliveredLowerAlphaMismatchPixels'] = int(np.count_nonzero(
            body[700:, :, 3] != base[700:, :, 3]))
        if metrics[race]['deliveredLowerAlphaMismatchPixels']:
            raise ValueError(f'{race} 납품 몸의 아랫몸 윤곽이 기준과 다릅니다')
        manifest['races'][race] = entry

    for i, label in enumerate(HAIR, 1):
        front = extract(base, load(work / f'h{i}-front.png'), region(box=(220, 100, 790, 700)))
        entry = {'label': label,
                 'front': save_art(root, f'parts/hair/h{i}-front.webp', front, edge_reference=base, hair=True),
                 'mask': save_art(root, f'parts/hair/h{i}-front-mask.webp', front[..., 3] > 0, True),
                 'back': None, 'backMask': None}
        if i in LONG_HAIR:
            back = extract(base, load(work / f'h{i}-back.png'), region(box=(180, 140, 840, 1120)))
            mask = back[..., 3] > 0
            if i == 5:
                mask &= ~region(box=(275, 888, 340, 950))
                mask &= ~region(box=(674, 888, 733, 950))
            entry['back'] = save_art(root, f'parts/hair/h{i}-back.webp', back, edge_reference=base, hair=True)
            entry['backMask'] = save_art(root, f'parts/hair/h{i}-back-mask.webp', mask, True)
        manifest['hair'][f'h{i}'] = entry
        # 색 마스크와 그림 알파를 이중으로 흐리지 않는다. 경계 RGB도 완전히 색 이동한다.
        for art_key, mask_key in [('front', 'mask'), ('back', 'backMask')]:
            if entry[art_key]:
                alpha = np.array(Image.open(root / entry[art_key]).getchannel('A')) > 0
                current = np.array(Image.open(root / entry[mask_key]).convert('L'))
                strength = np.where(alpha, 255, 0).astype('uint8')
                if i == 5 and art_key == 'back':
                    # 금색 머리끈의 수동 제외 영역은 유지한다.
                    strength[(current == 0) & ndi.binary_erosion(alpha, iterations=3)] = 0
                Image.fromarray(strength).save(root / entry[mask_key], 'WEBP', lossless=True, method=6)

    for job in JOBS:
        source = load(work / f'{job}.png')
        art = extract(base, source, region(box=(230, 668, 766, 1490)), 60)
        # 옷 한가운데는 흰색·회색 금속도 기준 속옷과 닮을 수 있어 직접 지정한다.
        core = region(points=[(453, 704), (543, 704), (577, 724), (598, 820),
                              (588, 914), (621, 1098), (527, 1103), (501, 1041),
                              (482, 1103), (375, 1100), (408, 916), (398, 819), (418, 727)])
        core &= source[..., 3] > 0
        art[core] = source[core]
        manifest['outfits'][job] = {
            'image': save_art(root, f'parts/outfit/{job}.webp', art),
            'accentMask': save_art(root, f'parts/outfit/{job}-accent.webp', accent_mask(job, art), True)}

    total = sum(p.stat().st_size for p in (root / 'parts').rglob('*.webp'))
    if total > 6_000_000:
        raise ValueError('전체 그림 예산 6MB 초과')
    (root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    report.mkdir(parents=True, exist_ok=True)
    (report / '정렬-검사.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + '\n')
    print(f'납품: {len(list((root / "parts").rglob("*.webp")))}개, {total:,}바이트')
    return manifest


def compose(root, manifest, race, hair, job, colors=None):
    colors = colors or {'hair': 0, 'eye': 0, 'skin': 0, 'accent': 0}
    r, h, o = manifest['races'][race], manifest['hair'][hair], manifest['outfits'][job]
    specs = [(r['back'], []), (h['back'], [('hair', h['backMask'])]),
             (r['body'], [('skin', r['skinMask']), ('eye', r['eyeMask'])]),
             (o['image'], [('accent', o['accentMask'])]),
             (h['front'], [('hair', h['mask'])]), (r['ears'], [])]
    canvas = Image.new('RGBA', DELIVERY)
    for path, masks in specs:
        if not path:
            continue
        part = Image.open(root / path).convert('RGBA')
        for category, mask in masks:
            if mask:
                target = manifest['palettes'][category][colors[category]]['rgb']
                part = recolor(part, Image.open(root / mask), target)
        canvas.alpha_composite(part)
    return canvas


def proof_sheets(root, manifest, report):
    font_path = Path('/System/Library/Fonts/AppleSDGothicNeo.ttc')
    font = ImageFont.truetype(str(font_path), 18) if font_path.exists() else ImageFont.load_default()
    def sheet(name, rows, columns=5, cell=(256, 400)):
        result = Image.new('RGB', (columns * cell[0], ((len(rows) + columns - 1) // columns) * cell[1]), '#e9e5dd')
        draw = ImageDraw.Draw(result)
        for i, (label, race, hair, job, colors) in enumerate(rows):
            x, y = (i % columns) * cell[0], (i // columns) * cell[1]
            draw.text((x + 8, y + 5), label, font=font, fill='#303637')
            image = compose(root, manifest, race, hair, job, colors).resize((cell[0], cell[0] * 3 // 2), Image.Resampling.LANCZOS)
            result.paste(image, (x, y + 22), image)
        result.save(report / f'{name}.jpg', quality=85, optimize=True)

    for job in ['guardian', 'ranger']:
        rows = [(f'{RACES[r]} · {h}', r, h, job, None) for r in RACES for h in ['h1', 'h8']]
        sheet(f'종족-조합-{job}', rows)
    sheet('머리-8종', [(f'h{i} {label}', 'human', f'h{i}', 'ranger', None) for i, label in enumerate(HAIR, 1)], 4)
    sheet('직업-10벌', [(label, 'human', 'h1', j, None) for j, label in JOBS.items()])
    palette_rows = []
    for kind, choices in manifest['palettes'].items():
        for i, color in enumerate(choices):
            colors = {'hair': 0, 'eye': 0, 'skin': 0, 'accent': 0}
            colors[kind] = i
            palette_rows.append((f'{kind} {color["id"]} {color["label"]}', 'human', 'h8', 'ranger', colors))
    sheet('팔레트-30색', palette_rows, 10, (176, 286))
    total = sum(p.stat().st_size for p in report.glob('*.jpg'))
    if total > 3_000_000:
        raise ValueError(f'확인판 3MB 예산 초과: {total}')
    print(f'확인판: {len(list(report.glob("*.jpg")))}개, {total:,}바이트')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--root', type=Path, default=Path('assets/character'))
    parser.add_argument('--report', type=Path, default=Path('reports/2026-11-19-캐릭터-그림'))
    parser.add_argument('--proof-only', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((args.root / 'manifest.json').read_text()) if args.proof_only else build(args.work, args.root, args.report)
    proof_sheets(args.root, manifest, args.report)
