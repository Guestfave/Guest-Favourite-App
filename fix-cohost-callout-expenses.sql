-- Fix existing CoHost Callout expenses that were saved with wrong expense_type
UPDATE public.expenses
SET expense_type = 'cohost-callout',
    resolved = true,
    charge = COALESCE(NULLIF(charge, 0), amount)  -- if charge was 0 or null, default to amount
WHERE category = 'CoHost Callout'
  AND (expense_type = 'business' OR expense_type = 'owner' OR expense_type = '');
