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


class RaceNetworkBoundaryTests(unittest.TestCase):
    HELPER = """const API_BASE = ['https://gracekingames.com', 'https://www.gracekingames.com'].includes(location.origin) ? 'https://community.gracekingames.com' : location.origin;
    async function request(kind, payload, controller) {
      if (!['state', 'me', 'tickets', 'history'].includes(kind)) throw new Error('요청 경로 오류');
      return fetch(`${API_BASE}/api/slime-race/${kind}`, { method: payload ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal });
    }"""

    def test_fixed_race_helper_is_allowed_only_in_its_context(self):
        self.assertTrue(SITE.network_issues(self.HELPER))
        self.assertEqual(SITE.race_network_issues(self.HELPER), [])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'assets/slime-race').mkdir(parents=True)
            (root / 'assets/slime-race/race.js').write_text(self.HELPER)
            (root / 'assets/unrelated.js').write_text(self.HELPER)
            failures = SITE.verify(root).failures
            self.assertFalse(any('assets/slime-race/race.js:' in failure for failure in failures))
            self.assertTrue(any('assets/unrelated.js: 같은 출처' in failure for failure in failures))

    def test_namespace_origin_guard_credentials_and_extra_calls_are_rejected(self):
        mutations = [
            self.HELPER.replace('/api/slime-race/', '/api/account/'),
            self.HELPER.replace('https://community.gracekingames.com', 'https://community.gracekingames.com.evil.test'),
            self.HELPER.replace('https://gracekingames.com\',', 'http://gracekingames.com\','),
            self.HELPER.replace('location.origin)', 'location.hostname)'),
            self.HELPER.replace("'https://www.gracekingames.com'", "'https://evil.test'"),
            self.HELPER.replace("'tickets'", "'unknown'"),
            self.HELPER.replace("if (!['state', 'me', 'tickets', 'history'].includes(kind))", 'if (false)'),
            self.HELPER.replace("credentials: 'include'", "credentials: 'omit'"),
            self.HELPER.replace("cache: 'no-store'", "cache: 'default'"),
            self.HELPER + " API_BASE = 'https://evil.test';",
            self.HELPER.replace('return fetch', "kind = '../auth/session'; return fetch"),
            self.HELPER.replace('${kind}', '${kind + "/../auth/session"}'),
            self.HELPER + " fetch('https://community.gracekingames.com/api/auth/sign-in/email');",
            self.HELPER + " fetch(url);",
            self.HELPER + " localStorage.setItem('ticket', 'saved');",
        ]
        for source in mutations:
            with self.subTest(source=source):
                self.assertTrue(SITE.race_network_issues(source))


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


class FontSystemTests(unittest.TestCase):
    def test_role_variables_globals_and_shorthand_metrics_are_allowed(self):
        for property_name, value in [
            ('font-family', 'var(--font-body)'),
            ('font-family', 'var( --font-display ) !important'),
            ('font-family', 'inherit'),
            ('font-family', 'initial'),
            ('font', 'inherit'),
            ('font', 'initial'),
            ('font', 'var(--font-body)'),
            ('font', '16px var(--font-body)'),
            ('font', '600 1rem/1.75 var(--font-body)'),
            ('font', 'italic small-caps 500 16px / 24px var(--font-display)'),
            ('font', 'normal medium/normal var(--font-body) !important'),
            ('font', 'clamp(14px, 2vw, 18px)/calc(1 + .5) var(--font-body)'),
            ('font', 'var(--text-size)/var(--text-leading) var(--font-body)'),
        ]:
            with self.subTest(property_name=property_name, value=value):
                self.assertTrue(SITE.font_value_allowed(property_name, value))

    def test_direct_fonts_fallbacks_and_invalid_shorthand_are_rejected(self):
        for property_name, value in [
            ('font-family', 'Georgia, serif'),
            ('font-family', 'system-ui'),
            ('font-family', 'var(--font-body), sans-serif'),
            ('font-family', 'var(--font-body, Arial)'),
            ('font-family', 'var(--other)'),
            ('font-family', 'unset'),
            ('font', '16px/1.5 Georgia, serif'),
            ('font', '16px var(--font-body), Georgia'),
            ('font', 'Georgia 16px var(--font-body)'),
            ('font', '16px/1.5 18px var(--font-body)'),
            ('font', 'bold var(--font-body)'),
            ('font', 'caption'),
        ]:
            with self.subTest(property_name=property_name, value=value):
                self.assertFalse(SITE.font_value_allowed(property_name, value))

    def test_actual_css_declarations_are_checked_without_matching_comment_or_content(self):
        allowed = '''/* font-family: Georgia; */
        .example::before {content: "예시; font-family: Georgia;"}
        @media (max-width: 600px) {.copy {FONT: 500 16px/1.6 var(--font-body)}}'''
        self.assertEqual(SITE.font_css_issues(allowed, 'assets/example.css'), [])
        for source in ['.copy {font-family: Georgia}', 'font:16px serif', '@media print {.copy {font-family: Arial !important}}']:
            with self.subTest(source=source):
                self.assertTrue(SITE.font_css_issues(source, 'assets/example.css'))

    def test_google_font_requests_are_centralized(self):
        source = "@import url('https://fonts.googleapis.com/css2?family=Cinzel');"
        self.assertEqual(SITE.font_css_issues(source, SITE.FONT_STYLESHEET), [])
        for source in [source, '@import "https://fonts.googleapis.com/css2?family=Cinzel";', 'a{src:url(https://fonts.gstatic.com/test.woff2)}']:
            with self.subTest(source=source):
                self.assertTrue(SITE.font_css_issues(source, 'assets/example.css'))

    def test_handwriting_has_only_the_registered_usage_exceptions(self):
        source = '.copy{font-family:var(--font-hand)}'
        for path in ['games/slimeline/style.css', 'games/slimeline/index.html', 'assets/community/community.css', SITE.FONT_STYLESHEET]:
            with self.subTest(path=path):
                self.assertEqual(SITE.font_css_issues(source, path), [])
        for path in ['assets/example.css', 'games/gyeongguk/style.css', 'community/index.html']:
            with self.subTest(path=path):
                self.assertTrue(SITE.font_css_issues(source, path))

    def font_page_failures(self, root, relative, source):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)
        report = SITE.Report()
        SITE.verify_fonts(root, {path: SITE.Page(path)}, report)
        return report.failures

    def test_page_requires_shared_font_link_before_other_stylesheets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shared = '<link rel="stylesheet" href="/assets/shared/fonts.css">'
            self.assertEqual(self.font_page_failures(root, 'index.html', shared), [])
            for source in ['', '<link rel="stylesheet" href="other.css">' + shared]:
                with self.subTest(source=source):
                    self.assertTrue(self.font_page_failures(root, 'index.html', source))

    def test_html_style_element_attribute_and_google_links_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shared = '<link rel="stylesheet" href="/assets/shared/fonts.css">'
            allowed = shared + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            self.assertEqual(self.font_page_failures(root, 'index.html', allowed), [])
            for extra in [
                '<style>h1{font-family:Georgia}</style>',
                '<p style="font:16px Arial">본문</p>',
                '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel">',
                '<link rel="preconnect" href="https://fonts.googleapis.com/css2?family=Cinzel">',
            ]:
                with self.subTest(extra=extra):
                    self.assertTrue(self.font_page_failures(root, 'index.html', shared + extra))

    def test_root_and_account_css_are_checked_but_private_fixtures_are_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = ['theme.css', 'account/new.css', 'account/admin/new.css']
            private = ['server/theme.css', 'node_modules/tool/theme.css', 'tests/fixture.css']
            for relative in public + private:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('body{font-family:Georgia}')
            report = SITE.Report()
            SITE.verify_fonts(root, {}, report)
            self.assertEqual(len(report.failures), len(public))
            for relative in public:
                self.assertTrue(any(failure.startswith(relative + ':') for failure in report.failures))
            for relative in private:
                self.assertFalse(any(relative in failure for failure in report.failures))

    def test_race_font_is_limited_to_race_stylesheet(self):
        css = '.sr-heading h1{font-family:var(--font-race)}'
        self.assertEqual(SITE.font_css_issues(css, 'assets/slime-race/race.css'), [])
        self.assertTrue(SITE.font_css_issues(css, 'assets/community/community.css'))
        self.assertTrue(SITE.font_css_issues('@font-face{font-family:RaceJua}', 'assets/slime-race/race.css'))

    def test_pending_community_exception_is_limited_and_can_be_removed(self):
        # 커뮤니티 개편 병합으로 기본 예외는 비었다. 예외 장치 자체는 단계적 이전에 쓰므로 계속 검증한다.
        self.assertEqual(SITE.PENDING_FONT_MIGRATION, frozenset())
        source = '''<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel">
        <style>body{font-family:Georgia}</style>'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pending = SITE.PENDING_FONT_MIGRATION
            try:
                SITE.PENDING_FONT_MIGRATION = frozenset({'community/index.html', 'assets/community/community.css'})
                self.assertEqual(self.font_page_failures(root, 'community/index.html', source), [])
                self.assertTrue(self.font_page_failures(root, 'community/privacy/index.html', source))
                self.assertEqual(SITE.font_css_issues('body{font:16px Georgia}', 'assets/community/community.css'), [])
                SITE.PENDING_FONT_MIGRATION = frozenset()
                self.assertTrue(self.font_page_failures(root, 'community/index.html', source))
                self.assertTrue(SITE.font_css_issues('body{font:16px Georgia}', 'assets/community/community.css'))
            finally:
                SITE.PENDING_FONT_MIGRATION = pending

if __name__ == '__main__':
    unittest.main()
