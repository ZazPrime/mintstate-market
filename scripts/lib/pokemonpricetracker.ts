/**
 * PokemonPriceTracker v2 client — the single pricing provider for singles
 * (TCGplayer market history plus eBay graded sold comps) and sealed products.
 *
 * Quota is measured in "API calls consumed" rather than HTTP requests: a page
 * of cards costs 1 call per card, or 3 with history + eBay data. The response
 * metadata reports the exact spend, which is what the budget tracks.
 */
import { NonRetryableError, log, retry } from './log';

const BASE_URL = 'https://www.pokemonpricetracker.com/api/v2';
const SET_PAGE_SIZE = 200;
/** Card and product pages cost one call per item, so a page must fit inside the
 *  60-call minute window. */
const MAX_PAGE_SIZE = 50;
/** Provider ceiling: 60 API calls per rolling minute, 20,000 per day. */
const CALLS_PER_MINUTE = 60;

export interface PptSet {
  id: string;
  tcgPlayerId: string | null;
  /** TCGplayer group id — the only set identifier both /cards and
   *  /sealed-products accept. */
  tcgPlayerNumericId: number | null;
  name: string;
  series: string | null;
  releaseDate: string | null;
}

export interface PptConditionPoint {
  date: string;
  market: number | null;
  volume: number | null;
}

/** eBay sold comps keyed by grade ("psa10", "psa9", ...) then by ISO date. */
export type PptGradedHistory = Record<
  string,
  Record<string, { average: number | null; count: number | null }>
>;

export interface PptCard {
  id: string;
  tcgPlayerId: string;
  setId: number | string;
  setName: string;
  name: string;
  cardNumber: string | null;
  rarity: string | null;
  prices?: {
    market: number | null;
    low: number | null;
    listings: number | null;
    sellers: number | null;
  };
  priceHistory?: {
    conditions?: Record<string, { history?: PptConditionPoint[] }>;
  };
  ebay?: { priceHistory?: PptGradedHistory };
}

export interface PptSealedProduct {
  id: string;
  tcgPlayerId: string;
  name: string;
  setId: string;
  setName: string;
  unopenedPrice: number | null;
  imageCdnUrl400: string | null;
  priceHistory?: Array<{ date: string; unopenedPrice: number | null }>;
}

interface PptMetadata {
  total: number;
  count: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  apiCallsConsumed?: { total: number };
}

interface PptResponse<T> {
  data: T[];
  metadata?: PptMetadata;
}

export interface PptPage<T> {
  items: T[];
  hasMore: boolean;
  total: number;
}

export class PokemonPriceTrackerClient {
  private callsConsumed = 0;
  private minuteRemaining = CALLS_PER_MINUTE;
  private minuteResetAt = 0;

  constructor(
    private readonly apiKey: string,
    private readonly budget: number,
  ) {}

  get used(): number {
    return this.callsConsumed;
  }

  get remaining(): number {
    return this.budget - this.callsConsumed;
  }

  /** Waits out the rolling minute window when the next call would exceed it. */
  private async throttle(expectedCost: number): Promise<void> {
    if (Date.now() >= this.minuteResetAt) {
      this.minuteRemaining = CALLS_PER_MINUTE;
      return;
    }
    if (this.minuteRemaining >= expectedCost) return;
    const waitMs = Math.max(0, this.minuteResetAt - Date.now()) + 500;
    log.info(`rate limit: waiting ${Math.ceil(waitMs / 1000)}s for the minute window to reset`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.minuteRemaining = CALLS_PER_MINUTE;
  }

  private trackLimits(headers: Headers): void {
    const remaining = Number(headers.get('x-ratelimit-minute-remaining'));
    const resetAt = Number(headers.get('x-ratelimit-minute-reset'));
    if (Number.isFinite(remaining)) this.minuteRemaining = remaining;
    if (Number.isFinite(resetAt) && resetAt > 0) this.minuteResetAt = resetAt * 1000;
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | boolean>,
    expectedCost: number,
  ): Promise<PptResponse<T>> {
    if (this.remaining <= 0) throw new Error('PokemonPriceTracker call budget exhausted');

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    const url = `${BASE_URL}${path}?${query.toString()}`;

    const payload = await retry(async () => {
      await this.throttle(expectedCost);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(60_000),
      });
      this.trackLimits(response.headers);

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 30;
        log.warn(`rate limited, sleeping ${retryAfter}s`);
        await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
        this.minuteRemaining = CALLS_PER_MINUTE;
        throw new Error(`GET ${path} -> 429 rate limited`);
      }
      if (!response.ok) {
        const message = `GET ${path} -> ${response.status} ${response.statusText}`;
        if (response.status >= 400 && response.status < 500) {
          throw new NonRetryableError(message, response.status);
        }
        throw new Error(message);
      }
      const body = (await response.json()) as { data: T | T[]; metadata?: PptMetadata };
      // Single-entity lookups return `data` as an object rather than an array.
      return { data: Array.isArray(body.data) ? body.data : [body.data], metadata: body.metadata };
    }, { label: path, attempts: 5 });

    this.callsConsumed += payload.metadata?.apiCallsConsumed?.total ?? expectedCost;
    return payload;
  }

  async listSets(offset = 0): Promise<PptPage<PptSet>> {
    const response = await this.request<PptSet>('/sets', { limit: SET_PAGE_SIZE, offset }, 1);
    return {
      items: response.data,
      hasMore: response.metadata?.hasMore ?? false,
      total: response.metadata?.total ?? response.data.length,
    };
  }

  /**
   * Current market snapshot for a page of a set's singles. Costs 1 call per
   * card, which is what makes broad set coverage affordable.
   */
  async listSetCards(
    setId: string,
    offset: number,
    limit = MAX_PAGE_SIZE,
  ): Promise<PptPage<PptCard>> {
    const response = await this.request<PptCard>(
      '/cards',
      { setId, limit, offset, lightweight: true },
      limit,
    );
    return {
      items: response.data,
      hasMore: response.metadata?.hasMore ?? false,
      total: response.metadata?.total ?? response.data.length,
    };
  }

  /**
   * One card with `days` of TCGplayer history and eBay graded sold comps.
   * Costs 3 calls, so it is reserved for cards worth tracking over time.
   */
  async getEnrichedCard(tcgPlayerId: string, days: number): Promise<PptCard | null> {
    const response = await this.request<PptCard>(
      '/cards',
      { tcgPlayerId, limit: 1, includeBoth: true, days },
      3,
    );
    return response.data[0] ?? null;
  }

  async listSealedProducts(
    setId: string,
    offset: number,
    days: number,
    limit = MAX_PAGE_SIZE,
  ): Promise<PptPage<PptSealedProduct>> {
    const response = await this.request<PptSealedProduct>(
      '/sealed-products',
      { setId, limit, offset, includeHistory: true, days },
      limit,
    );
    return {
      items: response.data,
      hasMore: response.metadata?.hasMore ?? false,
      total: response.metadata?.total ?? response.data.length,
    };
  }
}

/** Near Mint TCGplayer series, falling back to the current market snapshot. */
export function rawSeries(card: PptCard): Array<{ date: string; price: number; volume: number }> {
  const points = card.priceHistory?.conditions?.['Near Mint']?.history ?? [];
  const series = points
    .filter((point): point is PptConditionPoint & { market: number } =>
      typeof point.market === 'number' && point.market > 0)
    .map((point) => ({
      date: point.date.slice(0, 10),
      price: point.market,
      volume: point.volume ?? 0,
    }));
  if (series.length > 0) return series;

  const market = card.prices?.market;
  if (typeof market !== 'number' || market <= 0) return [];
  return [{ date: new Date().toISOString().slice(0, 10), price: market, volume: 0 }];
}

/** Daily sold comps for one grade, e.g. gradedSeries(card, 'psa10'). */
export function gradedSeries(
  card: PptCard,
  gradeKey: string,
): Array<{ date: string; price: number; sales: number }> {
  const byDate = card.ebay?.priceHistory?.[gradeKey] ?? {};
  return Object.entries(byDate)
    .filter(([, point]) => typeof point.average === 'number' && point.average > 0)
    .map(([date, point]) => ({
      date: date.slice(0, 10),
      price: point.average as number,
      sales: point.count ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
