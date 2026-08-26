/**
 * tcgapi.dev client — TCGplayer catalogue search with current market, low and
 * median prices. Used for sealed products, where its coverage (booster boxes,
 * ETBs, bundles, cases across every set) is far deeper than JustTCG's.
 *
 * The free tier allows 100 requests/day and returns 50 results per page.
 */
import { fetchJson } from './log';

const BASE_URL = 'https://api.tcgapi.dev/v1';
const MIN_REQUEST_INTERVAL_MS = 400;

export interface TcgApiProduct {
  id: number;
  name: string;
  clean_name: string;
  product_type: string;
  game_slug: string;
  set_name: string;
  market_price: number | null;
  low_price: number | null;
  median_price: number | null;
  total_listings: number | null;
  price_updated_at: string | null;
  image_url: string | null;
}

interface TcgApiMeta {
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

interface TcgApiRateLimit {
  daily_limit: number;
  daily_remaining: number;
}

interface TcgApiResponse<T> {
  data: T[];
  meta?: TcgApiMeta;
  rate_limit?: TcgApiRateLimit;
}

export class TcgApiClient {
  private lastRequestAt = 0;
  private requestsMade = 0;
  private rateLimit: TcgApiRateLimit | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly budget: number,
  ) {}

  get used(): number {
    return this.requestsMade;
  }

  get remaining(): number {
    const providerRemaining = this.rateLimit?.daily_remaining ?? Number.POSITIVE_INFINITY;
    return Math.min(this.budget - this.requestsMade, providerRemaining);
  }

  get quotaSummary(): string {
    if (!this.rateLimit) return `${this.requestsMade} requests`;
    return `${this.requestsMade} requests · provider daily remaining ${this.rateLimit.daily_remaining}/${this.rateLimit.daily_limit}`;
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number>,
  ): Promise<TcgApiResponse<T>> {
    if (this.remaining <= 0) throw new Error('tcgapi.dev request budget exhausted');

    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));

    this.lastRequestAt = Date.now();
    this.requestsMade += 1;
    const response = await fetchJson<TcgApiResponse<T>>(`${BASE_URL}${path}?${query.toString()}`, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (response.rate_limit) this.rateLimit = response.rate_limit;
    return response;
  }

  /** Paginated catalogue search; `q` matches product and card names. */
  async search(
    q: string,
    page = 1,
    game = 'pokemon',
  ): Promise<{ products: TcgApiProduct[]; hasMore: boolean; total: number }> {
    const response = await this.request<TcgApiProduct>('/search', { q, game, page });
    return {
      products: response.data,
      hasMore: response.meta?.has_more ?? false,
      total: response.meta?.total ?? response.data.length,
    };
  }
}
