import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, matchesGlob } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { request } from './account-helpers.js';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('Docker 허용 목록으로 만든 임시 운영 파일에서 캐릭터 정적 파일과 API를 제공한다', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'character-package-'));
  const output = join(folder, 'app'); await mkdir(output);
  let app;
  try {
    const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /COPY character\/ \.\/character\//);
    const rules = (await readFile(join(root, '.dockerignore'), 'utf8')).split('\n').map(row => row.trim()).filter(row => row && !row.startsWith('#'));
    const allowed = path => {
      let include = true;
      for (const row of rules) {
        const negate = row.startsWith('!'), pattern = negate ? row.slice(1) : row;
        const directory = pattern.endsWith('/');
        if (pattern === '**' ? true : directory ? path === pattern.slice(0, -1) || path.startsWith(pattern) : matchesGlob(path, pattern)) include = negate;
      }
      return include;
    };
    const sources = dockerfile.split('\n').filter(row => row.startsWith('COPY ')).flatMap(row => row.split(/\s+/).slice(1, -1));
    const copied = path => sources.some(source => source.endsWith('/') ? path.startsWith(source) : path === source);
    const files = (await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })).stdout.split('\0').filter(Boolean);
    for (const path of files.filter(path => allowed(path) && copied(path))) {
      await mkdir(dirname(join(output, path)), { recursive: true }); await copyFile(join(root, path), join(output, path));
    }
    // 화면·그림 담당 결과물은 통합 전이므로 임시 폴더에만 자리표시 파일을 둡니다.
    const fixtures = { 'character/index.html': '<!doctype html><html lang="ko"><title>캐릭터 시험</title><body>캐릭터</body></html>', 'assets/character/parts/body/placeholder.webp': '시험 그림 자리' };
    for (const [path, content] of Object.entries(fixtures)) {
      assert.ok(allowed(path) && copied(path), path);
      await mkdir(dirname(join(output, path)), { recursive: true }); await writeFile(join(output, path), content);
    }
    assert.ok(allowed('assets/character/model.js')); assert.ok(allowed('server/character/index.js'));
    assert.equal(allowed('reports/비공개.md'), false); assert.equal(allowed('test/character-api.test.js'), false); assert.equal(allowed('.data/community.sqlite'), false);
    await exec('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: output });
    const { startServer } = await import(pathToFileURL(join(output, 'server/app.js')));
    app = await startServer({ port: 0, rootDir: output, dataDir: join(folder, 'data'), grainRewardsStartTimer: false, env: {} });
    for (const path of ['/character/', '/assets/character/model.js', '/assets/character/parts/body/placeholder.webp', '/health']) assert.equal((await request(app, path)).status, 200, path);
    assert.equal((await request(app, '/api/character/me')).status, 401);
    assert.equal((await request(app, '/server/character/index.js')).status, 404);
    assert.match((await request(app, '/assets/character/model.js')).headers['content-type'], /javascript/);
  } finally { await app?.close(); await rm(folder, { recursive: true, force: true }); }
});
