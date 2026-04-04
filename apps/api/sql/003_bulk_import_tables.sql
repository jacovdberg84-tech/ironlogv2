CREATE TABLE IF NOT EXISTS assets (
  id BIGSERIAL PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'active',
  location TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fuel_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_date DATE NOT NULL,
  machine_code TEXT NOT NULL,
  liters NUMERIC(12,2) NOT NULL,
  unit_cost NUMERIC(12,4) NOT NULL,
  total_cost NUMERIC(14,2) NOT NULL,
  source_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entry_date, machine_code)
);

CREATE TABLE IF NOT EXISTS store_items (
  id BIGSERIAL PRIMARY KEY,
  item_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT 'main-store',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment_hours (
  id BIGSERIAL PRIMARY KEY,
  entry_date DATE NOT NULL,
  machine_code TEXT NOT NULL,
  shift_name TEXT NOT NULL DEFAULT 'day',
  operator_name TEXT,
  hours_run NUMERIC(10,2) NOT NULL,
  hours_available NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entry_date, machine_code, shift_name)
);

CREATE INDEX IF NOT EXISTS idx_fuel_entries_entry_date ON fuel_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_hours_entry_date ON equipment_hours(entry_date DESC);
