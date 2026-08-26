/**
 * Minimal eBay client for sold-listing ingestion.
 *
 * Sold prices come from the Marketplace Insights API (`item_sales/search`),
 * which requires the `buy.marketplace.insights` scope. When that scope has not
 * been granted yet the client falls back to the Browse API, whose active
 * listings are asking prices rather than clearing prices — those rows are
 * tagged with source `ebay-browse` so the analytics layer can weight them down.
 */
import { loadEnv } from './env';
import { log, retry } from './log';

const HOSTS = {
  production: { api: 'https://api.ebay.com', auth: 'https://api.ebay.com/identity/v1/oauth2/token' },
  sandbox: { api: 'https://api.sandbox.ebay.com', auth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token' },
} as const;

export type EbaySource = 'ebay-insights' | 'ebay-browse';

export interface EbaySale {
  price: number;
  currency: string;
  soldDate: string; // ISO date (YYYY-MM-DD)
  title: string;
  itemId: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export class EbayClient {
  private token: string | null = null;
  private tokenExpiry = 0;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly hosts: (typeof HOSTS)[keyof typeof HOSTS];
  private readonly marketplaceId: string;

  constructor() {
    loadEnv();
    this.clientId = process.env.EBAY_CLIENT_ID ?? '';
    this.clientSecret = process.env.EBAY_CLIENT_SECRET ?? '';
    this.hosts = process.env.EBAY_ENV === 'production' ? HOSTS.production : HOSTS.sandbox;
    this.marketplaceId = process.env.EBAY_MARKETPLACE_ID ?? 'EBAY_US';
  }

  get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    if (!this.configured) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set');

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: [
        'https://api.ebay.com/oauth/api_scope',
        'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights',
      ].join(' '),
    });

    const token = await retry(async () => {
      const response = await fetch(this.hosts.auth, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!response.ok) {
        throw new Error(`eBay token request failed: ${response.status} ${await response.text()}`);
      }
      return (await response.json()) as TokenResponse;
    }, { label: 'ebay-oauth' });

    this.token = token.access_token;
    this.tokenExpiry = Date.now() + (token.expires_in - 60) * 1000;
    return this.token;
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.accessToken();
    return retry(async () => {
      const response = await fetch(`${this.hosts.api}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
        },
      });
      if (response.status === 429) throw new Error('eBay rate limit hit');
      if (!response.ok) {
        const detail = await response.text();
        const error = new Error(`eBay ${path} -> ${response.status} ${detail.slice(0, 200)}`);
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }
      return (await response.json()) as T;
    }, { label: `ebay ${path}` });
  }

  /** Sold listings for a query over the trailing `days` window. */
  async soldListings(query: string, options: { days?: number; limit?: number } = {}): Promise<{
    sales: EbaySale[];
    source: EbaySource;
  }> {
    const days = options.days ?? 30;
    const limit = options.limit ?? 100;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const filter = encodeURIComponent(`lastSoldDate:[${since}..]`);
    const path =
      `/buy/marketplace_insights/v1_beta/item_sales/search?q=${encodeURIComponent(query)}` +
      `&filter=${filter}&limit=${limit}`;

    try {
      const data = await this.request<{
        itemSales?: Array<{
          itemId: string;
          title: string;
          lastSoldDate?: string;
          lastSoldPrice?: { value: string; currency: string };
        }>;
      }>(path);

      const sales = (data.itemSales ?? []).flatMap((item) => {
        const price = Number(item.lastSoldPrice?.value);
        if (!Number.isFinite(price) || !item.lastSoldDate) return [];
        return [{
          price,
          currency: item.lastSoldPrice?.currency ?? 'USD',
          soldDate: item.lastSoldDate.slice(0, 10),
          title: item.title,
          itemId: item.itemId,
        }];
      });
      return { sales, source: 'ebay-insights' };
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status !== 403 && status !== 401 && status !== 404) throw error;
      log.warn('marketplace insights unavailable, falling back to Browse active listings');
      return { sales: await this.browseListings(query, limit), source: 'ebay-browse' };
    }
  }

  private async browseListings(query: string, limit: number): Promise<EbaySale[]> {
    const path = `/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const data = await this.request<{
      itemSummaries?: Array<{ itemId: string; title: string; price?: { value: string; currency: string } }>;
    }>(path);
    const today = new Date().toISOString().slice(0, 10);
    return (data.itemSummaries ?? []).flatMap((item) => {
      const price = Number(item.price?.value);
      if (!Number.isFinite(price)) return [];
      return [{
        price,
        currency: item.price?.currency ?? 'USD',
        soldDate: today,
        title: item.title,
        itemId: item.itemId,
      }];
    });
  }
}

/** Drops obvious non-single-card noise (lots, proxies, damaged, empty packs). */
const NOISE = /\b(lot|bundle|proxy|custom|repack|jumbo|sealed box|booster box|empty|damaged|reprint|orica)\b/i;

export function isLikelySingleCard(title: string): boolean {
  return !NOISE.test(title);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Removes outliers beyond 1.5 IQR so a single mispriced sale cannot skew a day. */
export function rejectOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  return sorted.filter((value) => value >= q1 - 1.5 * iqr && value <= q3 + 1.5 * iqr);
}
