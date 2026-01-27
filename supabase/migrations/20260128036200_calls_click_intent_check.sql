-- Migration: Phase 1.1 Hardening — click intent invariants
-- Date: 2026-01-28
--
-- Enforce for click-sourced intents:
-- - intent_action is canonical: 'phone'|'whatsapp'
-- - intent_target is present
-- - intent_stamp is present
--
-- NOTE: NOT VALID so existing historical rows won't block deploy.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'calls_click_intent_invariants_chk'
      AND conrelid = 'public.calls'::regclass
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_click_intent_invariants_chk
      CHECK (
        source <> 'click'
        OR (
          intent_action IN ('phone','whatsapp')
          AND intent_target IS NOT NULL AND intent_target <> ''
          AND intent_stamp IS NOT NULL AND intent_stamp <> ''
        )
      ) NOT VALID;
  END IF;
END $$;

COMMIT;

