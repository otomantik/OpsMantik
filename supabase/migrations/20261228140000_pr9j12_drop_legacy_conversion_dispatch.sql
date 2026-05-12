-- PR-9J.12: remove empty legacy conversion_dispatch pipeline.

BEGIN;

DROP TABLE IF EXISTS public.conversion_dispatch_transitions;
DROP TABLE IF EXISTS public.conversion_dispatch;

COMMIT;
