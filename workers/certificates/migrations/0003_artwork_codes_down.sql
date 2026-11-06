-- Rollback is intentionally non-destructive: retain code assignments, audit history,
-- and nullable certificate/sale references for a safe forward recovery. Disable the
-- Worker routes/deployment to roll back application behavior. Do not drop inventory
-- tables or remove columns after codes/units may have been assigned.
SELECT 'artwork-codes rollback: disable the new Worker/admin feature; retain D1 data' AS rollback_note;
