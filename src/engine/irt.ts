/** Rasch (1PL) item response model with an EAP ability estimate. */

export interface ScoredResponse {
  difficulty: number;
  correct: boolean;
}

export interface AbilityEstimate {
  theta: number;
  /** Posterior standard deviation, used as the standard error of theta. */
  se: number;
}

const GRID_MIN = -5;
const GRID_MAX = 5;
const GRID_STEP = 0.02;
const GRID: number[] = [];
for (let t = GRID_MIN; t <= GRID_MAX + 1e-9; t += GRID_STEP) GRID.push(t);

export function probabilityCorrect(theta: number, difficulty: number): number {
  return 1 / (1 + Math.exp(difficulty - theta));
}

/**
 * Expected-a-posteriori estimate of ability on a fixed grid with a normal prior N(0, priorSd^2).
 * Works for any response pattern, including all-correct and all-wrong (where maximum likelihood diverges).
 */
export function estimateAbility(responses: readonly ScoredResponse[], priorSd = 2): AbilityEstimate {
  const logPost = GRID.map((t) => {
    let lp = -(t * t) / (2 * priorSd * priorSd);
    for (const r of responses) {
      const p = probabilityCorrect(t, r.difficulty);
      lp += Math.log(r.correct ? p : 1 - p);
    }
    return lp;
  });
  const max = Math.max(...logPost);
  let sum = 0;
  let mean = 0;
  const weights = logPost.map((lp, i) => {
    const w = Math.exp(lp - max);
    sum += w;
    mean += w * GRID[i];
    return w;
  });
  mean /= sum;
  let variance = 0;
  weights.forEach((w, i) => {
    variance += w * (GRID[i] - mean) ** 2;
  });
  variance /= sum;
  return { theta: mean, se: Math.sqrt(variance) };
}
