// Pure, hash-generic shuffle/pick primitives shared by mobile's queueSlice
// (incremental refill, count = lookahead) and desktop's DesktopApp shuffle
// builders (full permutation, count = pool.length). Keeping the weighting
// math in one place means both platforms produce identical distributions.

// How many recent artists to consider when penalising same-artist picks (Smart mode)
export const ARTIST_LOOKBEHIND = 4
// Weight multiplier per additional occurrence of the same artist in the lookbehind window.
export const ARTIST_PENALTY = 0.25
// Favorited tracks are weighted this many times higher than a non-favorited track with
// the same play count — favorited status dominates, play count is a secondary tiebreaker.
export const FAVORITE_BONUS = 10

export function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Weighted sampling without replacement. Weights are recomputed before every pick via
// weightFn, and onPick is invoked immediately after each pick — this lets callers (e.g.
// Smart mode) fold picked items into weightFn's future output via closured state.
export function weightedSampleSequential(
  pool: string[],
  count: number,
  weightFn: (hash: string) => number,
  onPick?: (hash: string) => void,
): string[] {
  const remaining = [...pool]
  const picks: string[] = []
  const n = Math.min(count, remaining.length)
  for (let i = 0; i < n; i++) {
    const weights = remaining.map(weightFn)
    const total = weights.reduce((s, w) => s + w, 0)
    let r = Math.random() * total
    let idx = remaining.length - 1
    for (let j = 0; j < remaining.length; j++) {
      r -= weights[j]
      if (r <= 0) { idx = j; break }
    }
    const picked = remaining[idx]
    picks.push(picked)
    remaining.splice(idx, 1)
    onPick?.(picked)
  }
  return picks
}

// weight = 1 / (play_count + 1): unheard tracks get weight 1, heard once get 0.5, etc.
export function pickWeighted(candidates: string[], playCounts: Map<string, number>, count: number): string[] {
  return weightedSampleSequential(candidates, count, h => 1 / ((playCounts.get(h) ?? 0) + 1))
}

// Tier candidates by play count; pick from the lowest-play tier first. minTierSize is the
// threshold below which the tier is considered too small and we fall back to shuffling
// every candidate — defaults to count (mobile's incremental refill), but callers doing a
// one-shot full-list build (desktop) should pass their own fixed threshold since count
// there is the whole library, not a lookahead window.
export function pickDiscovery(
  candidates: string[],
  playCounts: Map<string, number>,
  count: number,
  minTierSize: number = count,
): string[] {
  const minPlays = Math.min(...candidates.map(h => playCounts.get(h) ?? 0))
  const tier = candidates.filter(h => (playCounts.get(h) ?? 0) === minPlays)
  const pool = tier.length >= Math.min(minTierSize, candidates.length) ? tier : candidates
  return fisherYates(pool).slice(0, count)
}

// Weighted selection without replacement that spreads artists across the queue.
// weight = ARTIST_PENALTY ^ (# times artist appears in lookbehind window)
export function pickSmart(
  candidates: string[],
  hashToArtist: Map<string, string>,
  seedRecentArtists: string[],
  count: number,
): string[] {
  const recentArtists = [...seedRecentArtists]
  const weightFn = (h: string) => {
    const freq = new Map<string, number>()
    for (const a of recentArtists.slice(-ARTIST_LOOKBEHIND)) freq.set(a, (freq.get(a) ?? 0) + 1)
    return Math.pow(ARTIST_PENALTY, freq.get(hashToArtist.get(h) ?? '') ?? 0)
  }
  return weightedSampleSequential(candidates, count, weightFn, picked => {
    recentArtists.push(hashToArtist.get(picked) ?? '')
  })
}

// Biased toward favorited + most-played tracks. Favorited status dominates (FAVORITE_BONUS);
// play count is log-scaled so heavy rotation doesn't drown out a lightly-played favorite.
export function pickFavorites(
  candidates: string[],
  playCounts: Map<string, number>,
  favorited: Set<string>,
  count: number,
): string[] {
  return weightedSampleSequential(candidates, count, h =>
    (favorited.has(h) ? FAVORITE_BONUS : 1) * (1 + Math.log1p(playCounts.get(h) ?? 0)),
  )
}
