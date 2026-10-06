-- Phase 2: field-level encryption + blind indexes for customer contact data and
-- device passcodes (docs/spec.md §4 "Customer personal data"; approved by Oz).
--
-- * Keys live in Supabase Vault (encrypted at rest; Vault's root key is held
--   outside the database by Supabase). They are generated here, inside the
--   database, so no key ever appears in this repository.
-- * Values are encrypted with pgcrypto's OpenPGP symmetric encryption
--   (AES-256 with an integrity check). pgsodium is not used: Supabase marks it
--   "pending deprecation" (docs/verification.md S10).
-- * Exact-match search uses a keyed HMAC-SHA256 "blind index" of the
--   normalized value, salted with the shop id so the same phone number in two
--   shops gives two unrelated indexes.
-- * Only SECURITY DEFINER functions in `private` touch the keys; none of them
--   is callable by clients directly.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'mend_pii_encryption_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'mend_pii_encryption_key', 'Encrypts customer phone/email and device passcodes');
  end if;
  if not exists (select 1 from vault.secrets where name = 'mend_blind_index_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'mend_blind_index_key', 'HMAC key for exact-match search on encrypted fields');
  end if;
end;
$$;

create function private.secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$$;

create function private.pii_encrypt(p_value text)
returns bytea
language sql
volatile
security definer
set search_path = ''
as $$
  select case when p_value is null or p_value = '' then null
    else extensions.pgp_sym_encrypt(p_value, private.secret('mend_pii_encryption_key'), 'cipher-algo=aes256')
  end;
$$;

create function private.pii_decrypt(p_value bytea)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_value is null then null
    else extensions.pgp_sym_decrypt(p_value, private.secret('mend_pii_encryption_key'))
  end;
$$;

create function private.blind_index(p_shop_id uuid, p_normalized text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_normalized is null or p_normalized = '' then null
    else encode(extensions.hmac(p_shop_id::text || ':' || p_normalized, private.secret('mend_blind_index_key'), 'sha256'), 'hex')
  end;
$$;

-- E.164 for Canada/US numbers (spec §6). 10 digits -> +1XXXXXXXXXX;
-- 11 digits starting with 1 -> +1...; an explicit +country number of 8-15
-- digits is kept as is. Anything else is rejected.
create function private.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if btrim(coalesce(p_phone, '')) = '' then
    return null;
  end if;
  if btrim(p_phone) like '+%' and length(v_digits) between 8 and 15 then
    return '+' || v_digits;
  end if;
  if length(v_digits) = 10 then
    return '+1' || v_digits;
  end if;
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    return '+' || v_digits;
  end if;
  raise exception 'enter a phone number with area code, like 416 555 0100' using errcode = '22023';
end;
$$;

create function private.normalize_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_email, '')));
begin
  if v = '' then
    return null;
  end if;
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v) > 254 then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke execute on function
  private.secret(text), private.pii_encrypt(text), private.pii_decrypt(bytea),
  private.blind_index(uuid, text), private.normalize_phone(text), private.normalize_email(text)
from public, anon, authenticated;
