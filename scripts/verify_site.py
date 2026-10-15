#!/usr/bin/env python3
"""정적 사이트의 진입 흐름, 자산, 게임 분리와 비밀정보 노출을 검사한다."""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
GAME_URLS = {
    'slimeline': 'https://slimeline.gracekingames.com/',
    'gyeongguk': 'https://gyeongguk.gracekingames.com/',
}
UMAMI_ID = '262268ac-4e27-49fa-862a-c911f4d38993'
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
failures: list[str] = []
checks = 0


def check(condition: bool, description: str) -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(description)


class Page(HTMLParser):
    def __init__(self, path: Path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.tags: list[tuple[str, dict[str, str]]] = []
        self.links: list[dict[str, str]] = []
        self.ids: set[str] = set()
        self.stack: list[str] = []
        self.anchor = None
        self.errors: list[str] = []
        self.feed(path.read_text())
        if self.stack:
            self.errors.append('닫히지 않은 태그: ' + ', '.join(self.stack))

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if attrs.get('id'):
            if attrs['id'] in self.ids:
                self.errors.append('중복 식별자: ' + attrs['id'])
            self.ids.add(attrs['id'])
        if tag == 'a':
            self.anchor = {'text': '', **attrs}
            self.links.append(self.anchor)
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == 'a':
            self.anchor = None
        if tag in VOID:
            return
        if not self.stack or self.stack[-1] != tag:
            self.errors.append('태그 짝 불일치: ' + tag)
            if tag in self.stack:
                self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]
        else:
            self.stack.pop()

    def handle_data(self, data):
        if self.anchor is not None:
            self.anchor['text'] += data


def local_target(page: Path, value: str) -> tuple[Path, str] | None:
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        if parsed.netloc not in {'gracekingames.com', 'www.gracekingames.com'}:
            return None
    path = unquote(parsed.path)
    target = (ROOT / path.lstrip('/')) if path.startswith('/') else (page.parent / path)
    target = target.resolve()
    if not target.is_relative_to(ROOT):
        return None
    if target.is_dir() or path.endswith('/'):
        target /= 'index.html'
    return target, parsed.fragment


required = [ROOT / 'index.html', ROOT / 'community/index.html'] + [ROOT / f'games/{game}/index.html' for game in GAME_URLS]
for path in required:
    check(path.is_file(), f'필수 페이지 없음: {path.relative_to(ROOT)}')
paths = [ROOT / 'index.html'] + sorted((ROOT / 'games').glob('**/*.html')) + sorted((ROOT / 'community').glob('**/*.html'))
pages = {path: Page(path) for path in paths if path.is_file()}
for path, page in pages.items():
    rel = path.relative_to(ROOT)
    check(not page.errors, f'{rel}: HTML 구조 오류 ({"; ".join(page.errors)})')
    scripts = [attrs for tag, attrs in page.tags if tag == 'script' and attrs.get('src') == 'https://cloud.umami.is/script.js']
    check(len(scripts) == 1 and scripts[0].get('data-website-id') == UMAMI_ID and scripts[0].get('data-domains') == 'gracekingames.com' and scripts[0].get('data-do-not-track') == 'true', f'{rel}: 통계 설정 불일치')
    for tag, attrs in page.tags:
        check(tag not in {'iframe', 'embed', 'object'}, f'{rel}: 게임 사전 실행 가능 요소 {tag}')
        for attr in ('src', 'href', 'poster', 'action'):
            value = attrs.get(attr)
            if not value:
                continue
            check(not value.startswith('javascript:'), f'{rel}: 실행형 링크 발견')
            parsed = urlsplit(value)
            game_origin = any(parsed.netloc == urlsplit(url).netloc for url in GAME_URLS.values())
            check(not game_origin or (tag == 'a' and attr == 'href'), f'{rel}: START 전 게임 자원 요청 가능 ({tag}.{attr})')
            target = local_target(path, value)
            if not target:
                continue
            destination, fragment = target
            check(destination.is_file(), f'{rel}: 없는 내부 경로 ({tag}.{attr})')
            if fragment and destination in pages:
                check(fragment in pages[destination].ids, f'{rel}: 없는 문서 위치 ({tag}.{attr})')
    for attrs in page.links:
        check(bool(attrs.get('href')), f'{rel}: 이동하지 않는 링크 발견')
    source = path.read_text()
    check(not re.search(r'\b(?:localStorage|sessionStorage)\b', source), f'{rel}: 사용자 글을 오인할 수 있는 브라우저 저장소 사용')

home = pages.get(ROOT / 'index.html')
if home:
    for game, url in GAME_URLS.items():
        links = [link for link in home.links if link.get('href') == f'/games/{game}/']
        check(len(links) == 3, f'대문: {game} 진입 링크는 무대·그림·버튼 3개여야 함')
        check(all(link.get('data-umami-event') == f'homepage-{game}' for link in links), f'대문: {game} 홈페이지 이동 이벤트 불일치')
        check(not any(link.get('href') == url for link in home.links), f'대문: {game} 게임 직접 실행 링크 발견')

for game, url in GAME_URLS.items():
    page = pages.get(ROOT / f'games/{game}/index.html')
    if not page:
        continue
    rel = page.path.relative_to(ROOT)
    starts = [link for link in page.links if link.get('href') == url]
    check(bool(starts), f'{rel}: 실제 게임 START 링크 없음')
    check(all('START' in link.get('text', '').upper() for link in starts), f'{rel}: START 이외의 게임 직접 진입 링크 발견')
    check(all(link.get('data-umami-event') == f'play-{game}' for link in starts), f'{rel}: START 이벤트 불일치')
    other = next(item for item in GAME_URLS if item != game)
    for link in page.links:
        href = link.get('href', '')
        check(f'game={other}' not in href and f'/games/{other}/' not in href and urlsplit(href).netloc != urlsplit(GAME_URLS[other]).netloc, f'{rel}: 다른 게임 링크 혼입')
    community = [link.get('href', '') for link in page.links if '/community/' in link.get('href', '')]
    check(any(f'game={game}' in value for value in community), f'{rel}: 게임별 커뮤니티 링크 없음')

community_script = ROOT / 'assets/community/community.js'
check(community_script.is_file(), '커뮤니티 동작 파일 없음')
if community_script.is_file():
    content = community_script.read_text()
    check(content.count("id: 'welcome'") == 2 and content.count("id: 'play-guide'") == 2 and content.count("id: 'feedback'") == 2, '각 게임 공식 안내 3종 누락')
    check(all(value in content for value in ["free:", "guide:", "gallery:", "notice:", "deck:", "strategy:"]), '게임별 게시판 분류 누락')
    check("Object.prototype.hasOwnProperty.call(GAMES, gameId)" in content and "game.posts.find" in content and "game.posts.filter" in content, '게임별 콘텐츠 선택 경계 누락')
    check('localStorage' not in content and 'sessionStorage' not in content, '커뮤니티에 브라우저 저장소 기반 글 작성 기능 발견')
    check('support@gracekingames.com' in content, '커뮤니티 문의 메일 누락')
    check('viewform' in content, '실제 의견 접수 링크 누락')

# 검사 결과에는 발견된 값이나 원문을 출력하지 않는다.
secret_patterns = [
    re.compile(r'-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----'),
    re.compile(r'\b(?:ghp_|github_pat_|sk_live_|sk-proj-)[A-Za-z0-9_\-]{12,}'),
    re.compile(r'\bAKIA[A-Z0-9]{16}\b'),
    re.compile(r'(?i)\b(?:password|secret|token|api[_-]?key)\s*[:=]\s*[\"\'][^\"\']{8,}[\"\']'),
]
production_files = list(pages) + sorted((ROOT / 'assets').rglob('*.js')) + sorted((ROOT / 'assets').rglob('*.css')) + [ROOT / 'README.md']
for path in production_files:
    content = path.read_text()
    check(not any(pattern.search(content) for pattern in secret_patterns), f'{path.relative_to(ROOT)}: 민감정보 의심 패턴 발견 (원문 비노출)')
    if path.suffix in {'.html', '.js'}:
        check(not re.search(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(', content), f'{path.relative_to(ROOT)}: 사전 네트워크 실행 코드 검토 필요')

if failures:
    print(f'검증 실패: {len(failures)}개 / {checks}개 확인')
    for failure in failures:
        print(f'- {failure}')
    sys.exit(1)
print(f'검증 통과: {checks}개 확인, {len(pages)}개 페이지')
