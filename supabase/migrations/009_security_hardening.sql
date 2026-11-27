-- OptiVerse Migration 009: Security Hardening, Public Shop View, Private Rx Bucket & Atomic AI Credits

-- 1a. Protect privileged columns on public.shops from client-side tampering
create or replace function public.guard_shops_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow service role (auth.uid() is null) and platform admins unconditionally
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Force safe 14-day trial defaults for merchant self-registration
    new.owner_id := auth.uid();
    new.status := 'trial';
    new.plan_tier := 'basic';
    new.plan_name := 'الأساسية';
    new.price := 599;
    new.days_left := 14;
    new.trial_ends_at := now() + interval '14 days';
    new.ai_credits_limit := 25;
    new.ai_credits_used := 0;
    new.topup_credits := 0;
    new.is_demo_admin_store := false;
    new.is_featured := false;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (
      new.plan_tier is distinct from old.plan_tier or
      new.plan_name is distinct from old.plan_name or
      new.status is distinct from old.status or
      new.trial_ends_at is distinct from old.trial_ends_at or
      new.ai_credits_limit is distinct from old.ai_credits_limit or
      new.ai_credits_used is distinct from old.ai_credits_used or
      new.topup_credits is distinct from old.topup_credits or
      new.is_demo_admin_store is distinct from old.is_demo_admin_store or
      new.is_featured is distinct from old.is_featured or
      new.owner_id is distinct from old.owner_id
    ) then
      raise exception 'Insufficient privileges to modify subscription, credits, or ownership fields';
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_shops_privileged_columns on public.shops;
create trigger trg_guard_shops_privileged_columns
  before insert or update on public.shops
  for each row
  execute function public.guard_shops_privileged_columns();

-- 1b. Remove broad public read on public.shops and expose safe columns via public.shops_public view
drop policy if exists "shops_public_read" on public.shops;
drop policy if exists "shops_merchant_read_own" on public.shops;
create policy "shops_merchant_read_own"
  on public.shops for select
  using (id = public.my_shop_id() or owner_id = auth.uid());

drop policy if exists "shops_merchant_update" on public.shops;
create policy "shops_merchant_update"
  on public.shops for update
  using (id = public.my_shop_id() or owner_id = auth.uid())
  with check (id = public.my_shop_id() or owner_id = auth.uid());

drop policy if exists "shops_admin_all" on public.shops;
create policy "shops_admin_all"
  on public.shops for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace view public.shops_public as
  select
    id,
    slug,
    name,
    city,
    governorate,
    address,
    color,
    logo,
    wa_phone,
    status,
    is_featured,
    enable_delivery_service
  from public.shops;

alter view public.shops_public set (security_invoker = false);
revoke all on public.shops_public from public;
grant select on public.shops_public to anon, authenticated;

-- 1c. Restrict inquiry reads to the owning merchant shop or admin (anyone can still submit)
drop policy if exists "inquiries_public_read_own_ref" on public.inquiries;
drop policy if exists "inquiries_merchant_admin_read" on public.inquiries;
create policy "inquiries_merchant_admin_read"
  on public.inquiries for select
  using (shop_id = public.my_shop_id() or public.is_admin());

drop policy if exists "inquiries_public_insert" on public.inquiries;
create policy "inquiries_public_insert"
  on public.inquiries for insert
  with check (true);

-- 1d. Harden optiverse-rx private bucket (5MB limit, allowed image/PDF types, shop-scoped path)
update storage.buckets
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'optiverse-rx';

drop policy if exists "rx_public_upload" on storage.objects;
create policy "rx_public_upload"
  on storage.objects for insert
  with check (
    bucket_id = 'optiverse-rx'
    and array_length(storage.foldername(name), 1) >= 1
    and exists (
      select 1
      from public.shops s
      where s.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "rx_auth_read" on storage.objects;
create policy "rx_auth_read"
  on storage.objects for select
  using (
    bucket_id = 'optiverse-rx'
    and (
      (storage.foldername(name))[1] = public.my_shop_id()::text
      or public.is_admin()
    )
  );

-- 1e. Restrict optiverse-assets uploads/edits/deletes to merchant's own shop folder or admin
drop policy if exists "assets_auth_write" on storage.objects;
create policy "assets_auth_write"
  on storage.objects for insert
  with check (
    bucket_id = 'optiverse-assets'
    and auth.uid() is not null
    and (
      (storage.foldername(name))[1] = public.my_shop_id()::text
      or public.is_admin()
    )
  );

drop policy if exists "assets_auth_update" on storage.objects;
create policy "assets_auth_update"
  on storage.objects for update
  using (
    bucket_id = 'optiverse-assets'
    and auth.uid() is not null
    and (
      (storage.foldername(name))[1] = public.my_shop_id()::text
      or public.is_admin()
    )
  );

drop policy if exists "assets_auth_delete" on storage.objects;
create policy "assets_auth_delete"
  on storage.objects for delete
  using (
    bucket_id = 'optiverse-assets'
    and auth.uid() is not null
    and (
      (storage.foldername(name))[1] = public.my_shop_id()::text
      or public.is_admin()
    )
  );

-- 1f. Atomic AI credit consumption RPC (service_role only)
create or replace function public.consume_ai_credits(p_shop_id uuid, p_amount int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return true;
  end if;

  update public.shops
  set ai_credits_used = ai_credits_used + p_amount
  where id = p_shop_id
    and (
      ai_credits_limit >= 99999
      or ai_credits_used + p_amount <= ai_credits_limit + topup_credits
    );

  return found;
end;
$$;

revoke all on function public.consume_ai_credits(uuid, int) from public, anon, authenticated;
grant execute on function public.consume_ai_credits(uuid, int) to service_role;
