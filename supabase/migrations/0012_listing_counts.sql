-- Catalogue pricing feeds report active listing counts, not completed sales.
-- sale_count stays reserved for genuine sold-transaction sources (eBay), so
-- provider depth is recorded separately.

alter table public.price_history
  add column if not exists listing_count integer check (listing_count >= 0);

alter table public.sealed_price_history
  add column if not exists listing_count integer check (listing_count >= 0);
