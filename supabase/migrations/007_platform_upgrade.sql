-- OptiVerse Migration 007: SaaS Control Center, 3-Tier Dynamic Plans, Global Feature Flags,
-- Shared Eyewear Catalog Cache, Merchant Onboarding, Delivery Toggle & Optical CRM

-- 1. Expand user_roles to include 'super_admin' alongside 'admin' and 'merchant'
alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  add constraint user_roles_role_check check (role in ('super_admin', 'admin', 'merchant'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('admin', 'super_admin')
  );
$$;

-- 2. Extend shops for mandatory onboarding, governorate, Maps, featured directory, delivery toggle, AI credits & CRM recall
alter table public.shops
  add column if not exists governorate text default 'القاهرة',
  add column if not exists address text default '',
  add column if not exists maps_url text default '',
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists enable_delivery_service boolean not null default false,
  add column if not exists delivery_fee integer not null default 60,
  add column if not exists delivery_areas text default '',
  add column if not exists is_featured boolean not null default false,
  add column if not exists recall_6m_enabled boolean not null default true,
  add column if not exists recall_12m_enabled boolean not null default true,
  add column if not exists ai_credits_limit integer not null default 25,
  add column if not exists ai_credits_used integer not null default 0,
  add column if not exists topup_credits integer not null default 0,
  add column if not exists is_demo_admin_store boolean not null default false,
  add column if not exists plan_tier text not null default 'basic',
  add column if not exists billing_cycle text not null default 'monthly';

-- 3. Extend plans with tier_key & active caps
alter table public.plans
  add column if not exists tier_key text default 'basic',
  add column if not exists max_products integer not null default 100,
  add column if not exists monthly_ai_credits integer not null default 120,
  add column if not exists turbo_upload_enabled boolean not null default false,
  add column if not exists camera_pd_ruler_enabled boolean not null default false,
  add column if not exists featured_boost_enabled boolean not null default false;

-- 4. Extend products for sale_price, model_code, lens branding & crystal acetate flag
alter table public.products
  add column if not exists sale_price integer,
  add column if not exists model_code text,
  add column if not exists keep_lens_branding boolean not null default false,
  add column if not exists is_crystal_frame boolean not null default false,
  add column if not exists phash text;

-- 5. Singleton Platform Settings table (3 Global Feature Flags ALL default FALSE)
create table if not exists public.platform_settings (
  id text primary key default 'default',
  enable_prescription_lenses boolean not null default false,
  allow_merchant_lens_branding_toggle boolean not null default false,
  enable_sponsored_suppliers boolean not null default false,
  plans jsonb not null default '[]'::jsonb,
  annual_discount_months integer not null default 2,
  trial_days integer not null default 14,
  trial_max_products integer not null default 20,
  trial_ai_credits integer not null default 25,
  topup_pack_frames integer not null default 50,
  topup_pack_price integer not null default 300,
  sponsored_suppliers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (
  id,
  enable_prescription_lenses,
  allow_merchant_lens_branding_toggle,
  enable_sponsored_suppliers
)
values ('default', false, false, false)
on conflict (id) do nothing;

-- 6. Global Shared Eyewear Catalog Cache (cost-saving cross-merchant deduplication)
create table if not exists public.shared_eyewear_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  model_code text,
  frame_color text,
  phash text,
  keep_lens_branding boolean not null default false,
  is_crystal_frame boolean not null default false,
  frame_type text default 'prescription',
  image_path text,
  front_catalog_path text,
  side_image_path text,
  lens_mask_url text,
  lens_width_mm integer,
  bridge_width_mm integer,
  temple_length_mm integer,
  total_frame_width_mm integer,
  hit_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_shared_eyewear_cache_model_color
  on public.shared_eyewear_cache(model_code, frame_color, keep_lens_branding);
create index if not exists idx_shared_eyewear_cache_phash
  on public.shared_eyewear_cache(phash, keep_lens_branding);

-- 7. Optical CRM Customers & 6-Month / 12-Month Recall Reminders
create table if not exists public.crm_customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_name text not null,
  phone text not null,
  product_id text,
  product_name text not null default 'نظارة',
  lens_summary text default '',
  pd text default '',
  order_date timestamptz not null default now(),
  recall_6m_sent_at timestamptz,
  recall_12m_sent_at timestamptz,
  notes text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_customers_shop_id on public.crm_customers(shop_id);

-- 8. RLS Policies
alter table public.platform_settings enable row level security;
alter table public.shared_eyewear_cache enable row level security;
alter table public.crm_customers enable row level security;

drop policy if exists "platform_settings_public_read" on public.platform_settings;
create policy "platform_settings_public_read"
  on public.platform_settings for select using (true);

drop policy if exists "platform_settings_admin_all" on public.platform_settings;
create policy "platform_settings_admin_all"
  on public.platform_settings for all using (public.is_admin());

drop policy if exists "shared_cache_auth_read" on public.shared_eyewear_cache;
create policy "shared_cache_auth_read"
  on public.shared_eyewear_cache for select using (auth.uid() is not null);

drop policy if exists "shared_cache_admin_all" on public.shared_eyewear_cache;
create policy "shared_cache_admin_all"
  on public.shared_eyewear_cache for all using (public.is_admin());

drop policy if exists "crm_customers_merchant_all" on public.crm_customers;
create policy "crm_customers_merchant_all"
  on public.crm_customers for all using (shop_id = public.my_shop_id() or public.is_admin());

drop policy if exists "crm_customers_public_insert" on public.crm_customers;
create policy "crm_customers_public_insert"
  on public.crm_customers for insert with check (char_length(trim(customer_name)) > 0 and char_length(trim(phone)) > 0);
