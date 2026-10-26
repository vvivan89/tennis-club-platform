-- Configurable instructions displayed to members when they choose Interac e-Transfer.
CREATE TABLE IF NOT EXISTS public.payment_method_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  interac_enabled boolean NOT NULL DEFAULT false,
  interac_recipient_email text NOT NULL DEFAULT '',
  interac_instructions text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT payment_method_settings_email_length CHECK (length(interac_recipient_email) <= 254),
  CONSTRAINT payment_method_settings_instructions_length CHECK (length(interac_instructions) <= 5000)
);
INSERT INTO public.payment_method_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.payment_method_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage payment method settings" ON public.payment_method_settings;
CREATE POLICY "Admins manage payment method settings" ON public.payment_method_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.application_status = 'approved'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.application_status = 'approved'));
DROP POLICY IF EXISTS "Members read enabled Interac settings" ON public.payment_method_settings;
CREATE POLICY "Members read enabled Interac settings" ON public.payment_method_settings FOR SELECT TO authenticated USING (interac_enabled = true);
GRANT SELECT, INSERT, UPDATE ON public.payment_method_settings TO authenticated;
GRANT ALL ON public.payment_method_settings TO service_role;
