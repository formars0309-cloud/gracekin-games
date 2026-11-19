/* 칸 좌표를 쓰는 네 방향 A*. 서버도 같은 충돌 레이어를 사용한다. */
export function findPath(map, start, goal) {
  const width = map.width, height = map.height;
  const collision = map.layers.find(layer => layer.name === 'collision')?.data || [];
  const passable = ({ x, y }) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height && !collision[y * width + x];
  if (!passable(start) || !passable(goal)) return [];
  const key = ({ x, y }) => y * width + x;
  const distance = cell => Math.abs(cell.x - goal.x) + Math.abs(cell.y - goal.y);
  const open = [{ ...start, cost: 0, score: distance(start) }], costs = new Map([[key(start), 0]]), parents = new Map();
  while (open.length) {
    open.sort((a, b) => a.score - b.score); const current = open.shift();
    if (key(current) === key(goal)) {
      const path = []; let cell = current;
      while (key(cell) !== key(start)) { path.push({ x: cell.x, y: cell.y }); cell = parents.get(key(cell)); }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy }, cost = current.cost + 1;
      if (!passable(next) || cost >= (costs.get(key(next)) ?? Infinity)) continue;
      costs.set(key(next), cost); parents.set(key(next), current); open.push({ ...next, cost, score: cost + distance(next) });
    }
  }
  return [];
}
