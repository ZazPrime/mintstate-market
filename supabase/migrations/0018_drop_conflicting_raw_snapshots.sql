-- Snapshot rows (listing depth, no sales) and Near Mint history series measure
-- the same card differently and routinely disagree by an order of magnitude, so
-- a snapshot layered on top of a series reads as a one-day crash on the chart.
-- The series is the better record; the snapshots for those cards go away.
delete from public.price_history ph
where ph.grade = 'RAW'
  and ph.listing_count is not null
  and exists (
    select 1
    from public.price_history s
    where s.card_id = ph.card_id
      and s.grade = 'RAW'
      and s.listing_count is null
      and s.source = ph.source
  );
