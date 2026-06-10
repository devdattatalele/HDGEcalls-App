-- Enable Supabase Realtime broadcasts for the `calls` table so the app's
-- live list updates the instant a row is inserted (e.g. by the background
-- sync worker or another signed-in device).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end$$;
