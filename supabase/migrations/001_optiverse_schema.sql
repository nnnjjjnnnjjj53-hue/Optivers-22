-- OptiVerse Supabase Schema + RLS + Realtime + Storage
-- Execute in Supabase SQL Editor or via `supabase db push`

create extension if not exists "pgcrypto";

-- 1. Plans
create table if not exists public.plans (
  id integer primary key,
  name text not null,
  price integer not null default 600,
  is_active boolean not null default true,
  features jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0
);

-- 2. Shops
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  owner_name text,
  owner_email text,
  name text not null,
  city text not null default 'القاهرة',
  slug text not null unique,
  plan_name text not null default 'أساسية',
  price integer not null default 600,
  status text not null default 'trial' check (status in ('trial', 'active', 'soon', 'paused', 'expired')),
  days_left integer not null default 7,
  expires_label text not null default 'فترة تجريبية 7 أيام',
  trial_ends_at timestamptz default (now() + interval '7 days'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  logo text not null default '👓',
  color text not null default '#14B8A6',
  wa_phone text not null default '01001234567',
  created_at timestamptz not null default now()
);

-- 3. User Roles (NO public insert for admin!)
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('admin', 'merchant')),
  shop_id uuid references public.shops(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Helper RLS functions
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.my_shop_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select shop_id from public.user_roles
  where user_id = auth.uid() and role = 'merchant'
  limit 1;
$$;

-- 4. Products (soft delete supported via is_deleted + unique code per shop)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('aviator', 'wayfarer', 'rimless', 'round', 'cat')),
  cat text not null check (cat in ('sun', 'med', 'safe')),
  price integer not null check (price >= 0),
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  frame_color text not null default '#C9A24B',
  lens_color text not null default '#475569',
  shapes jsonb not null default '["oval","round"]'::jsonb,
  glb_url text,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, code)
);

-- 5. Product Multi-Angle Images & Lens Masks
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  angle_yaw integer not null default 0,
  label text not null default 'أمامية',
  image_url text not null,
  lens_mask_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 6. Lens Types, Brands, Extras
create table if not exists public.lens_types (
  id text not null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  name_ar text not null,
  name_en text default '',
  description text default '',
  icon text not null default 'eye',
  price integer not null default 0 check (price >= 0),
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  primary key (shop_id, id)
);

create table if not exists public.brands (
  id text not null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  name_ar text not null,
  name_en text default '',
  price integer not null default 0 check (price >= 0),
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  primary key (shop_id, id)
);

create table if not exists public.extras (
  id text not null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  name_ar text not null,
  price integer not null default 0 check (price >= 0),
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  primary key (shop_id, id)
);

-- 7. Inquiries & Orders
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  kind text not null default 'rx' check (kind in ('rx', 'order')),
  customer_name text not null,
  phone text not null,
  frame_name text not null,
  frame_type text not null default 'aviator',
  frame_color text not null default '#C9A24B',
  lens_color text not null default '#475569',
  lens_name text not null,
  brand_name text not null default '—',
  extras_txt text not null default 'بدون إضافات',
  frame_price integer not null default 0,
  lens_price integer not null default 0,
  add_price integer not null default 0,
  initial_price integer not null default 0,
  final_price integer,
  rx_image_url text,
  pd text default '',
  notes text default '',
  status text not null default 'new' check (status in ('new', 'confirmed', 'alt')),
  alt_from text,
  alt_to text,
  stage text not null default 'review' check (stage in ('review', 'making', 'ready', 'done')),
  payment_method text,
  created_at timestamptz not null default now()
);

-- 8. Payments & Audit Logs
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  shop_id uuid references public.shops(id) on delete set null,
  shop_name text not null,
  amount integer not null,
  method text not null check (method in ('InstaPay', 'Vodafone Cash')),
  reference_no text default '',
  status text not null default 'ok' check (status in ('ok', 'wait', 'late')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null,
  shop_id uuid references public.shops(id) on delete set null,
  action text not null,
  details text not null,
  created_at timestamptz not null default now()
);

-- Enable RLS on all tables
alter table public.plans enable row level security;
alter table public.shops enable row level security;
alter table public.user_roles enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.lens_types enable row level security;
alter table public.brands enable row level security;
alter table public.extras enable row level security;
alter table public.inquiries enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

-- Policies: plans
create policy "plans_public_read" on public.plans for select using (true);
create policy "plans_admin_all" on public.plans for all using (public.is_admin());

-- Policies: shops
create policy "shops_public_read" on public.shops for select using (true);
create policy "shops_merchant_self_insert" on public.shops for insert with check (owner_id = auth.uid());
create policy "shops_merchant_update" on public.shops for update using (id = public.my_shop_id());
create policy "shops_admin_all" on public.shops for all using (public.is_admin());

-- Policies: user_roles (Strict: users only read own role, only admin manages)
create policy "roles_read_own" on public.user_roles for select using (user_id = auth.uid() or public.is_admin());
create policy "roles_merchant_self_register" on public.user_roles for insert
  with check (user_id = auth.uid() and role = 'merchant');
create policy "roles_admin_all" on public.user_roles for all using (public.is_admin());

-- Policies: products & product_images
create policy "products_public_read" on public.products for select using (is_deleted = false);
create policy "products_merchant_all" on public.products for all using (shop_id = public.my_shop_id() or public.is_admin());

create policy "product_images_public_read" on public.product_images for select using (true);
create policy "product_images_merchant_all" on public.product_images for all using (shop_id = public.my_shop_id() or public.is_admin());

-- Policies: lens_types, brands, extras
create policy "lens_types_public_read" on public.lens_types for select using (true);
create policy "lens_types_merchant_all" on public.lens_types for all using (shop_id = public.my_shop_id() or public.is_admin());

create policy "brands_public_read" on public.brands for select using (true);
create policy "brands_merchant_all" on public.brands for all using (shop_id = public.my_shop_id() or public.is_admin());

create policy "extras_public_read" on public.extras for select using (true);
create policy "extras_merchant_all" on public.extras for all using (shop_id = public.my_shop_id() or public.is_admin());

-- Policies: inquiries (Customers insert without auth & track by ref_code; Merchants manage own shop)
create policy "inquiries_public_insert" on public.inquiries for insert with check (true);
create policy "inquiries_public_read_own_ref" on public.inquiries for select using (true);
create policy "inquiries_merchant_update" on public.inquiries for update using (shop_id = public.my_shop_id() or public.is_admin());
create policy "inquiries_admin_delete" on public.inquiries for delete using (public.is_admin());

-- Policies: payments & audit_logs
create policy "payments_admin_read" on public.payments for all using (public.is_admin());
create policy "payments_merchant_read" on public.payments for select using (shop_id = public.my_shop_id());

create policy "audit_logs_read" on public.audit_logs for select using (shop_id = public.my_shop_id() or public.is_admin());
create policy "audit_logs_insert" on public.audit_logs for insert with check (auth.uid() is not null);

-- Realtime publications
alter publication supabase_realtime add table public.shops;
alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.product_images;
alter publication supabase_realtime add table public.lens_types;
alter publication supabase_realtime add table public.brands;
alter publication supabase_realtime add table public.extras;
alter publication supabase_realtime add table public.inquiries;

-- Storage Buckets
insert into storage.buckets (id, name, public)
values ('optiverse-assets', 'optiverse-assets', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('optiverse-rx', 'optiverse-rx', false)
on conflict (id) do nothing;

create policy "assets_public_read" on storage.objects for select using (bucket_id = 'optiverse-assets');
create policy "assets_auth_write" on storage.objects for insert with check (bucket_id = 'optiverse-assets' and auth.uid() is not null);
create policy "rx_public_upload" on storage.objects for insert with check (bucket_id = 'optiverse-rx');
create policy "rx_auth_read" on storage.objects for select using (bucket_id = 'optiverse-rx' and auth.uid() is not null);
