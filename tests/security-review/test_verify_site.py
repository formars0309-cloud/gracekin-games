"""API 요청 경계와 공개 파일 검사 범위의 회귀 사례."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('verify_site', Path(__file__).resolve().parents[2] / 'scripts/verify_site.py')
SITE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SITE)


class NetworkBoundaryTests(unittest.TestCase):
    def test_same_origin_api_requests_are_allowed(self):
        for source in [
            "fetch('/api/community/session')",
            'fetch("/api/auth/sign-in/email", {method: "POST"})',
            'fetch(`/api/community/posts?game=${gameId}`)',
            'fetch(`/api${path}`, {credentials: "same-origin", ...options})',
            "window.fetch('/api/community/posts')",
        ]:
            with self.subTest(source=source):
                self.assertEqual(SITE.network_issues(source), [])

    def test_external_non_api_and_unknown_fetch_are_rejected(self):
        for source in [
            "fetch('https://gyeongguk.gracekingames.com/')",
            "fetch('//example.invalid/api/session')",
            "fetch('https://gracekingames.com/api/session')",
            "fetch('/community/data.json')",
            "fetch('/apiary/session')",
            'fetch(url)',
            "fetch('/api/../game.js')",
            "fetch('/api/%2e%2e/game.js')",
            "fetch(`/api/${fetch('https://example.invalid')}`)",
            'fetch(new Request("/api/session"))',
            'const load = fetch; load("/api/session")',
            'window["fetch"]("/api/session")',
            r"fetch('/api\\host/path')",
        ]:
            with self.subTest(source=source):
                self.assertTrue(SITE.network_issues(source))

    def test_only_fixed_account_summary_is_allowed_in_header_context(self):
        allowed = "fetch('https://community.gracekingames.com/api/account/summary', {credentials: 'include'})"
        self.assertTrue(SITE.network_issues(allowed))
        self.assertEqual(SITE.network_issues(allowed, allow_summary=True), [])
        for url in [
            'https://community.gracekingames.com/api/account/session',
            'https://community.gracekingames.com/api/account/summary?userId=other',
            'https://community.gracekingames.com/api/account/summary/',
            'https://community.gracekingames.com:444/api/account/summary',
            'http://community.gracekingames.com/api/account/summary',
            'https://community.gracekingames.com.evil.test/api/account/summary',
        ]:
            with self.subTest(url=url):
                self.assertTrue(SITE.network_issues(f"fetch('{url}')", allow_summary=True))

    def test_comments_and_user_facing_text_are_not_executed(self):
        source = '''// fetch('https://example.invalid')
        /* localStorage.setItem('posts', data); */
        const help = "fetch('/not-api') 또는 localStorage 예시";
        fetch('/api/community/posts');'''
        self.assertEqual(SITE.network_issues(source), [])

    def test_storage_and_unapproved_transports_are_rejected(self):
        for source in [
            "localStorage.setItem('posts', data)",
            "sessionStorage.setItem('token', token)",
            "window['localStorage'].getItem('posts')",
            'new XMLHttpRequest()',
            "new WebSocket('/api/events')",
            "new EventSource('/api/events')",
            "navigator.sendBeacon('/api/event', body)",
            "new Worker('/game.js')",
        ]:
            with self.subTest(source=source):
                self.assertTrue(SITE.network_issues(source))


class HostRouterTests(unittest.TestCase):
    ROUTER = """const COMMUNITY_ORIGIN = 'https://community.gracekingames.com';
    const isPages = location.hostname === 'gracekingames.com' || location.hostname === 'www.gracekingames.com';
    if (isPages) {
      const destination = new URL(COMMUNITY_ORIGIN);
      destination.pathname = location.pathname;
      destination.search = location.search;
      destination.hash = location.hash;
      location.replace(destination.href);
    }"""

    def test_only_fixed_host_navigation_is_allowed(self):
        self.assertEqual(SITE.host_router_issues(self.ROUTER), [])
        for source in [
            self.ROUTER.replace('https://community.gracekingames.com', 'https://other.invalid'),
            self.ROUTER.replace('new URL(COMMUNITY_ORIGIN)', 'new URL(location.search.slice(1))'),
            self.ROUTER + " fetch('/api/session');",
            self.ROUTER + " fetch('https://other.invalid');",
        ]:
            with self.subTest(source=source):
                self.assertTrue(SITE.host_router_issues(source))


class PublicAssetTests(unittest.TestCase):
    def test_docker_requires_server_module_and_asset_parent_allowances(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'server').mkdir()
            (root / 'server/grain.js').write_text('')
            (root / 'assets/currency').mkdir(parents=True)
            (root / 'assets/currency/grain.png').write_bytes(b'')
            (root / 'index.html').write_text('<img src="/assets/currency/grain.png">')
            manifest = root / '.dockerignore'
            manifest.write_text('**\n!index.html\n!server/\n!assets/\n!assets/currency/grain.png\n')
            failures = SITE.verify(root).failures
            self.assertIn('server/grain.js: 운영 패키지에서 서버 파일 누락', failures)
            self.assertIn('index.html (img.src): 운영 패키지에서 내부 자산 누락', failures)
            manifest.write_text(manifest.read_text() + '!server/grain.js\n!assets/currency/\n')
            self.assertFalse(any('운영 패키지' in failure for failure in SITE.verify(root).failures))

    def test_summary_exception_is_limited_to_the_shared_header_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'assets/shared').mkdir(parents=True)
            source = "fetch('https://community.gracekingames.com/api/account/summary', {credentials: 'include'})"
            (root / 'assets/shared/account-header.js').write_text(source)
            (root / 'assets/other.js').write_text(source)
            failures = SITE.verify(root).failures
            self.assertFalse(any('assets/shared/account-header.js: 같은 출처' in failure for failure in failures))
            self.assertTrue(any('assets/other.js: 같은 출처' in failure for failure in failures))

    def test_css_assets_and_imports_are_collected(self):
        source = '''/* url('/missing-commented.png') */
        @import "base.css";
        .hero {background: url('/assets/hero.webp')}
        .icon {mask-image: url(../icon.svg#symbol)}'''
        self.assertEqual(SITE.css_references(source), ['/assets/hero.webp', '../icon.svg#symbol', 'base.css'])

    def test_asset_escape_is_rejected_and_fragment_keeps_current_document(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'community').mkdir()
            page = root / 'community/index.html'
            page.write_text('<main id="content"></main>')
            self.assertEqual(SITE.local_target(root, page, '#content'), (page, 'content'))
            with self.assertRaises(ValueError):
                SITE.local_target(root, page, '../../private.txt')

    def test_private_and_server_directories_do_not_enter_production_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected = root / 'assets/community.js'
            for relative in ['assets/community.js', 'server/app.js', 'server/test/key.js', 'node_modules/tool.js', '.data/db.js', '.handoff/token.js', 'tests/security-review/fixture.js']:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('')
            self.assertEqual(SITE.production_files(root, {}), [expected])


if __name__ == '__main__':
    unittest.main()
