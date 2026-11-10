// A regular grid laid over an instrument's top or back.
//   x runs across the strings (0 on the centre line), y along the body from
//   the neck end. Node (i, j) has index j * nx + i.
//   type: 0 outside the plate (held still), 1 plate, 2 hole (no material)

const PAD = 2; // rings of outside nodes around the bounding box

export function makeGrid({ width, length, h, inside }) {
  const nx = Math.round(width / h) + 1 + 2 * PAD;
  const ny = Math.round(length / h) + 1 + 2 * PAD;
  const x = (i) => (i - (nx - 1) / 2) * h;
  const y = (j) => (j - PAD) * h;
  const type = new Uint8Array(nx * ny), dof = new Int32Array(nx * ny).fill(-1);
  let n = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const t = inside(x(i), y(j)) | 0;
    type[j * nx + i] = t;
    if (t === 1) dof[j * nx + i] = n++;
  }
  return { nx, ny, h, type, dof, n, x, y, width, length };
}

// nearest node to a point (clamped to the grid)
export function nodeAt(grid, px, py) {
  const i = Math.max(0, Math.min(grid.nx - 1, Math.round(px / grid.h + (grid.nx - 1) / 2)));
  const j = Math.max(0, Math.min(grid.ny - 1, Math.round(py / grid.h + PAD)));
  return { i, j, index: j * grid.nx + i };
}
