// Token launch radar: one sealed DefiLlama snapshot in, one explainable board out.
// The value model uses only the snapshot's TVL, seven-day change and tokenless tenure.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export const MODEL = {
  base_multiple: 0.24,
  growth_weight: 0.55,
  growth_floor_pct: -45,
  growth_cap_pct: 75,
  maturity_floor: 0.70,
  maturity_range: 0.30,
  maturity_days: 1095,
  unknown_age_days: 365,
} as const;

export const MODEL_VERSION = 'signal-curve-02';
const EARLY_CANDIDATES = 180;
const LIVE_LIMIT = 24;
const DAY_MS = 86_400_000;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const VERSION_SUFFIX = /\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i;
const PRODUCT_WORDS = /\b(?:wrapped|staked|staking)\b/i;
const HOUSE_EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('snapshot.json is not valid JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('snapshot.json must be an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot has no valid as_of date');
  if (typeof o.source !== 'string' || typeof o.floor_usd !== 'number' || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('snapshot is missing required fields');
  const protocols: Protocol[] = o.protocols.map((value, i) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new Error(`protocol ${i} lacks slug, name or TVL`);
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  const watchlist = o.watchlist.filter((x): x is string => typeof x === 'string');
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd as number, protocols, watchlist };
}

export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function isEarlyCandidate(p: Protocol): boolean {
  return isPreToken(p)
    && !HOUSE_EXCLUDED_CATEGORIES.has(p.category ?? '')
    && !VERSION_SUFFIX.test(p.name)
    && !PRODUCT_WORDS.test(p.name)
    && !EXCHANGE_PREFIX.test(p.name);
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

export function explainValue(p: Protocol, snapshot: Snapshot) {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const growth = Math.min(MODEL.growth_cap_pct, Math.max(MODEL.growth_floor_pct, p.change_7d ?? 0));
  const growthMultiplier = Math.exp((growth / 100) * MODEL.growth_weight);
  const tenure = age ?? MODEL.unknown_age_days;
  const maturityMultiplier = MODEL.maturity_floor + MODEL.maturity_range * Math.min(tenure, MODEL.maturity_days) / MODEL.maturity_days;
  const implied = Math.max(1, Math.round(p.tvl_usd * MODEL.base_multiple * growthMultiplier * maturityMultiplier));
  return { implied, age, growth, growthMultiplier, maturityMultiplier };
}

function chainLabel(p: Protocol): string {
  if (!p.chains.length) return 'the protocol’s listed network';
  return p.chains.length === 1 ? p.chains[0]! : `${p.chains[0]} (or another network listed by the app)`;
}

function coreAction(p: Protocol): string {
  const category = (p.category ?? '').toLowerCase();
  const where = chainLabel(p);
  if (/lend|cdp|collateral/.test(category)) return `Read ${p.name}'s collateral and withdrawal rules, then make one small supply on ${where}; skip borrowing or leverage unless it is already part of your plan.`;
  if (/dex|liquidity|yield|farm/.test(category)) return `Use ${p.name}'s core pool on ${where} for one genuine spot swap or a small LP position; avoid repeat/self-trades and check exit liquidity first.`;
  if (/bridge|cross chain/.test(category)) return `If a real use case fits, test a small transfer through ${p.name} to ${where}, then complete a useful destination action; do not bridge repeatedly for points.`;
  if (/rwa|real world/.test(category)) return `Check issuer, jurisdiction and redemption terms for ${p.name}; if eligible, test one small supported mint or redeem on ${where}.`;
  if (/curator|allocator|vault/.test(category)) return `Compare ${p.name}'s vault policy, fees and withdrawal delay; if it fits, place a small deposit on ${where} and save the share receipt.`;
  if (/derivative|perpetual|basis/.test(category)) return `Study ${p.name}'s margin and liquidation rules; use a tiny, hedged position only if experienced, otherwise stay read-only and record funding data.`;
  if (/payment|transfer/.test(category)) return `Make one genuine, low-value payment or transfer with ${p.name} on ${where}, then verify settlement and the recipient.`;
  if (/staking|restak/.test(category)) return `Review lock-up and withdrawal terms before using ${p.name} on ${where}; keep any position small and avoid an irreversible lock.`;
  return `Use ${p.name}'s primary documented feature on ${where} with a small, reversible action; read fees and exit terms before signing.`;
}

export function farmSteps(p: Protocol, age: number | null): string[] {
  const years = age === null ? 'unknown tenure' : `${(age / 365).toFixed(1)} years tracked`;
  const steps = [
    `Open ${p.name}'s official documentation from a verified source and confirm the app, chain and any points terms. Cost: $0 to research. Time: 5 minutes.`,
    `Check the listed TVL (${money(p.tvl_usd)}) and ${years}; do not treat a token, points program or reward as guaranteed. Cost: $0. Time: 3 minutes.`,
    `${coreAction(p)} Cost: optional $25–$50 at risk plus the wallet-quoted network fee. Time: 10–15 minutes.`,
    `Return once on a different day for a real product action, such as a second swap, a repay or a useful rebalance; skip activity that adds no value. Cost: fee shown by the wallet. Time: 5–10 minutes weekly.`,
    `Save the wallet, date, transaction hash, amount and fee in a private farm log; compare the receipt with the app before adding more. Cost: $0. Time: 3 minutes.`,
    `Before leaving, review and revoke any approval you no longer need; check future eligibility only on the protocol's verified page. Cost: $0 to review; revocation gas varies. Time: 5 minutes.`,
  ];
  return steps;
}

export interface BoardRow extends Protocol {
  rank: number;
  token_status: 'no token recorded';
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow extends Protocol {}

export function buildRadar(snapshot: Snapshot) {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const selected = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p && isPreToken(p)) selected.set(slug, p);
  }
  // The watchlist is a floor; expand below it to catch emerging protocols across the snapshot.
  const early = snapshot.protocols
    .filter((p) => !selected.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isEarlyCandidate(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))
    .slice(0, EARLY_CANDIDATES);
  for (const p of early) selected.set(p.slug, p);

  const scored = [...selected.values()].map((p) => ({ p, ...explainValue(p, snapshot) }));
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));
  const board: BoardRow[] = scored.map((s, i) => ({
    ...s.p,
    rank: i + 1,
    token_status: 'no token recorded',
    age_days: s.age,
    implied_value_usd: s.implied,
    growth_multiplier: Math.round(s.growthMultiplier * 10000) / 10000,
    maturity_multiplier: Math.round(s.maturityMultiplier * 10000) / 10000,
    farm_steps: farmSteps(s.p, s.age),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_LIMIT);
  return { board, live };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set<string>();
  for (const row of board) {
    if (slugs.has(row.slug)) return `duplicate slug ${row.slug}`;
    slugs.add(row.slug);
    if (!snapshot.protocols.some((p) => p.slug === row.slug)) return `unknown slug ${row.slug}`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has invalid implied value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12 || row.farm_steps.some((s) => s.trim().length < 20 || s.trim().length > 600)) return `${row.slug} has invalid farm steps`;
  }
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length) return `missing watchlist slugs: ${missing.slice(0, 8).join(', ')}`;
  if (board.length < 100) return `board has only ${board.length} rows`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is not sequential`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `value rises at rank ${i + 1}`;
  }
  if (board.length > 1 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows have the same implied value';
  return null;
}

export function buildData(snapshot: Snapshot, board: BoardRow[], live: LiveRow[]) {
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: live.length,
    rows: board,
    live,
  };
}

export function money(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
