-- Incremental migration for 7-day free trial, owner details, payment references, and merchant self-onboarding

alter table public.shops
  add column if not exists owner_name text,
  add column if not exists owner_email text,
  add column if not exists trial_ends_at timestamptz default (now() + interval '7 days');

alter table public.shops
  drop constraint if exists shops_status_check;

alter table public.shops
  add constraint shops_status_check check (status in ('trial', 'active', 'soon', 'paused', 'expired'));

alter table public.user_roles
  add column if not exists email text;

alter table public.payments
  add column if not exists reference_no text default '';

drop policy if exists "shops_merchant_self_insert" on public.shops;
create policy "shops_merchant_self_insert" on public.shops
  for insert with check (owner_id = auth.uid());
