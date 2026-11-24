-- Safe additive migration for OptiVerse Stage 1 (2D Try-On & Product Upgrade)
-- Adds required columns to public.products without deleting or overwriting existing records.

alter table public.products
  add column if not exists tryon_mode text not null default '2d',
  add column if not exists processed_image text,
  add column if not exists additional_images jsonb not null default '[]'::jsonb,
  add column if not exists model_3d_url text,
  add column if not exists model_calibration jsonb not null default '{}'::jsonb,
  add column if not exists frame_colors jsonb not null default '[]'::jsonb,
  add column if not exists available_sizes jsonb not null default '["Small","Medium","Large"]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_tryon_mode_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_tryon_mode_check check (tryon_mode in ('2d', '3d'));
  end if;
end $$;

-- Safe non-destructive backfill for existing rows
update public.products
set model_3d_url = glb_url
where model_3d_url is null and glb_url is not null;

update public.products
set frame_colors = jsonb_build_array(frame_color)
where coalesce(jsonb_array_length(frame_colors), 0) = 0
  and frame_color is not null;

update public.products p
set processed_image = sub.image_url
from (
  select distinct on (product_id) product_id, image_url
  from public.product_images
  order by product_id, abs(angle_yaw) asc, sort_order asc
) sub
where p.id = sub.product_id
  and p.processed_image is null;
