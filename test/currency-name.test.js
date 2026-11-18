import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('공개 HTML·JS는 옛 이름 안내를 제외하고 변경된 화폐 이름과 아이콘만 사용함', async () => {
  const root = new URL('../', import.meta.url);
  const files = ['index.html'];
  for (const directory of ['account', 'community', 'games', 'privacy', 'assets']) {
    const entries = await readdir(new URL(`${directory}/`, root), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.(html|js)$/.test(entry.name)) files.push(join(entry.parentPath, entry.name));
    }
  }
  for (const file of files) {
    const source = await readFile(file === 'index.html' ? new URL(file, root) : file, 'utf8');
    const allowed = file.endsWith('/community/terms/index.html') ? source.replaceAll('옛 이름: 그레인', '') : source;
    assert.ok(!allowed.includes('그레인'), `${file}: 화면에 이전 화폐 이름이 남았습니다.`);
    assert.ok(!source.includes('/assets/currency/grain.png'), `${file}: 이전 아이콘 경로가 남았습니다.`);
  }
  const terms = await readFile(new URL('community/terms/index.html', root), 'utf8');
  assert.ok(terms.includes('그레이스킨 코인(옛 이름: 그레인)'));
});
