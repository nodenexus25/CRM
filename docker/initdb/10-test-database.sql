-- =============================================================================
-- TalentFlow — integration-test database and runtime role.
--
-- Postgres runs everything in /docker-entrypoint-initdb.d exactly once, on a
-- brand-new data volume. Existing volumes are brought up to date by
-- `pnpm db:test:setup` (apps/api/prisma/test-db.ts), which performs the same
-- two steps idempotently.
-- =============================================================================

-- Separate database so a test run can never touch development data.
CREATE DATABASE talentflow_test OWNER talentflow;

-- The role the integration suite connects as. Deliberately NOT a superuser and
-- NOT BYPASSRLS, and it owns nothing, so the `tenant_isolation` policies in
-- prisma/rls.sql actually bind it. If this role could bypass RLS the whole
-- RLS test suite would pass while proving nothing.
CREATE ROLE talentflow_app_test
  LOGIN
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE
  PASSWORD 'talentflow_test_pw';

GRANT CONNECT ON DATABASE talentflow_test TO talentflow_app_test;
