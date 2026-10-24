package com.jobtracker.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
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
                DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days'
                  AND status IN ('to_ask', 'declined', 'not_interested')
                """);

        Map<String, Object> jobspyResult = runScript(SCRAPER_SCRIPT);
        Map<String, Object> workdayResult = runScript(WORKDAY_SCRIPT);
        Map<String, Object> wellfoundResult = runScript(WELLFOUND_SCRIPT);

        boolean ok = Boolean.TRUE.equals(jobspyResult.get("ok")) && Boolean.TRUE.equals(workdayResult.get("ok"))
                && Boolean.TRUE.equals(wellfoundResult.get("ok"));
        String message = "jobspy: " + jobspyResult.get("message") + "\nworkday: " + workdayResult.get("message")
                + "\nwellfound: " + wellfoundResult.get("message");
        return Map.of("ok", ok, "message", tail(message));
    }

    private Map<String, Object> runScript(Path script) {
        try {
            String pythonBin = System.getenv().getOrDefault("PYTHON_BIN",
                    System.getProperty("os.name", "").toLowerCase().contains("win") ? "python" : "python3");
            Process proc = new ProcessBuilder(pythonBin, script.toString())
                    .redirectErrorStream(true).start();
            String out = new String(proc.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            boolean finished = proc.waitFor(300, TimeUnit.SECONDS);
            log.info("{} output:\n{}", script.getFileName(), out);
            if (!finished) {
                proc.destroyForcibly();
                return Map.of("ok", false, "message", "Timed out");
            }
            return Map.of("ok", proc.exitValue() == 0, "message", tail(out));
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
