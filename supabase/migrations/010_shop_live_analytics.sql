-- OptiVerse Live Store Analytics (Safe Aggregate Counters)
-- Stores lightweight daily aggregate metrics per shop with strict RLS.
-- Public storefront visitors increment aggregate counters only via SECURITY DEFINER RPC.

create table if not exists public.shop_daily_analytics (
  shop_id uuid not null references public.shops(id) on delete cascade,
  stat_date date not null default current_date,
  visits_count integer not null default 0 check (visits_count >= 0),
  tryons_count integer not null default 0 check (tryons_count >= 0),
  shares_count integer not null default 0 check (shares_count >= 0),
  frame_tryons jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (shop_id, stat_date)
);

alter table public.shop_daily_analytics enable row level security;

drop policy if exists "shop_daily_analytics_merchant_read" on public.shop_daily_analytics;
create policy "shop_daily_analytics_merchant_read"
  on public.shop_daily_analytics
  for select
  using (shop_id = public.my_shop_id() or public.is_admin());

create or replace function public.record_shop_analytics_event(
  p_shop_id uuid,
  p_event_type text,
  p_product_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_pid text := nullif(trim(coalesce(p_product_id, '')), '');
  v_cur_count integer;
begin
  if p_event_type not in ('visit', 'tryon', 'share') then
    raise exception 'Invalid analytics event type';
  end if;

  if not exists (select 1 from public.shops where id = p_shop_id) then
    return;
  end if;

  insert into public.shop_daily_analytics (shop_id, stat_date)
  values (p_shop_id, v_today)
  on conflict (shop_id, stat_date) do nothing;

  if p_event_type = 'visit' then
    update public.shop_daily_analytics
    set visits_count = visits_count + 1,
        updated_at = now()
    where shop_id = p_shop_id and stat_date = v_today;
  elsif p_event_type = 'share' then
    update public.shop_daily_analytics
    set shares_count = shares_count + 1,
        updated_at = now()
    where shop_id = p_shop_id and stat_date = v_today;
  elsif p_event_type = 'tryon' then
    if v_pid is not null and length(v_pid) <= 120 then
      select coalesce((frame_tryons ->> v_pid)::integer, 0)
      into v_cur_count
      from public.shop_daily_analytics
      where shop_id = p_shop_id and stat_date = v_today;

      update public.shop_daily_analytics
      set tryons_count = tryons_count + 1,
          frame_tryons = jsonb_set(
            coalesce(frame_tryons, '{}'::jsonb),
            array[v_pid],
            to_jsonb(coalesce(v_cur_count, 0) + 1),
            true
          ),
          updated_at = now()
      where shop_id = p_shop_id and stat_date = v_today;
    else
      update public.shop_daily_analytics
      set tryons_count = tryons_count + 1,
          updated_at = now()
      where shop_id = p_shop_id and stat_date = v_today;
    end if;
  end if;
end;
$$;

revoke all on function public.record_shop_analytics_event(uuid, text, text) from public;
grant execute on function public.record_shop_analytics_event(uuid, text, text) to anon, authenticated;
