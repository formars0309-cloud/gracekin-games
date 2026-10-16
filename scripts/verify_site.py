#!/usr/bin/env python3
"""공개 사이트의 자산·게임 분리·API 요청 경계와 비밀정보 노출을 검사한다.

정적 검사는 브라우저·서버 보안 실험을 대신하지 않는다. 서버와 시험 자료는
공개 파일 검사에 섞지 않으며, 회원 기능은 같은 출처의 /api 요청으로만 허용한다.
"""
from __future__ import annotations

import argparse
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
GAME_HOSTS = {urlsplit(url).hostname for url in GAME_URLS.values()}
UMAMI_ID = '262268ac-4e27-49fa-862a-c911f4d38993'
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
SECRET_PATTERNS = [
    re.compile(r'-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----'),
    re.compile(r'\b(?:ghp_|github_pat_|sk_live_|sk-proj-)[A-Za-z0-9_\-]{12,}'),
    re.compile(r'\bAKIA[A-Z0-9]{16}\b'),
    re.compile(r'(?i)\b(?:password|secret|token|api[_-]?key)\s*[:=]\s*[\"\'][^\"\']{8,}[\"\']'),
]


class Report:
    def __init__(self):
        self.failures: list[str] = []
        self.checks = 0
        self.pages = 0

    def check(self, condition: bool, description: str) -> None:
        self.checks += 1
        if not condition:
            self.failures.append(description)


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
        self.inline_scripts: list[str] = []
        self.inline_styles: list[str] = []
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
        if attrs.get('style'):
            self.inline_styles.append(attrs['style'])

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
        if self.stack and self.stack[-1] == 'script':
            self.inline_scripts.append(data)
        if self.stack and self.stack[-1] == 'style':
            self.inline_styles.append(data)


def local_target(root: Path, page: Path, value: str) -> tuple[Path, str] | None:
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme not in {'', 'https', 'http'} or parsed.hostname not in {'gracekingames.com', 'www.gracekingames.com'}:
            return None
    path = unquote(parsed.path)
    target = (root / path.lstrip('/')) if path.startswith('/') else (page.parent / path)
    if not path and page.suffix == '.html':
        target = page
    target = target.resolve()
    if not target.is_relative_to(root):
        raise ValueError('공개 루트 밖 경로')
    if target.is_dir() or path.endswith('/'):
        target /= 'index.html'
    return target, parsed.fragment


def javascript_tokens(source: str) -> list[tuple[str, str]]:
    """주석·문자열 속 예시를 실행 호출로 오인하지 않는 작은 토큰 판독기."""
    def quoted_end(start: int) -> tuple[int, list[str]]:
        quote = source[start]
        cursor = start + 1
        expressions = []
        while cursor < len(source):
            if source[cursor] == '\\':
                cursor += 2
            elif source[cursor] == quote:
                return cursor + 1, expressions
            elif quote == '`' and source.startswith('${', cursor):
                expression_start = cursor + 2
                cursor = expression_end(expression_start)
                expressions.append(source[expression_start:cursor - 1])
            else:
                cursor += 1
        return cursor, expressions

    def expression_end(start: int) -> int:
        cursor, depth = start, 1
        while cursor < len(source):
            if source.startswith('//', cursor):
                end = source.find('\n', cursor + 2)
                cursor = len(source) if end < 0 else end + 1
            elif source.startswith('/*', cursor):
                end = source.find('*/', cursor + 2)
                cursor = len(source) if end < 0 else end + 2
            elif source[cursor] in "'\"`":
                cursor, _ = quoted_end(cursor)
            elif source[cursor] == '{':
                depth += 1
                cursor += 1
            elif source[cursor] == '}':
                depth -= 1
                cursor += 1
                if depth == 0:
                    return cursor
            else:
                cursor += 1
        return cursor

    result = []
    index = 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
        elif source.startswith('//', index):
            end = source.find('\n', index + 2)
            index = len(source) if end < 0 else end + 1
        elif source.startswith('/*', index):
            end = source.find('*/', index + 2)
            index = len(source) if end < 0 else end + 2
        elif char in "'\"`":
            quote = char
            end, expressions = quoted_end(index)
            result.append(('template' if quote == '`' else 'string', source[index + 1:end - 1]))
            for expression in expressions:
                result.extend(javascript_tokens(expression))
            index = end
        elif char.isalpha() or char in '_$':
            end = index + 1
            while end < len(source) and (source[end].isalnum() or source[end] in '_$'):
                end += 1
            result.append(('identifier', source[index:end]))
            index = end
        else:
            result.append(('punctuation', char))
            index += 1
    return result


def api_argument_allowed(token: tuple[str, str]) -> bool:
    kind, value = token
    if kind not in {'string', 'template'} or '\\' in value or any(char in value for char in '\r\n\t'):
        return False
    prefix = value.split('${', 1)[0] if kind == 'template' else value
    if any(segment in {'.', '..'} for segment in unquote(urlsplit(prefix).path).split('/')):
        return False
    if kind == 'template':
        prefix = value.split('${', 1)[0]
        # 공통 헬퍼 fetch(`/api${path}`)는 반드시 같은 출처에 머문다.
        # 일반 호출은 /api/ 아래 정적 접두부가 있어야 한다.
        return bool(re.match(r'^/api(?:/|[?#]|$)', prefix))
    parsed = urlsplit(value)
    return not parsed.scheme and not parsed.netloc and (parsed.path == '/api' or parsed.path.startswith('/api/'))


def network_issues(source: str) -> list[str]:
    tokens = javascript_tokens(source)
    issues = []
    forbidden = {'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'Worker', 'SharedWorker'}
    for index, (kind, value) in enumerate(tokens):
        if kind == 'identifier' and value in {'localStorage', 'sessionStorage'}:
            issues.append('브라우저 저장소 기반 공유 데이터 또는 인증 보관 발견')
        if kind == 'string' and value in {'localStorage', 'sessionStorage', 'fetch'} and index and tokens[index - 1][1] == '[':
            issues.append('계산된 속성으로 저장소·네트워크에 접근: 수동 검토 필요')
        if kind != 'identifier':
            continue
        following = tokens[index + 1:index + 3]
        if value in forbidden and following and following[0][1] == '(':
            issues.append('승인되지 않은 네트워크 전송 방식 발견')
        if value != 'fetch':
            continue
        if len(following) != 2 or following[0][1] != '(' or not api_argument_allowed(following[1]):
            issues.append('같은 출처 /api 이외의 fetch 또는 판별 불가 요청 발견')
    return list(dict.fromkeys(issues))


def host_router_issues(source: str) -> list[str]:
    """고정된 커뮤니티 호스트 이동 파일에는 API 호출이나 외부 목적지 추가를 허용하지 않는다."""
    issues = network_issues(source)
    tokens = javascript_tokens(source)
    if any(kind == 'identifier' and value == 'fetch' for kind, value in tokens):
        issues.append('호스트 이동 파일의 네트워크 요청 발견')
    origins = [value for kind, value in tokens if kind in {'string', 'template'} and value.startswith(('http:', 'https:', '//'))]
    if origins != ['https://community.gracekingames.com']:
        issues.append('고정 커뮤니티 출처 이외의 이동 목적지 발견')
    required = ["location.hostname === 'gracekingames.com'", "location.hostname === 'www.gracekingames.com'", 'new URL(COMMUNITY_ORIGIN)', 'destination.pathname = location.pathname', 'destination.search = location.search', 'destination.hash = location.hash', 'location.replace(destination.href)']
    if not all(value in source for value in required):
        issues.append('고정 출처·경로 보존을 위한 호스트 이동 경계 확인 필요')
    return list(dict.fromkeys(issues))


def css_references(source: str) -> list[str]:
    clean = re.sub(r'/\*.*?\*/', '', source, flags=re.S)
    urls = [match.group(2).strip() for match in re.finditer(r'url\(\s*([\"\']?)(.*?)\1\s*\)', clean, re.I | re.S)]
    urls += [match.group(2) for match in re.finditer(r'@import\s+([\"\'])(.*?)\1', clean, re.I)]
    return [url for url in urls if url and not url.startswith('#')]


def production_files(root: Path, pages: dict[Path, Page]) -> list[Path]:
    # 서버 소스·시험 fixture·설치 모듈·DB·로컬 인계 자료를 브라우저 코드로 읽지 않는다.
    files = set(pages)
    for folder in ('assets', 'games', 'community'):
        for suffix in ('*.js', '*.css'):
            files.update((root / folder).rglob(suffix))
    if (root / 'README.md').is_file():
        files.add(root / 'README.md')
    return sorted(files)


def verify(root: Path) -> Report:
    root = root.resolve()
    report = Report()
    check = report.check
    required = [root / 'index.html', root / 'community/index.html', root / 'community/privacy/index.html', root / 'account/index.html'] + [root / f'games/{game}/index.html' for game in GAME_URLS]
    for path in required:
        check(path.is_file(), f'필수 페이지 없음: {path.relative_to(root)}')
    paths = [root / 'index.html'] + sorted((root / 'games').glob('**/*.html')) + sorted((root / 'community').glob('**/*.html')) + sorted((root / 'account').glob('**/*.html'))
    pages = {path: Page(path) for path in paths if path.is_file()}
    report.pages = len(pages)

    def inspect_resource(path: Path, value: str, description: str, *, resource: bool = True) -> None:
        parsed = urlsplit(value)
        check(parsed.scheme not in {'javascript', 'vbscript', 'file'}, f'{description}: 실행형 또는 로컬 파일 경로 발견')
        check(not resource or parsed.hostname not in GAME_HOSTS, f'{description}: START 전 게임 자원 요청 가능')
        try:
            target = local_target(root, path, value)
        except ValueError:
            check(False, f'{description}: 공개 루트 밖 자산 경로')
            return
        if target:
            destination, fragment = target
            check(destination.is_file(), f'{description}: 없는 내부 경로')
            if fragment and destination in pages:
                check(fragment in pages[destination].ids, f'{description}: 없는 문서 위치')

    for path, page in pages.items():
        rel = path.relative_to(root)
        check(not page.errors, f'{rel}: HTML 구조 오류 ({"; ".join(page.errors)})')
        scripts = [attrs for tag, attrs in page.tags if tag == 'script' and attrs.get('src') == 'https://cloud.umami.is/script.js']
        if path.is_relative_to(root / 'account'):
            check(not scripts, f'{rel}: 계정 화면에 외부 통계 스크립트가 있음')
            external_scripts = [attrs for tag, attrs in page.tags if tag == 'script' and urlsplit(attrs.get('src', '')).netloc]
            check(not external_scripts, f'{rel}: 계정 화면에 외부 스크립트가 있음')
            check(any(tag == 'meta' and attrs.get('name') == 'referrer' and attrs.get('content') == 'no-referrer' for tag, attrs in page.tags), f'{rel}: 인증 링크의 참조 주소 전송 차단 없음')
        else:
            check(len(scripts) == 1 and scripts[0].get('data-website-id') == UMAMI_ID and scripts[0].get('data-domains') == 'gracekingames.com' and scripts[0].get('data-do-not-track') == 'true', f'{rel}: 통계 설정 불일치')
        for tag, attrs in page.tags:
            check(tag not in {'iframe', 'embed', 'object'}, f'{rel}: 게임 사전 실행 가능 요소 {tag}')
            for attr in ('src', 'href', 'poster', 'action', 'data-src'):
                value = attrs.get(attr)
                if value:
                    inspect_resource(path, value, f'{rel} ({tag}.{attr})', resource=not (tag == 'a' and attr == 'href'))
            if attrs.get('srcset'):
                for candidate in attrs['srcset'].split(','):
                    parts = candidate.strip().split()
                    if parts:
                        inspect_resource(path, parts[0], f'{rel} ({tag}.srcset)')
            for attr, value in attrs.items():
                if attr.startswith('on') and value:
                    for issue in network_issues(value):
                        check(False, f'{rel} ({tag}.{attr}): {issue}')
        for attrs in page.links:
            check(bool(attrs.get('href')), f'{rel}: 이동하지 않는 링크 발견')
        for source in page.inline_scripts:
            for issue in network_issues(source):
                check(False, f'{rel}: {issue}')
        for source in page.inline_styles:
            for value in css_references(source):
                inspect_resource(path, value, f'{rel} (인라인 CSS)')

    home = pages.get(root / 'index.html')
    if home:
        for game, url in GAME_URLS.items():
            links = [link for link in home.links if link.get('href') == f'/games/{game}/']
            check(len(links) == 3, f'대문: {game} 진입 링크는 무대·그림·버튼 3개여야 함')
            check(all(link.get('data-umami-event') == f'homepage-{game}' for link in links), f'대문: {game} 홈페이지 이동 이벤트 불일치')
            check(not any(link.get('href') == url for link in home.links), f'대문: {game} 게임 직접 실행 링크 발견')
    for game, url in GAME_URLS.items():
        page = pages.get(root / f'games/{game}/index.html')
        if not page:
            continue
        rel = page.path.relative_to(root)
        starts = [link for link in page.links if link.get('href') == url]
        check(len(starts) == 1, f'{rel}: 실제 게임 START 링크는 1개여야 함')
        check(all('START' in link.get('text', '').upper() for link in starts), f'{rel}: START 이외의 게임 직접 진입 링크 발견')
        check(all(link.get('data-umami-event') == f'play-{game}' and link.get('data-umami-event-from') == 'homepage-start' for link in starts), f'{rel}: START 이벤트 불일치')
        other = next(item for item in GAME_URLS if item != game)
        for link in page.links:
            href = link.get('href', '')
            check(f'game={other}' not in href and f'/games/{other}/' not in href and urlsplit(href).hostname != urlsplit(GAME_URLS[other]).hostname, f'{rel}: 다른 게임 링크 혼입')
        check(any(f'game={game}' in link.get('href', '') and '/community/' in link.get('href', '') for link in page.links), f'{rel}: 게임별 커뮤니티 링크 없음')

    host_script = root / 'assets/community/host.js'
    if host_script.is_file():
        for issue in host_router_issues(host_script.read_text()):
            check(False, f'assets/community/host.js: {issue}')

    community_script = root / 'assets/community/community.js'
    check(community_script.is_file(), '커뮤니티 동작 파일 없음')
    account_script = root / 'assets/account/account.js'
    account_entry = root / 'assets/account/entry.js'
    check(account_script.is_file() and account_entry.is_file(), '공통 계정 동작 파일 없음')
    if account_entry.is_file():
        entry = account_entry.read_text()
        tokens = javascript_tokens(entry)
        origins = [value for kind, value in tokens if kind in {'string', 'template'} and value.startswith(('http:', 'https:', '//'))]
        check(origins == ['https://community.gracekingames.com'], '계정 진입: 고정 계정 출처 이외의 이동 목적지 발견')
        check('history.replaceState' in entry and entry.index('history.replaceState') < entry.index('location.replace'), '계정 진입: 이동 전에 인증값을 주소에서 제거해야 함')
        check('destination.hash' in entry and 'destination.search = clean.toString()' in entry, '계정 진입: 인증값은 이동 URL의 해시에만 전달해야 함')
    # 공지 데이터의 보관 위치·개수·특정 JS 구현 문자열에 회원 기능을 결박하지 않는다.
    # 게임별 글·댓글 접근 제어는 실제 API 독립 보안 실험에서 별도로 확인한다.
    for path in production_files(root, pages):
        content = path.read_text()
        rel = path.relative_to(root)
        check(not any(pattern.search(content) for pattern in SECRET_PATTERNS), f'{rel}: 민감정보 의심 패턴 발견 (원문 비노출)')
        if path.suffix == '.js':
            for issue in network_issues(content):
                check(False, f'{rel}: {issue}')
        if path.suffix == '.css':
            for value in css_references(content):
                inspect_resource(path, value, f'{rel} (CSS url)')
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help='읽기 검사할 사이트 루트 (기본: 이 저장소)')
    args = parser.parse_args(argv)
    report = verify(args.root)
    if report.failures:
        print(f'검증 실패: {len(report.failures)}개 / {report.checks}개 확인')
        for failure in report.failures:
            print(f'- {failure}')
        return 1
    print(f'검증 통과: {report.checks}개 확인, {report.pages}개 페이지')
    return 0


if __name__ == '__main__':
    sys.exit(main())
