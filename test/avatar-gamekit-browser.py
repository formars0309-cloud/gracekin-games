"""Playwright·Pillow 검증. --fixture는 동기 렌더러 계약만 검증한다."""
import argparse
import hashlib
import io
import json
import math
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ASSETS = Path(__file__).resolve().parents[1] / 'assets/avatar'
FRONT = 'http://localhost'
SHELL = """<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<main></main><script type="module">
import { mountAvatarExport } from '/assets/avatar/gamekit.js';
window.events = [];
window.liveUrls = new Set();
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = create(blob); liveUrls.add(url); return url; };
URL.revokeObjectURL = url => { liveUrls.delete(url); revoke(url); };
window.mount = () => { window.control = mountAvatarExport(document.querySelector('main'), () => window.avatar); };
mount();
</script></html>"""
FIXTURE = """
export function createAvatarView(stage, character, { mode }) {
  events.push(['생성', mode, stage.clientWidth, stage.clientHeight]);
  const frame = document.createElement('canvas');
  frame.width = stage.clientWidth;
  frame.height = stage.clientHeight;
  const ctx = frame.getContext('2d');
  return {
    captureFrame({ angle, motion, phase, view }) {
      events.push(['프레임', angle, motion, phase, view]);
      ctx.clearRect(0, 0, frame.width, frame.height);
      if (window.blank) return frame;
      ctx.save();
      ctx.scale(frame.width / 100, frame.height / 100);
      ctx.translate(50, 5);
      if (view === 'face') ctx.scale(1.8, 1.8);
      ctx.fillStyle = character.appearance.hairColor;
      ctx.fillRect(-10, 5 + phase, 20, 24);
      ctx.fillStyle = character.appearance.clothColor;
      ctx.fillRect(-15, 29, 30, 44);
      ctx.fillStyle = 'white';
      if (Math.abs(angle) < 3) ctx.fillRect(-2 + Math.sin(angle) * 9, 15, 4, 3);
      if (motion === 'walk') ctx.fillRect(3 + 10 * Math.sin(phase * Math.PI * 2), 73, 5, 14);
      ctx.restore();
      return frame;
    },
    dispose() { events.push(['해제', mode]); }
  };
}
"""


def avatar(index):
    appearance = dict(height=43, build=38, shoulders=42, jaw=30, eyes=73, nose=35, hairStyle=1,
                      skinColor='#f1cea6', hairColor='#61482d', eyeColor='#497f86', clothColor='#45706b')
    if index:
        appearance.update(jaw=25, eyes=82, shoulders=33, hairStyle=3, hairColor='#352957', clothColor='#935574')
    return dict(id='public-avatar' if index else None, revision=3 if index else 0, session='비공개 표식',
                character=dict(name='비공개 표식', answers=['비공개 표식'], recommendedJob='healer',
                               appearance=appearance, job='arcanist' if index else 'guardian'))


def visible_png(image, size):
    assert image.mode == 'RGBA' and image.size == size, (image.mode, image.size)
    alpha = image.getchannel('A')
    assert alpha.getextrema() == (0, 255)
    assert sum(alpha.histogram()[128:]) > size[0] * size[1] * 0.01


def verify_archive(path, expected):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        assert sorted(archive.namelist()) == ['atlas.json', 'avatar.json', 'pawn.png', 'portrait.png', 'sprites.png']
        snapshot = json.loads(archive.read('avatar.json'))
        character = expected['character']
        appearance = {'faceBase': 'maiden', **character['appearance']}
        assert snapshot == dict(version=2, id=expected['id'], revision=expected['revision'],
                                character=dict(job=character['job'], appearance=appearance))
        atlas = json.loads(archive.read('atlas.json'))
        assert atlas['version'] == 1 and atlas['origin'] == 'top-left' and atlas['units'] == 'px'
        assert atlas['frameSize'] == dict(w=192, h=192)
        sheet = Image.open(io.BytesIO(archive.read(atlas['image'])))
        assert sheet.size == (atlas['width'], atlas['height']) == (1152, 768)
        boards = []
        for name in ['portrait.png', 'pawn.png']:
            image = Image.open(io.BytesIO(archive.read(name)))
            visible_png(image, (512, 512))
            boards.append(hashlib.sha256(image.tobytes()).digest())
        assert boards[0] != boards[1]
        seen = set()
        poses = {}
        for clip in atlas['animations']:
            motion, direction = clip['motion'], clip['direction']
            assert clip['loop'] and clip['frameMs'] == {'idle': 500, 'walk': 125}[motion]
            hashes = []
            for frame in clip['frames']:
                x, y, w, h = (frame[key] for key in ('x', 'y', 'w', 'h'))
                assert (x, y) not in seen and x % 192 == y % 192 == 0
                assert 0 <= x < sheet.width and 0 <= y < sheet.height
                seen.add((x, y))
                image = sheet.crop((x, y, x + w, y + h))
                visible_png(image, (192, 192))
                hashes.append(hashlib.sha256(image.tobytes()).digest())
            assert len(hashes) == {'idle': 2, 'walk': 4}[motion]
            poses[direction, motion] = hashes
        assert len(seen) == 24 and len(poses) == 8
        assert len({poses[d, 'idle'][0] for d in ['down', 'left', 'right', 'up']}) == 4
        for direction in ['down', 'left', 'right', 'up']:
            idle, walk = poses[direction, 'idle'], poses[direction, 'walk']
            assert len(set(walk)) >= 2 and set(walk) - set(idle)
        return boards, hashlib.sha256(sheet.tobytes()).digest()


def run(options):
    def resource(route):
        url = urlparse(route.request.url)
        if url.netloc != 'localhost':
            raise AssertionError('외부 주소 요청이 발생했습니다.')
        if url.path == '/':
            route.fulfill(content_type='text/html', body=SHELL)
        elif url.path == '/assets/avatar/renderer.js' and options.fixture:
            route.fulfill(content_type='text/javascript', body=FIXTURE)
        elif url.path.startswith('/assets/avatar/') and '..' not in url.path:
            name = url.path.removeprefix('/assets/avatar/')
            folder = ASSETS if name in ('gamekit.js', 'gamekit-zip.js', 'model.js') else options.renderer_root
            module = folder / name
            if module.is_file():
                route.fulfill(content_type='text/javascript', path=module)
            else:
                route.fulfill(status=404)
        else:
            route.fulfill(status=404)

    with sync_playwright() as api, tempfile.TemporaryDirectory() as directory:
        browser = api.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport=dict(width=320, height=720), is_mobile=True, has_touch=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', resource)
        page.goto(FRONT)
        build = page.get_by_role('button', name='게임 파일 만들기')
        link = page.get_by_role('link', name='게임 파일 받기 (ZIP)')
        status = page.get_by_role('status')
        outputs = []
        samples = [avatar(0), avatar(1)]
        if not options.fixture:
            # 두 기본 외형은 같은 직업 그대로 내보내 머리와 체형 차이도 독립적으로 확인한다.
            samples.extend(page.evaluate("""async () => {
              const {createAvatarPreset} = await import('/assets/avatar/model.js');
              return ['youth', 'maiden'].map(key => ({id: null, revision: 0, character: createAvatarPreset(key)}));
            }"""))
        for index, data in enumerate(samples):
            page.evaluate('data => window.avatar = data', data)
            build.click()
            expect(link).to_be_visible(timeout=60000)
            assert page.evaluate('liveUrls.size') == 1
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            with page.expect_download() as downloaded:
                link.click()
            assert downloaded.value.suggested_filename == 'avatar-gamekit.zip'
            target = Path(directory) / f'{index}.zip'
            downloaded.value.save_as(target)
            outputs.append(verify_archive(target, data))
        for first, second in zip(outputs[::2], outputs[1::2]):
            assert all(a != b for a, b in zip(first[0], second[0]))
            assert first[1] != second[1]
        if options.fixture:
            events = page.evaluate('events')
            assert [e[1:] for e in events if e[0] == '생성'] == [['board', 512, 512], ['rpg', 192, 192]] * 2
            assert [e[1] for e in events if e[0] == '해제'] == ['board', 'rpg'] * 2
            frames = [e[1:] for e in events if e[0] == '프레임']
            expected = [[0, 'idle', 0, 'face'], [0, 'idle', 0, 'full']]
            for angle in [0, -math.pi / 2, math.pi / 2, math.pi]:
                expected.extend([angle, 'idle', phase, 'full'] for phase in [0, 0.25])
                expected.extend([angle, 'walk', phase, 'full'] for phase in [0, 0.25, 0.5, 0.75])
            assert frames == expected * 2
            page.evaluate('window.blank = true')
            build.click()
            expect(status).to_contain_text('만들지 못했습니다')
            assert page.evaluate("events.at(-1)[0] === '해제'")
            page.evaluate('window.blank = false')
        page.evaluate("window.avatar.character.job = '잘못된 값'")
        build.click()
        expect(status).to_contain_text('만들지 못했습니다')
        expect(build).to_be_enabled()
        expect(link).to_have_count(0)
        assert page.evaluate('liveUrls.size') == 0
        page.evaluate('data => window.avatar = data', avatar(0))
        if options.fixture:
            # 첫 PNG 인코딩 도중 닫아도 다운로드 주소나 렌더러가 남지 않아야 한다.
            page.evaluate("""() => {
              const original = HTMLCanvasElement.prototype.toBlob;
              HTMLCanvasElement.prototype.toBlob = function(...args) {
                control.dispose();
                return original.apply(this, args);
              };
              document.querySelector('button').click();
            }""")
            page.wait_for_function("events.at(-1)[0] === '해제' && !document.querySelector('.avatar-gamekit')")
        else:
            build.click()
            expect(link).to_be_visible(timeout=60000)
            page.evaluate('control.dispose()')
        assert page.evaluate("liveUrls.size === 0 && !document.querySelector('[inert], .avatar-gamekit')")
        assert not errors, errors
        browser.close()
    print(f'외형 {len(samples)}종의 ZIP·투명 PNG·방향별 동작·스냅샷·모바일 다운로드·자원 해제를 확인했습니다.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--renderer-root', type=Path, default=ASSETS)
    run(parser.parse_args())
