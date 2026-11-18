// 모든 조형은 같은 좌표계로 빚는다. 앞은 +Z, 정수 관절 번호는 꼭짓점 버퍼에 함께 담는다.
export const TAU = 2 * Math.PI;
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const mul = (v, s) => v.map((x) => x * s);
export const mix = (a, b, f) => a.map((x, i) => x + (b[i] - x) * f);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (v) => mul(v, 1 / (Math.hypot(...v) || 1));
export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const dye = (color, tint, ratio) => mix(color, rgb(tint), ratio);
export const BONE = {
  floor: 0,
  chest: 1,
  head: 2,
  leftArm: 3,
  rightArm: 4,
  leftElbow: 5,
  rightElbow: 6,
  leftHip: 7,
  rightHip: 8,
  leftKnee: 9,
  rightKnee: 10,
  cape: 11,
};

export class Sculpture {
  constructor() {
    this.vertices = [];
    this.indices = [];
    this.bone = BONE.chest;
    this.pivots = [];
  }

  // 격자를 공유해 둥근 볼과 옷감은 매끈하게, 각진 장신구는 면 단위로 빛을 받게 한다.
  surface(columns, rows, point, color, gloss = 0, closed = true, faceted = false) {
    const data = [];
    const normals = [];
    const triangles = [];
    const stride = closed ? columns : columns + 1;
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x < stride; x++) {
        data.push(point(x / columns, y / rows));
        normals.push([0, 0, 0]);
      }
    }
    const vertex = (i, n) => {
      const point = data[i];
      const tint =
        typeof color === 'function' ? color(point, (i % stride) / columns, Math.floor(i / stride) / rows) : color;
      this.vertices.push(...point, ...n, ...tint, gloss, this.bone);
    };
    const base = this.vertices.length / 11;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const i = y * stride + x,
          j = y * stride + ((x + 1) % stride);
        for (const ids of [
          [i, j, j + stride],
          [i, j + stride, i + stride],
        ]) {
          const [a, b, c] = ids.map((k) => data[k]);
          const n = cross(sub(b, a), sub(c, a));
          if (Math.hypot(...n) < 1e-10) continue;
          if (faceted) {
            const normal = unit(n);
            ids.forEach((k) => {
              this.indices.push(this.vertices.length / 11);
              vertex(k, normal);
            });
          } else {
            ids.forEach((k) => {
              normals[k] = add(normals[k], n);
            });
            triangles.push(...ids);
          }
        }
      }
    }
    if (!faceted) {
      data.forEach((_, i) => vertex(i, unit(normals[i])));
      this.indices.push(...triangles.map((i) => base + i));
    }
  }

  rings(x, z, rings, color, gloss = 0, sides = 28, faceted = false) {
    this.surface(
      sides,
      rings.length - 1,
      (u, v) => {
        const [y, rx, rz, dz = 0, dx = 0] = rings[Math.round(v * (rings.length - 1))];
        return [x + dx + rx * Math.sin(u * TAU), y, z + dz + rz * Math.cos(u * TAU)];
      },
      color,
      gloss,
      true,
      faceted,
    );
  }

  ball(center, size, color, gloss = 0, sides = 16, rows = 10) {
    this.surface(
      sides,
      rows,
      (u, v) => {
        const lat = (v - 0.5) * Math.PI,
          t = u * TAU;
        return add(center, [
          size[0] * Math.cos(lat) * Math.sin(t),
          size[1] * Math.sin(lat),
          size[2] * Math.cos(lat) * Math.cos(t),
        ]);
      },
      color,
      gloss,
    );
  }

  // 타원 단면이 꺾이는 선을 따라 이어져 머리 다발, 망토 주름, 가죽끈까지 같은 방식으로 빚는다.
  sweep(points, widths, depths, color, gloss = 0, sides = 10, front = [0, 0, 1], faceted = false) {
    const frames = points.map((p, i) => {
      const axis = unit(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]));
      const guide = Math.abs(axis.reduce((s, x, k) => s + x * front[k], 0)) > 0.98 ? [1, 0, 0] : front;
      const right = unit(cross(axis, guide));
      return [right, unit(cross(right, axis))];
    });
    this.surface(
      sides,
      points.length - 1,
      (u, v) => {
        const i = Math.round(v * (points.length - 1)),
          [right, outward] = frames[i];
        return add(
          points[i],
          add(mul(right, widths[i] * Math.sin(u * TAU)), mul(outward, depths[i] * Math.cos(u * TAU))),
        );
      },
      color,
      gloss,
      true,
      faceted,
    );
  }

  rod(a, b, radius, color, gloss = 0, endRadius = radius, sides = 12) {
    this.sweep([a, a, b, b], [0, radius, endRadius, 0], [0, radius, endRadius, 0], color, gloss, sides);
  }

  line(points, width, color, gloss = 0) {
    const sizes = points.map((_, i) => (i === 0 || i === points.length - 1 ? width * 0.35 : width));
    this.sweep(points, sizes, sizes, color, gloss, 8);
  }

  // 앞뒤가 모두 닫힌 얕은 부조. 중앙 능선이 방패와 문장의 하이라이트를 만든다.
  relief(outline, center, depth, color, gloss = 0) {
    const back = outline.map((p) => add(p, [0, 0, -depth]));
    const face = (a, b, c) => {
      const n = unit(cross(sub(b, a), sub(c, a)));
      for (const p of [a, b, c]) {
        this.indices.push(this.vertices.length / 11);
        this.vertices.push(...p, ...n, ...color, gloss, this.bone);
      }
    };
    const sign = outline.reduce((s, p, i) => {
      const q = outline[(i + 1) % outline.length];
      return s + p[0] * q[1] - p[1] * q[0];
    }, 0);
    if (sign < 0) {
      outline = [...outline].reverse();
      back.reverse();
    }
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      face(outline[i], outline[j], center);
      face(back[j], back[i], add(center, [0, 0, -depth * 2]));
      face(back[i], back[j], outline[j]);
      face(back[i], outline[j], outline[i]);
    }
  }
}
