import { describe, it, expect } from "vitest";
import { invert, dampedLeastSquares } from "../src/ik-math";

describe("invert", () => {
  it("inverts a 2x2 matrix", () => {
    const inv = invert([
      [4, 7],
      [2, 6],
    ]);
    expect(inv[0]![0]!).toBeCloseTo(0.6, 6);
    expect(inv[0]![1]!).toBeCloseTo(-0.7, 6);
    expect(inv[1]![0]!).toBeCloseTo(-0.2, 6);
    expect(inv[1]![1]!).toBeCloseTo(0.4, 6);
  });
});

describe("dampedLeastSquares", () => {
  it("recovers dx for an identity Jacobian with tiny damping", () => {
    const dq = dampedLeastSquares([[1, 0], [0, 1]], [1, 2], 1e-3);
    expect(dq[0]!).toBeCloseTo(1, 2);
    expect(dq[1]!).toBeCloseTo(2, 2);
  });

  it("returns one dq per joint for a non-square Jacobian (2x3)", () => {
    const dq = dampedLeastSquares([[1, 0, 0], [0, 1, 0]], [1, 2], 1e-3);
    expect(dq.length).toBe(3);
    expect(dq[0]!).toBeCloseTo(1, 2);
    expect(dq[1]!).toBeCloseTo(2, 2);
    expect(dq[2]!).toBeCloseTo(0, 6); // null-space joint stays put
  });

  it("stays finite and near-zero at a singular (all-zero) Jacobian", () => {
    const dq = dampedLeastSquares([[0, 0], [0, 0]], [1, 1], 0.1);
    expect(Number.isFinite(dq[0]!)).toBe(true);
    expect(Math.abs(dq[0]!)).toBeLessThan(1);
  });
});
