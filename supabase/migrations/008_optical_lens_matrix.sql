-- OptiVerse Migration 008: Optical Lens Matrix & Sponsorship Engine
-- Adds master feature flag enable_lenses_system, official_lens_brands JSONB on platform_settings,
-- and merchant_lens_configs JSONB on shops.

alter table public.platform_settings
  add column if not exists enable_lenses_system boolean not null default false,
  add column if not exists official_lens_brands jsonb not null default '[]'::jsonb;

alter table public.shops
  add column if not exists merchant_lens_configs jsonb not null default '[]'::jsonb;
