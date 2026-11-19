import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadVillageMap(root, mapPath = '/assets/village/maps/plaza.json') {
  const map = JSON.parse(await readFile(resolve(root, `.${mapPath}`), 'utf8'));
  const collision = map.layers?.find(layer => layer.name === 'collision' && layer.type === 'tilelayer');
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 1 || map.height < 1 || !collision || collision.data.length !== map.width * map.height) throw new Error('마을 충돌 지도를 확인해 주세요.');
  const properties = Object.fromEntries((map.properties || []).map(item => [item.name, item.value]));
  const spawn = { x: properties.spawnX ?? 20, y: properties.spawnY ?? 20 };
  const walkable = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height && collision.data[y * map.width + x] === 0;
  if (!walkable(spawn.x, spawn.y)) throw new Error('마을 입장 위치를 확인해 주세요.');
  return { map, spawn, walkable };
}
