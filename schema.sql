-- Reference schema for the `jobs` table. The Spring Boot backend
-- (backend/src/main/java/com/jobtracker/db/DbInitializer.java) applies this
-- incrementally at every startup via CREATE TABLE/ALTER TABLE IF NOT EXISTS,
-- so this file is documentation, not something you need to run by hand.
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  job_ref_id VARCHAR(255),
  company VARCHAR(255) NOT NULL,
  role VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  job_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'to_ask',
  source VARCHAR(50) NOT NULL DEFAULT 'manual',
  notes TEXT,
  description TEXT,
  needs_referral BOOLEAN NOT NULL DEFAULT false,
  linkedin_profile_url TEXT,
  tailored_resume_latex TEXT,
  date_posted TIMESTAMP,

  -- Last ATS score for this job, persisted so the UI can show it as a
  -- card without recomputing it on every load.
  ats_score INTEGER,
  ats_breakdown JSONB,
  ats_matched_keywords JSONB,
  ats_missing_keywords JSONB,
  ats_suggestions JSONB,
  ats_scored_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_url_idx ON jobs (job_url) WHERE job_url IS NOT NULL;
