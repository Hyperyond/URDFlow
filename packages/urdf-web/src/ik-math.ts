// Tiny dense linear-algebra helpers for differential IK. No dependencies.
type Mat = number[][];
type Vec = number[];

export function transpose(a: Mat): Mat {
  const rows = a.length;
  const cols = a[0]!.length;
  const t: Mat = Array.from({ length: cols }, () => new Array<number>(rows).fill(0));
  for (let i = 0; i < rows; i++) {
    const ai = a[i]!;
    for (let j = 0; j < cols; j++) t[j]![i] = ai[j]!;
  }
  return t;
}

export function matmul(a: Mat, b: Mat): Mat {
  const n = a.length;
  const inner = b.length;
  const m = b[0]!.length;
  const c: Mat = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i++) {
    const ai = a[i]!;
    const ci = c[i]!;
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let p = 0; p < inner; p++) s += ai[p]! * b[p]![j]!;
      ci[j] = s;
    }
  }
  return c;
}

export function matvec(a: Mat, v: Vec): Vec {
  return a.map((row) => {
    let s = 0;
    for (let j = 0; j < row.length; j++) s += row[j]! * v[j]!;
    return s;
  });
}

export function identity(n: number): Mat {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/** Invert a square matrix via Gauss-Jordan with partial pivoting. */
export function invert(a: Mat): Mat {
  const n = a.length;
  const id = identity(n);
  const M: Mat = a.map((row, i) => [...row, ...id[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const prow = M[col]!;
    const d = prow[col]!;
    for (let j = 0; j < 2 * n; j++) prow[j] = prow[j]! / d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const rrow = M[r]!;
      const f = rrow[col]!;
      for (let j = 0; j < 2 * n; j++) rrow[j] = rrow[j]! - f * prow[j]!;
    }
  }
  return M.map((row) => row.slice(n));
}

/**
 * Damped least squares: dq = Jᵀ (J Jᵀ + λ²I)⁻¹ dx.
 * Damping keeps the solution finite near singularities.
 */
export function dampedLeastSquares(J: Mat, dx: Vec, lambda: number): Vec {
  const JT = transpose(J);
  const JJT = matmul(J, JT);
  const m = JJT.length;
  const l2 = lambda * lambda;
  for (let i = 0; i < m; i++) {
    const row = JJT[i]!;
    row[i] = row[i]! + l2;
  }
  const inv = invert(JJT);
  return matvec(JT, matvec(inv, dx));
}

/** Damped pseudo-inverse J⁺ = Jᵀ(JJᵀ+λ²I)⁻¹ (n×m), for null-space projection. */
export function dampedPinv(J: Mat, lambda: number): Mat {
  const JT = transpose(J);
  const JJT = matmul(J, JT);
  const m = JJT.length;
  const l2 = lambda * lambda;
  for (let i = 0; i < m; i++) JJT[i]![i] = JJT[i]![i]! + l2;
  return matmul(JT, invert(JJT));
}
