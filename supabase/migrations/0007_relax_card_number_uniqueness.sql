-- A handful of sets legitimately reuse a printed number across variants
-- (e.g. cel25c #15, zsv10pt5 #60), so (set_id, number, language) is not unique.
-- The card id remains the primary key; keep the tuple indexed for lookups.

alter table public.cards drop constraint if exists cards_set_number_language_key;

create index if not exists cards_set_number_language_idx
  on public.cards (set_id, number, language);
