-- Phase 2 · Module 8 — job full-text search.
--
-- Candidates already carry a trigger-maintained `searchVector` plus the GIN
-- indexes backing `pg_trgm` (see `phase2_candidate_search`). Jobs get the same
-- treatment here so `/search` can rank requisition hits with `ts_rank` instead
-- of scanning the table with `ILIKE`.
--
-- As with candidates, a trigger is used rather than a
-- `GENERATED ALWAYS AS ... STORED` column: Prisma can model an
-- `Unsupported("tsvector")` column but not the generation expression, and a
-- generated column would therefore show up as permanent schema drift. Functions
-- and triggers are invisible to `prisma migrate diff`.

ALTER TABLE "jobs" ADD COLUMN "searchVector" tsvector;

CREATE OR REPLACE FUNCTION jobs_search_vector_refresh() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('simple', coalesce(NEW."title", '') || ' ' || coalesce(NEW."referenceCode", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW."locationCity", '') || ' ' || coalesce(NEW."locationState", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW."description", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW."requirements", '') || ' ' || coalesce(NEW."responsibilities", '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_search_vector_trigger
  BEFORE INSERT OR UPDATE OF
    "title", "referenceCode", "locationCity", "locationState", "description",
    "requirements", "responsibilities"
  ON "jobs"
  FOR EACH ROW
  EXECUTE FUNCTION jobs_search_vector_refresh();

CREATE INDEX "jobs_searchVector_idx" ON "jobs" USING GIN ("searchVector");

-- Rows written before the trigger existed keep a NULL vector, so rewrite a
-- searchable column in place to make the trigger fire for them. On a database
-- where RLS is forced and the migration role cannot bypass it, this updates no
-- rows — harmless: the search adapter always ORs a `pg_trgm` fallback, so such
-- rows stay findable until the next write stamps a vector on them.
UPDATE "jobs" SET "title" = "title";
