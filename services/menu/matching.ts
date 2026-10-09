/**
 * Matching what a customer typed against the menu.
 *
 * Nobody types "Quarter Chicken" - they type "1/4 chicken", "quater chicken",
 * "lemon n herb" or just "coke". This normalises both sides and scores the
 * overlap, and it deliberately returns a ranked list rather than one answer, so
 * that an ambiguous "chips" becomes a question to the customer instead of a
 * guess.
 */

const SYNONYMS: Record<string, string> = {
  "1/4": "quarter",
  "¼": "quarter",
  "1/2": "half",
  "½": "half",
  "3/4": "three quarter",
  qtr: "quarter",
  and: "",
  n: "",
  with: "",
  the: "",
  a: "",
  please: "",
  pls: "",
  some: "",
  chickn: "chicken",
  chiken: "chicken",
  chikn: "chicken",
  quater: "quarter",
  quartre: "quarter",
  brger: "burger",
  buger: "burger",
  burito: "burrito",
  buritto: "burrito",
  burrtio: "burrito",
  burritto: "burrito",
  shawarma: "schwarma",
  shwarma: "schwarma",
  schwama: "schwarma",
  quesadila: "quesadilla",
  hott: "hot",
  mildd: "mild",
  cheeze: "cheese",
  chease: "cheese",
  slap: "chips",
  slaptjips: "chips",
  tjips: "chips",
  fries: "chips",
  cocacola: "coke",
  cocola: "coke",
  cola: "coke",
  creamsoda: "creme soda",
  lemonade: "sprite",
  lh: "lemon herb",
  peri: "peri peri",
  wings: "wings",
  strips: "strips",
};

/** Lowercase, expand shorthand and drop filler words. */
export function normaliseMenuText(raw: string): string {
  const base = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9¼½/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return base
    .split(" ")
    .map((token) => (token in SYNONYMS ? SYNONYMS[token] : token))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normaliseMenuText(text).split(" ").filter(Boolean);
}

/**
 * 0 means no relationship, 1 means the same thing. An exact match always beats
 * a containment match, which always beats a partial token overlap.
 */
export function scoreMatch(query: string, candidate: string): number {
  const q = normaliseMenuText(query);
  const c = normaliseMenuText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;

  const qt = tokens(query);
  const ct = tokens(candidate);
  if (!qt.length || !ct.length) return 0;

  // "coke" inside "coke 330ml": a complete candidate contained in the query (or
  // the other way round) is a strong signal, tempered by how much is left over.
  if (c.includes(q)) return 0.9 - 0.2 * (1 - q.length / c.length);
  if (q.includes(c)) return 0.85 - 0.2 * (1 - c.length / q.length);

  const matched = qt.filter((t) => ct.some((x) => x === t || (t.length > 3 && x.startsWith(t)) || (x.length > 3 && t.startsWith(x))));
  if (!matched.length) return 0;
  const coverage = matched.length / qt.length;
  const precision = matched.length / ct.length;
  return 0.7 * ((2 * coverage * precision) / (coverage + precision));
}

export interface Ranked<T> {
  value: T;
  score: number;
}

export function rankByName<T>(query: string, candidates: T[], nameOf: (c: T) => string, minScore = 0.35): Ranked<T>[] {
  return candidates
    .map((value) => ({ value, score: scoreMatch(query, nameOf(value)) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

/**
 * True when the leader is clearly ahead of the runner-up. Used to decide
 * between acting on a match and asking the customer which one they meant.
 */
export function isDecisive<T>(ranked: Ranked<T>[], margin = 0.15): boolean {
  if (!ranked.length) return false;
  if (ranked.length === 1) return ranked[0].score >= 0.5;
  return ranked[0].score >= 0.5 && ranked[0].score - ranked[1].score >= margin;
}

/**
 * True when two menu words are the same aside from a small typo.
 * "burito" matches "burrito". "hot" does not match "hat".
 */
export function tokensRoughlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const stem = (word: string) => (word.endsWith("s") && word.length > 4 ? word.slice(0, -1) : word);
  if (stem(a).length >= 4 && stem(a) === stem(b)) return true;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  if (shorter < 3 || longer > 24 || longer - shorter > 2) return false;
  const dist = damerau(a, b);
  if (shorter <= 4) return dist === 1 && (a.startsWith(b) || b.startsWith(a));
  return dist <= (shorter >= 8 ? 2 : 1);
}

function damerau(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}
