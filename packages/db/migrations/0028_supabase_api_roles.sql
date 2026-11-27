-- Supabase serves the public schema through its Data API (PostgREST) as the anon and authenticated
-- roles, and by default grants them every table the postgres role creates there. With the public
-- anon key, that would be read and write access to every skirm table. skirm never uses the Data
-- API (its services connect to Postgres as the tables' owner), so take those grants away, now and
-- for tables later migrations create. A no-op where the roles don't exist (local Docker, PGlite,
-- Cloud SQL). docs/deploy.md, Database: also turn the Data API off in the Supabase dashboard.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END
$$;
