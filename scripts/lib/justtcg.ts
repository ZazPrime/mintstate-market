/**
 * JustTCG client — real TCGplayer-derived market prices for singles and sealed
 * products, including a rolling daily price history per variant.
 *
 * The free tier allows 100 requests/day at 10 requests/minute, so every call
 * goes through a shared budget + throttle and the response quota metadata is
 * surfaced to the caller.
 */
import { fetchJson } from './log';

const BASE_URL = 'https://api.justtcg.com/v1';
const MIN_REQUEST_INTERVAL_MS = 6_500; // 10 requests/minute with headroom.

export interface JustTcgSet {
  id: string;
  name: string;
  game: string;
  cards_count: number;
  sealed_count: number;
  release_date: string | null;
}

export interface JustTcgPricePoint {
  /** Unix seconds. */
  t: number;
  p: number;
}

export interface JustTcgVariant {
  id: string;
  condition: string;
  printing: string;
  language: string;
  price: number | null;
  lastUpdated: number | null;
  priceHistory?: JustTcgPricePoint[];
  minPrice7d?: number | null;
  maxPrice7d?: number | null;
  avgPrice?: number | null;
}

export interface JustTcgCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  number: string | null;
  rarity: string | null;
  tcgplayerId: string | null;
  variants: JustTcgVariant[];
}

interface JustTcgMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface JustTcgQuota {
  apiDailyLimit: number;
  apiDailyRequestsUsed: number;
  apiDailyRequestsRemaining: number;
  apiRequestsRemaining: number;
}

interface JustTcgResponse<T> {
  data: T[];
  meta?: JustTcgMeta;
  _metadata?: JustTcgQuota;
}

export class JustTcgClient {
  private lastRequestAt = 0;
  private requestsMade = 0;
  private quota: JustTcgQuota | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly budget: number,
  ) {}

  get used(): number {
    return this.requestsMade;
  }

  get remaining(): number {
    const providerRemaining = this.quota?.apiDailyRequestsRemaining ?? Number.POSITIVE_INFINITY;
    return Math.min(this.budget - this.requestsMade, providerRemaining);
  }

  get quotaSummary(): string {
    if (!this.quota) return `${this.requestsMade} requests`;
    return `${this.requestsMade} requests · provider daily ${this.quota.apiDailyRequestsUsed}/${this.quota.apiDailyLimit}`;
  }

  private async request<T>(path: string, params: Record<string, string | number>): Promise<
    JustTcgResponse<T>
  > {
    if (this.remaining <= 0) throw new Error('JustTCG request budget exhausted');

    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));

    this.lastRequestAt = Date.now();
    this.requestsMade += 1;
    const response = await fetchJson<JustTcgResponse<T>>(`${BASE_URL}${path}?${query.toString()}`, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (response._metadata) this.quota = response._metadata;
    return response;
  }

  async listSets(game = 'pokemon'): Promise<JustTcgSet[]> {
    const response = await this.request<JustTcgSet>('/sets', { game });
    return response.data;
  }

  /** One page of a set's catalogue (singles and sealed share the endpoint). */
  async listSetCards(
    setId: string,
    offset: number,
    limit = 20,
    game = 'pokemon',
  ): Promise<{ cards: JustTcgCard[]; hasMore: boolean; total: number }> {
    const response = await this.request<JustTcgCard>('/cards', {
      game,
      set: setId,
      limit,
      offset,
    });
    return {
      cards: response.data,
      hasMore: response.meta?.hasMore ?? false,
      total: response.meta?.total ?? response.data.length,
    };
  }
}

/** Near-mint English print of a single, preferring the holofoil variant. */
export function pickSingleVariant(card: JustTcgCard): JustTcgVariant | null {
  const candidates = card.variants.filter(
    (variant) => variant.condition === 'Near Mint' && variant.price !== null,
  );
  if (candidates.length === 0) return null;
  const byPrinting = (printing: string) => candidates.find((v) => v.printing === printing);
  return byPrinting('Holofoil') ?? byPrinting('Normal') ?? candidates[0];
}

export function pickSealedVariant(card: JustTcgCard): JustTcgVariant | null {
  return card.variants.find((variant) => variant.condition === 'Sealed' && variant.price !== null)
    ?? null;
}

/** Collapses a variant's rolling history into one row per observed day. */
export function dailyPoints(variant: JustTcgVariant): Array<{ date: string; price: number }> {
  const byDate = new Map<string, number>();
  for (const point of variant.priceHistory ?? []) {
    if (!Number.isFinite(point.p) || point.p <= 0) continue;
    byDate.set(new Date(point.t * 1000).toISOString().slice(0, 10), point.p);
  }
  if (variant.price !== null && variant.lastUpdated) {
    byDate.set(new Date(variant.lastUpdated * 1000).toISOString().slice(0, 10), variant.price);
  }
  return Array.from(byDate.entries())
    .map(([date, price]) => ({ date, price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
