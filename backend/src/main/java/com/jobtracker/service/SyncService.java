package com.jobtracker.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class SyncService {

    private static final Logger log = LoggerFactory.getLogger(SyncService.class);
    private static final Path SCRAPER_SCRIPT = Path.of(System.getProperty("user.dir"), "..", "scraper", "run_scraper.py").normalize();
    private static final Path WORKDAY_SCRIPT = Path.of(System.getProperty("user.dir"), "..", "scraper", "workday_search.py").normalize();
    private static final Path WELLFOUND_SCRIPT = Path.of(System.getProperty("user.dir"), "..", "scraper", "wellfound_search.py").normalize();
    private static final Path GREENHOUSE_SCRIPT = Path.of(System.getProperty("user.dir"), "..", "scraper", "greenhouse_search.py").normalize();
    private static final long DEFAULT_TIMEOUT_SECONDS = 300;
    private static final long LONG_TIMEOUT_SECONDS = 900;
    private static final int MAX_MESSAGE_LEN = 500;

    private final JdbcTemplate jdbc;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public SyncService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Kicks off the scraper on a background thread and returns immediately, since the
     * scraper takes several minutes and external cron pingers time out long before that.
     */
    public Map<String, Object> runSyncAsync() {
        if (!running.compareAndSet(false, true)) {
            return Map.of("ok", true, "message", "Sync already in progress");
        }
        Thread.ofVirtual().name("scraper-sync").start(() -> {
            try {
                Map<String, Object> result = runSync();
                log.info("Async scraper sync finished: {}", result.get("message"));
            } finally {
                running.set(false);
            }
        });
        return Map.of("ok", true, "message", "Scraper started");
    }

    public Map<String, Object> runSync() {
        jdbc.execute("""
                DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '15 days'
                  AND status IN ('to_ask', 'declined', 'not_interested')
                  AND (tailored_resume_latex IS NULL OR BTRIM(tailored_resume_latex) = '')
                """);

        // hiring.cafe is intentionally not run here: Cloudflare blocks Render, so it runs locally only.
        Map<String, Object> jobspyResult = runScript(SCRAPER_SCRIPT, timeoutSeconds("SYNC_TIMEOUT_JOBSPY_SECONDS", LONG_TIMEOUT_SECONDS));
        Map<String, Object> workdayResult = runScript(WORKDAY_SCRIPT, timeoutSeconds("SYNC_TIMEOUT_WORKDAY_SECONDS", LONG_TIMEOUT_SECONDS));
        Map<String, Object> wellfoundResult = runScript(WELLFOUND_SCRIPT, timeoutSeconds("SYNC_TIMEOUT_WELLFOUND_SECONDS", DEFAULT_TIMEOUT_SECONDS));
        Map<String, Object> greenhouseResult = runScript(GREENHOUSE_SCRIPT, timeoutSeconds("SYNC_TIMEOUT_GREENHOUSE_SECONDS", DEFAULT_TIMEOUT_SECONDS));

        boolean ok = Boolean.TRUE.equals(jobspyResult.get("ok")) && Boolean.TRUE.equals(workdayResult.get("ok"))
                && Boolean.TRUE.equals(wellfoundResult.get("ok")) && Boolean.TRUE.equals(greenhouseResult.get("ok"));
        String message = "jobspy: " + jobspyResult.get("message") + "\nworkday: " + workdayResult.get("message")
                + "\nwellfound: " + wellfoundResult.get("message") + "\ngreenhouse: " + greenhouseResult.get("message");
        return Map.of("ok", ok, "message", tail(message));
    }

    private static long timeoutSeconds(String envName, long def) {
        String v = System.getenv(envName);
        if (v != null && !v.isBlank()) {
            try {
                long n = Long.parseLong(v.trim());
                if (n > 0) return n;
            } catch (NumberFormatException ignored) {
                log.warn("Ignoring invalid {}={}", envName, v);
            }
        }
        return def;
    }

    private Map<String, Object> runScript(Path script, long timeoutSeconds) {
        try {
            String pythonBin = System.getenv().getOrDefault("PYTHON_BIN",
                    System.getProperty("os.name", "").toLowerCase().contains("win") ? "python" : "python3");
            Path outFile = Files.createTempFile("scraper-", ".log");
            try {
                ProcessBuilder pb = new ProcessBuilder(pythonBin, "-u", script.toString())
                        .redirectErrorStream(true).redirectOutput(outFile.toFile());
                // Unbuffered stdout so partial output survives a timeout kill.
                pb.environment().put("PYTHONUNBUFFERED", "1");
                log.info("Starting {} (timeout {}s)", script.getFileName(), timeoutSeconds);
                Process proc = pb.start();
                boolean finished = proc.waitFor(timeoutSeconds, TimeUnit.SECONDS);
                if (!finished) {
                    proc.descendants().forEach(ProcessHandle::destroyForcibly);
                    proc.destroyForcibly();
                }
                String out = Files.readString(outFile, StandardCharsets.UTF_8);
                log.info("{} output{}:\n{}", script.getFileName(), finished ? "" : " (timed out)", out);
                if (!finished) {
                    return Map.of("ok", false, "message", "Timed out: " + tail(out));
                }
                return Map.of("ok", proc.exitValue() == 0, "message", tail(out));
            } finally {
                Files.deleteIfExists(outFile);
            }
        } catch (IOException | InterruptedException e) {
            return Map.of("ok", false, "message", String.valueOf(e.getMessage()));
        }
    }

    private static String tail(String out) {
        String trimmed = out.trim();
        return trimmed.length() <= MAX_MESSAGE_LEN
                ? trimmed
                : trimmed.substring(trimmed.length() - MAX_MESSAGE_LEN);
    }
}
