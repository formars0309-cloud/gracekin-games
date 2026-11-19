import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findPath } from '../assets/village/pathfinding.js';
import { loadVillageMap } from '../server/village/map.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('공용 맵은 40×30 Tiled 바닥·충돌·다섯 문·NPC 및 충돌 없는 복귀 칸을 갖는다', async () => {
  const { map, spawn, walkable } = await loadVillageMap(root);
  assert.deepEqual([map.width, map.height], [40, 30]); assert.equal(map.type, 'map');
  for (const name of ['ground', 'collision']) assert.equal(map.layers.find(layer => layer.name === name).data.length, 1200);
  const doors = map.layers.find(layer => layer.name === 'doors').objects;
  assert.equal(doors.length, 5);
  const ids = [];
  for (const door of doors) {
    const properties = Object.fromEntries(door.properties.map(item => [item.name, item.value])); ids.push(properties.buildingId);
    assert.equal(properties.requiresLogin, true); assert.equal(properties.minimumAge, 0); assert.equal(properties.capacity, 0);
    assert.equal(properties.roomType, 'shared'); assert.equal(properties.currency, 'none'); assert.equal(properties.rewards, 'none');
    assert.equal(walkable(properties.returnX, properties.returnY), true);
    assert.ok(findPath(map, spawn, { x: properties.returnX, y: properties.returnY }).length > 0, '문 복귀 칸은 입장 위치에서 도달할 수 있어야 합니다.');
  }
  assert.deepEqual(ids.sort(), ['arcade', 'armory', 'inn', 'shop', 'training']);
  assert.equal(map.layers.find(layer => layer.name === 'npcs').objects.length, 1);
  assert.equal(walkable(20, 14), false, '중앙 분수는 통과할 수 없어야 합니다.');
});

test('A*는 분수·충돌 칸을 우회하는 인접 경로를 만들며 지도 밖이나 막힌 목표는 거부한다', async () => {
  const { map, spawn, walkable } = await loadVillageMap(root), goal = { x: 20, y: 9 }, path = findPath(map, spawn, goal);
  assert.ok(path.length > Math.abs(spawn.y - goal.y)); assert.deepEqual(path.at(-1), goal);
  let previous = spawn;
  for (const point of path) { assert.equal(walkable(point.x, point.y), true); assert.equal(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y), 1); previous = point; }
  assert.deepEqual(findPath(map, spawn, { x: 20, y: 14 }), []); assert.deepEqual(findPath(map, spawn, { x: -1, y: 3 }), []);
});

test('정적 검사 예외는 고정 마을 소켓·공용 맵에만 한정하고 다른 네트워크 호출은 계속 거부한다', async () => {
  const source = await readFile(new URL('../assets/village/village.js', import.meta.url), 'utf8');
  const verification = spawnSync('python3', ['-c', `import importlib.util, pathlib, sys
spec=importlib.util.spec_from_file_location('site_check', pathlib.Path('scripts/verify_site.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
source=sys.stdin.read()
assert not m.village_network_issues(source)
assert m.network_issues(source)
assert m.village_network_issues(source.replace('/api/village/ws', '/api/village/elsewhere'))
assert m.village_network_issues(source.replace('/assets/village/maps/plaza.json', '//outside.test/map.json'))
assert m.village_network_issues(source + "\\nnew WebSocket('wss://outside.test/');")
assert m.village_network_issues(source + "\\nfetch('/assets/another.json');")
assert m.village_network_issues(source + "\\nlocalStorage.setItem('state','value');")
`], { cwd: root, input: source, encoding: 'utf8' });
  assert.equal(verification.status, 0, verification.stderr);
});
