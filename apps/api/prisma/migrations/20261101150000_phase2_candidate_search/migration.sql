-- Phase 2 · Module 4 — candidate search & duplicate detection.
--
-- Adds the machinery the candidates module needs:
--   * `pg_trgm` for fuzzy name/company matching (`%`, `similarity()`);
--   * a `searchVector tsvector` column over the searchable profile fields,
--     kept current by a trigger and queried with `to_tsquery`;
--   * GIN indexes so both paths stay index-backed at 100k+ rows.
--
-- A trigger is used rather than a `GENERATED ALWAYS AS ... STORED` column on
-- purpose: Prisma can model the column (`Unsupported("tsvector")`) but not the
-- generation expression, and a generated column therefore shows up as permanent
-- schema drift. Functions and triggers are invisible to `prisma migrate diff`.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

ALTER TABLE "candidates" ADD COLUMN "searchVector" tsvector;

CREATE OR REPLACE FUNCTION candidates_search_vector_refresh() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('simple', coalesce(NEW."firstName", '') || ' ' || coalesce(NEW."lastName", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW."currentTitle", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW."currentCompany", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW."headline", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW."summary", '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER candidates_search_vector_trigger
  BEFORE INSERT OR UPDATE OF
    "firstName", "lastName", "currentTitle", "currentCompany", "headline", "summary"
  ON "candidates"
  FOR EACH ROW
  EXECUTE FUNCTION candidates_search_vector_refresh();

CREATE INDEX "candidates_searchVector_idx" ON "candidates" USING GIN ("searchVector");
CREATE INDEX "candidates_firstName_idx" ON "candidates" USING GIN ("firstName" gin_trgm_ops);
CREATE INDEX "candidates_lastName_idx" ON "candidates" USING GIN ("lastName" gin_trgm_ops);
CREATE INDEX "candidates_currentCompany_idx" ON "candidates" USING GIN ("currentCompany" gin_trgm_ops);
