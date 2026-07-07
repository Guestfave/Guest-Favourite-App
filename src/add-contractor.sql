-- Contractor: who performed the work on an expense (cohost profile id, or '' for external/none)
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS contractor text DEFAULT '';
