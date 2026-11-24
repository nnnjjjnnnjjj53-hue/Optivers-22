-- Additive upgrade migration for single-photo try-on, original image preservation,
-- multi-color/size product variants, description, and publish visibility toggle.
-- Safe to run on existing databases without dropping or overwriting existing rows.

alter table public.products
  add column if not exists description text default '',
  add column if not exists available_colors jsonb not null default '[]'::jsonb,
  add column if not exists available_sizes jsonb not null default '["Small","Medium","Large"]'::jsonb,
  add column if not exists is_published boolean not null default true;

alter table public.product_images
  add column if not exists original_image_url text,
  add column if not exists kind text not null default 'front_tryon';

create index if not exists idx_products_shop_published
  on public.products (shop_id, is_deleted, is_published);
