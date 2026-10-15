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
    ROUTER = """const COMMUNITY_ORIGIN = 'https://gracekin-games-community.fly.dev';
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
            self.ROUTER.replace('https://gracekin-games-community.fly.dev', 'https://other.invalid'),
            self.ROUTER.replace('new URL(COMMUNITY_ORIGIN)', 'new URL(location.search.slice(1))'),
            self.ROUTER + " fetch('/api/session');",
            self.ROUTER + " fetch('https://other.invalid');",
        ]:
            with self.subTest(source=source):
                self.assertTrue(SITE.host_router_issues(source))


class PublicAssetTests(unittest.TestCase):
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
