-- A fully refunded membership payment must no longer mark its membership as paid.
CREATE OR REPLACE FUNCTION public.reset_membership_after_full_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_family_id uuid;
  v_membership_id uuid;
BEGIN
  IF NEW.purpose <> 'membership'
     OR NEW.status <> 'refunded'
     OR NEW.refunded_amount_minor < NEW.amount_minor THEN
    RETURN NEW;
  END IF;

  IF NEW.business_record_id LIKE 'family:%'
     AND substring(NEW.business_record_id FROM 8) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_family_id := substring(NEW.business_record_id FROM 8)::uuid;
    UPDATE public.membership_families
    SET paid_at = NULL, paid_by = NULL, payment_id = NULL
    WHERE id = v_family_id AND payment_id = NEW.id;
  ELSIF NEW.business_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_membership_id := NEW.business_record_id::uuid;
    UPDATE public.memberships
    SET payment_status = 'unpaid', updated_at = now()
    WHERE id = v_membership_id AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reset_membership_after_full_refund ON public.payments;
CREATE TRIGGER reset_membership_after_full_refund
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.reset_membership_after_full_refund();

-- Repair memberships affected by full refunds recorded before this trigger existed.
UPDATE public.memberships m
SET payment_status = 'unpaid', updated_at = now()
FROM public.payments p
WHERE p.purpose = 'membership'
  AND p.status = 'refunded'
  AND p.refunded_amount_minor >= p.amount_minor
  AND p.business_record_id = m.id::text
  AND p.user_id = m.user_id
  AND m.payment_status IS DISTINCT FROM 'unpaid';

UPDATE public.membership_families f
SET paid_at = NULL, paid_by = NULL, payment_id = NULL
FROM public.payments p
WHERE p.purpose = 'membership'
  AND p.status = 'refunded'
  AND p.refunded_amount_minor >= p.amount_minor
  AND p.business_record_id = 'family:' || f.id::text
  AND p.id = f.payment_id;
