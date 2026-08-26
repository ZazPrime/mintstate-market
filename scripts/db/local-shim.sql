-- Minimal stand-ins for the Supabase-managed `auth` schema so migrations can be
-- applied and validated against a plain PostgreSQL instance.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
