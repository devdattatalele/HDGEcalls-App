-- Per-call sales feedback: rating + purchase confidence + optional contact
-- override (when the auto-paired contact_name from the CallLog is wrong or
-- the user wants to attach a different contact to this call).

alter table public.calls
  add column if not exists rating int
    check (rating is null or (rating between 1 and 10)),
  add column if not exists purchase_confidence int
    check (purchase_confidence is null or (purchase_confidence between 1 and 10)),
  add column if not exists assigned_contact_name text,
  add column if not exists assigned_contact_phone text,
  add column if not exists rated_at timestamptz;
