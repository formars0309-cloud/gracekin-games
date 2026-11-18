// 그래픽 가속이 없는 브라우저에서도 동일한 원형을 깊이 버퍼에 그린다.
// 용지 크기와 프레임 수는 호출자가 제한해 작은 게임 말에도 쓸 수 있게 한다.
export function createPaper(canvas) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return null;
  let model, projected, image, depth;
  function setModel(next) {
    model = next;
    projected = new Float32Array((next.vertices.length / 11) * 9);
  }
  function draw({ bones, sx, sy }) {
    const w = canvas.width,
      h = canvas.height;
    if (image?.width !== w || image?.height !== h) {
      image = context.createImageData(w, h);
      depth = new Float32Array(w * h);
    }
    depth.fill(-Infinity);
    image.data.fill(0);
    const vertices = model.vertices,
      indices = model.indices,
      p = projected;
    for (let i = 0, j = 0; i < vertices.length; i += 11, j += 9) {
      const b = vertices[i + 10] * 16,
        x = vertices[i],
        y = vertices[i + 1],
        z = vertices[i + 2];
      const nx = vertices[i + 3],
        ny = vertices[i + 4],
        nz = vertices[i + 5];
      for (let k = 0; k < 3; k++) {
        const v = b + k;
        p[j + k] = bones[v] * x + bones[v + 4] * y + bones[v + 8] * z + bones[v + 12];
        p[j + 3 + k] = bones[v] * nx + bones[v + 4] * ny + bones[v + 8] * nz;
      }
      const normalX = p[j + 3],
        normalY = p[j + 4],
        normalZ = p[j + 5];
      const length = Math.hypot(normalX, normalY, normalZ) || 1;
      const gloss = vertices[i + 9];
      const floorShade = b === 0 ? 0.72 + 0.28 * Math.min(1, Math.max(0, (Math.hypot(x, z) - 0.1) / 0.55)) : 1;
      for (let side = 0; side < 2; side++) {
        const sign = (side === 0 ? 1 : -1) / length,
          nx = normalX * sign,
          ny = normalY * sign,
          nz = normalZ * sign;
        const light = Math.max(0, -0.52 * nx + 0.69 * ny + 0.5 * nz),
          sky = 0.5 + 0.5 * ny;
        const rim = (1 - Math.min(1, Math.abs(nz))) ** 3 * (0.35 + gloss);
        const spec = Math.max(0, -0.296 * nx + 0.394 * ny + 0.87 * nz) ** (16 + 42 * gloss) * gloss;
        const dest = j + 3 + side * 3;
        const fill = b === 32 ? 0.65 + 0.35 * Math.max(nz, 0) : 0;
        p[dest] =
          255 *
          floorShade *
          (vertices[i + 6] * (0.65 + 0.089 * fill + 0.12 * sky + 0.33 * light) + rim * 0.1 + spec * 0.3);
        p[dest + 1] =
          255 *
          floorShade *
          (vertices[i + 7] * (0.65 + 0.073 * fill + 0.11 * sky + 0.3 * light) + rim * 0.092 + spec * 0.27);
        p[dest + 2] =
          255 *
          floorShade *
          (vertices[i + 8] * (0.72 + 0.068 * fill + 0.1 * sky + 0.23 * light) + rim * 0.079 + spec * 0.2);
      }
      p[j] = ((p[j] * sx + 1) * w) / 2;
      p[j + 1] = ((1 - p[j + 1] * sy) * h) / 2;
    }
    for (let tri = 0; tri < indices.length; tri += 3) {
      const a = indices[tri] * 9,
        b = indices[tri + 1] * 9,
        c = indices[tri + 2] * 9;
      const left = Math.max(0, Math.floor(Math.min(p[a], p[b], p[c]))),
        right = Math.min(w - 1, Math.ceil(Math.max(p[a], p[b], p[c])));
      const top = Math.max(0, Math.floor(Math.min(p[a + 1], p[b + 1], p[c + 1]))),
        bottom = Math.min(h - 1, Math.ceil(Math.max(p[a + 1], p[b + 1], p[c + 1])));
      if (left > right || top > bottom) continue;
      const bx = p[b] - p[a],
        by = p[b + 1] - p[a + 1],
        cx = p[c] - p[a],
        cy = p[c + 1] - p[a + 1];
      const area = bx * cy - by * cx;
      if (Math.abs(area) < 0.001) continue;
      const colorOffset = area < 0 ? 3 : 6;
      const ca = a + colorOffset,
        cb = b + colorOffset,
        cc = c + colorOffset;
      const zb = p[b + 2] - p[a + 2],
        zc = p[c + 2] - p[a + 2];
      for (let y = top; y <= bottom; y++) {
        const dy = y + 0.5 - p[a + 1],
          dx = left + 0.5 - p[a];
        let u = (dx * cy - dy * cx) / area,
          t = (bx * dy - by * dx) / area;
        for (let x = left; x <= right; x++, u += cy / area, t -= by / area) {
          if (u < 0 || t < 0 || u + t > 1) continue;
          const pixel = y * w + x,
            z = p[a + 2] + zb * u + zc * t;
          if (z <= depth[pixel]) continue;
          depth[pixel] = z;
          const idx = pixel * 4;
          for (let k = 0; k < 3; k++)
            image.data[idx + k] = (1 - u - t) * p[ca + k] + u * p[cb + k] + t * p[cc + k];
          image.data[idx + 3] = 255;
        }
      }
    }
    context.putImageData(image, 0, 0);
  }
  return {
    setModel,
    draw,
    dispose() {
      model = null;
      projected = null;
      depth = null;
      image = null;
    },
  };
}
