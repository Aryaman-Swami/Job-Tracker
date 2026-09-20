package com.jobtracker.db;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Runs the same incremental-migration pattern the original Express app used
 * (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS on every
 * boot), so an existing job_tracker database upgrades in place.
 */
@Component
public class DbInitializer implements ApplicationRunner {

    private final JdbcTemplate jdbc;

    public DbInitializer(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        jdbc.execute("""
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
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """);
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'manual'");
        jdbc.execute("ALTER TABLE jobs ALTER COLUMN job_ref_id TYPE VARCHAR(255)");
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_url_idx ON jobs (job_url) WHERE job_url IS NOT NULL");
        jdbc.execute("DROP INDEX IF EXISTS jobs_company_role_idx");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS needs_referral BOOLEAN NOT NULL DEFAULT false");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS linkedin_profile_url TEXT");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tailored_resume_latex TEXT");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS date_posted TIMESTAMP");

        // ATS score persistence: last score per job, shown as a card without recomputing.
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_score INTEGER");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_breakdown JSONB");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_matched_keywords JSONB");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_missing_keywords JSONB");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_suggestions JSONB");
        jdbc.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_scored_at TIMESTAMP");

        jdbc.execute("""
            DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days'
              AND status IN ('to_ask', 'declined', 'not_interested')
            """);
    }
}
