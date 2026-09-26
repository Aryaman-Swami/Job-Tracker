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

@Service
public class SyncService {

    private static final Logger log = LoggerFactory.getLogger(SyncService.class);
    private static final Path SCRAPER_SCRIPT = Path.of(System.getProperty("user.dir"), "..", "scraper", "run_scraper.py").normalize();
    private static final int MAX_MESSAGE_LEN = 500;

    private final JdbcTemplate jdbc;

    public SyncService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> runSync() {
        jdbc.execute("""
                DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days'
                  AND status IN ('to_ask', 'declined', 'not_interested')
                """);

        try {
            String pythonBin = System.getenv().getOrDefault("PYTHON_BIN",
                    System.getProperty("os.name", "").toLowerCase().contains("win") ? "python" : "python3");
            Process proc = new ProcessBuilder(pythonBin, SCRAPER_SCRIPT.toString())
                    .redirectErrorStream(true).start();
            String out = new String(proc.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            boolean finished = proc.waitFor(300, TimeUnit.SECONDS);
            log.info("Scraper output:\n{}", out);
            if (!finished) {
                proc.destroyForcibly();
                return Map.of("ok", false, "message", "Scraper timed out");
            }
            if (proc.exitValue() == 0) {
                return Map.of("ok", true, "message", tail(out));
            }
            return Map.of("ok", false, "message", tail(out));
        } catch (IOException | InterruptedException e) {
            return Map.of("ok", false, "message", e.getMessage());
        }
    }

    private static String tail(String out) {
        String trimmed = out.trim();
        return trimmed.length() <= MAX_MESSAGE_LEN
                ? trimmed
                : trimmed.substring(trimmed.length() - MAX_MESSAGE_LEN);
    }
}
