-- =============================================================================
-- TalentFlow — Row Level Security (layer 3 of tenant isolation)
--
-- Kept as a single `DO` block on purpose: Prisma's `$executeRawUnsafe` sends the
-- statement through the extended query protocol, which accepts exactly one
-- statement, so a multi-statement script would not run.
--
-- Tokens substituted by `prisma/apply-rls.ts` before execution:
--   __APP_ROLE__       identifier of the non-owner role used by the running app
--   __FORCE_CLAUSE__   `FORCE` or `NO FORCE`
--
-- Policy shape: `"tenantId" = current_setting('app.tenant_id', true)`.
-- `current_setting(..., true)` returns NULL when the GUC is unset, and a NULL
-- comparison never matches — the policy therefore fails *closed*.
-- =============================================================================

DO $talentflow_rls$
DECLARE
  target          text;
  app_role        text := '__APP_ROLE__';
  tenant_tables   text[] := ARRAY[
    'subscriptions', 'invoices',
    'users', 'roles', 'role_permissions', 'user_roles', 'teams', 'team_members',
    'refresh_tokens', 'auth_tokens',
    'clients', 'client_contacts',
    'skills', 'jobs', 'job_pipeline_stages', 'job_assignments', 'job_skills',
    'candidates', 'candidate_resumes', 'candidate_emails', 'candidate_phones',
    'candidate_experiences', 'candidate_educations',
    'candidate_skills', 'candidate_certifications', 'candidate_languages',
    'candidate_lists', 'candidate_list_members',
    'rejection_reasons', 'tenant_sequences',
    'applications', 'stage_history', 'interviews', 'interview_interviewers',
    'offers', 'placements',
    'activities', 'tasks', 'notes', 'attachments', 'tags', 'tag_links',
    'email_templates', 'email_messages', 'notifications',
    'custom_fields', 'custom_field_values', 'saved_searches', 'import_jobs',
    'import_templates', 'bulk_operations',
    'audit_logs', 'candidate_embeddings'
  ];
  policy_predicate text := '"tenantId" IS NOT NULL AND "tenantId" = current_setting(''app.tenant_id'', true)';
  enabled_count   int := 0;
BEGIN
  FOREACH target IN ARRAY tenant_tables LOOP
    IF to_regclass(format('public.%I', target)) IS NULL THEN
      RAISE EXCEPTION 'RLS: table public.% does not exist — run `prisma migrate deploy` first', target;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE public.%I __FORCE_CLAUSE__ ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (%s) WITH CHECK (%s)',
      target, policy_predicate, policy_predicate
    );

    enabled_count := enabled_count + 1;
  END LOOP;

  RAISE NOTICE 'RLS applied to % tenant-owned tables', enabled_count;

  -- The application role. Deliberately NOT the table owner and NOT BYPASSRLS,
  -- so the policies above actually bind it.
  --
  -- Creating the role and granting on it live in *separate* exception blocks on
  -- purpose. `ALTER ROLE … NOSUPERUSER/BYPASSRLS` is superuser-only, so on a
  -- managed Postgres (or any migration user that is merely the database owner)
  -- it raises `insufficient_privilege`. Sharing one block would roll the
  -- grants back with it and leave the app role with no DML at all — the RLS
  -- suite would then fail with "permission denied" instead of testing policy.
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS NOSUPERUSER', app_role);
      RAISE NOTICE 'created role %', app_role;
    ELSE
      -- Best-effort: only a superuser can rewrite these attributes. A role that
      -- is BYPASSRLS is reported loudly rather than fixed.
      EXECUTE format('ALTER ROLE %I NOBYPASSRLS NOSUPERUSER', app_role);
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE WARNING 'could not set NOBYPASSRLS on % (insufficient privilege) — verify it is not BYPASSRLS', app_role;
  END;

  BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
      app_role
    );
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      app_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
      app_role
    );
    RAISE NOTICE 'granted DML on public schema to %', app_role;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE WARNING 'could not grant DML on public schema to % (insufficient privilege)', app_role;
  END;
END
$talentflow_rls$;
