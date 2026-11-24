-- OptiVerse Migration 006: Physical optical millimeter sizing (lens□bridge-temple)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lens_width_mm INTEGER,
  ADD COLUMN IF NOT EXISTS bridge_width_mm INTEGER,
  ADD COLUMN IF NOT EXISTS temple_length_mm INTEGER,
  ADD COLUMN IF NOT EXISTS total_frame_width_mm INTEGER;
