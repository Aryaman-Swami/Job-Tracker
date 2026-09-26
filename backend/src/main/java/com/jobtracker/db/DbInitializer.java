package com.jobtracker.db;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

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
    public void run(ApplicationArguments args) throws InterruptedException {
        // The Supabase pooler's first TLS handshake right after JVM startup is
        // occasionally reset (SSL error: Broken pipe); every statement below
        // is idempotent, so retrying the whole block is safe.
        int attempts = 0;
        while (true) {
            try {
                initialize();
                return;
            } catch (org.springframework.jdbc.CannotGetJdbcConnectionException e) {
                attempts++;
                if (attempts >= 5) {
                    throw e;
                }
                Thread.sleep(2000L * attempts);
            }
        }
    }

    private void initialize() {
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

        // Base resume, persisted in the DB instead of the container's (ephemeral,
        // on Render) filesystem so it survives restarts/redeploys.
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS settings (
              key VARCHAR(50) PRIMARY KEY,
              value TEXT
            )
            """);
        seedBaseResumeFromRepoFileIfEmpty();
    }

    // One-time migration: the base resume used to live at ../resume.tex. If the
    // settings table has never been populated but that file is present in the
    // image (repo checkout), seed the DB with it so existing users don't lose
    // their saved resume when this switched over from file to DB storage.
    private void seedBaseResumeFromRepoFileIfEmpty() {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM settings WHERE key = 'base_resume'", Integer.class);
        if (count != null && count > 0) return;

        Path legacyPath = Path.of(System.getProperty("user.dir"), "..", "resume.tex").normalize();
        try {
            String content = Files.readString(legacyPath, StandardCharsets.UTF_8);
            jdbc.update("INSERT INTO settings (key, value) VALUES ('base_resume', ?)", content);
        } catch (java.io.IOException ignored) {
            // No legacy file to migrate from; base resume starts empty until saved via the UI.
        }
    }
}
