-- Capture the optional gender and birthday fields during member account creation.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event_guest boolean := new.raw_user_meta_data->>'account_kind'='event_guest';
  v_gender text := NULLIF(new.raw_user_meta_data->>'gender','');
  v_date_text text := NULLIF(new.raw_user_meta_data->>'date_of_birth','');
  v_date_of_birth date;
BEGIN
  IF v_date_text IS NOT NULL THEN
    IF v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Date of birth must use YYYY-MM-DD format.';
    END IF;
    v_date_of_birth := v_date_text::date;
    IF to_char(v_date_of_birth,'YYYY-MM-DD')<>v_date_text OR v_date_of_birth>current_date THEN
      RAISE EXCEPTION 'Enter a valid date of birth.';
    END IF;
  END IF;
  IF NOT v_event_guest THEN
    IF coalesce(new.raw_user_meta_data->>'tennis_skill_level','') NOT IN ('2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0') THEN
      RAISE EXCEPTION 'A valid tennis skill rating is required to register.';
    END IF;
    IF coalesce(trim(new.raw_user_meta_data->>'phone'),'')='' THEN
      RAISE EXCEPTION 'A phone number is required to register.';
    END IF;
  END IF;
  INSERT INTO public.profiles(id,email,full_name,phone,tennis_skill_level,account_kind,gender,date_of_birth)
  VALUES (
    new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),
    CASE WHEN v_event_guest THEN '' ELSE trim(new.raw_user_meta_data->>'phone') END,
    CASE WHEN v_event_guest THEN NULL ELSE new.raw_user_meta_data->>'tennis_skill_level' END,
    CASE WHEN v_event_guest THEN 'event_guest' ELSE 'member' END,
    CASE WHEN v_event_guest THEN NULL ELSE v_gender END,
    CASE WHEN v_event_guest THEN NULL ELSE v_date_of_birth END
  );
  RETURN new;
END;
$$;
