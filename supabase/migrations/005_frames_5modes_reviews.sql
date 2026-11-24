-- Additive migration for 5 Eyewear Frame Modes, Dual Studio/Try-On/Clip-On Assets & Customer Reviews

alter table public.products
  add column if not exists frame_type text default 'prescription',
  add column if not exists sub_category text default 'optical',
  add column if not exists image_path text,
  add column if not exists front_catalog_path text,
  add column if not exists side_image_path text,
  add column if not exists clip_on_image_path text,
  add column if not exists clip_on_front_catalog_path text,
  add column if not exists clip_on_side_image_path text,
  add column if not exists aspect_ratio numeric default 2.6,
  add column if not exists frame_hex_color text default '#1e293b',
  add column if not exists frame_opacity numeric default 1.0;

create table if not exists public.frame_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  author_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_frame_reviews_product_id on public.frame_reviews(product_id);
create index if not exists idx_frame_reviews_shop_id on public.frame_reviews(shop_id);

alter table public.frame_reviews enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'frame_reviews' and policyname = 'Public read frame reviews'
  ) then
    create policy "Public read frame reviews"
      on public.frame_reviews for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'frame_reviews' and policyname = 'Public insert frame reviews'
  ) then
    create policy "Public insert frame reviews"
      on public.frame_reviews for insert
      with check (rating >= 1 and rating <= 5 and char_length(trim(author_name)) > 0 and char_length(trim(comment)) > 0);
  end if;
end $$;
