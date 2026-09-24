package com.jobtracker.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/sync")
public class SyncController {

    private static final Path SCRAPER_SCRIPT = Path.of(System.getProperty("user.dir"), "..", "scraper", "run_scraper.py").normalize();

    private final JdbcTemplate jdbc;

    public SyncController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> sync() {
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
            if (!finished) {
                proc.destroyForcibly();
                return ResponseEntity.status(500).body(Map.of("ok", false, "message", "Scraper timed out"));
            }
            if (proc.exitValue() == 0) {
                return ResponseEntity.ok(Map.of("ok", true, "message", out.trim()));
            }
            return ResponseEntity.status(500).body(Map.of("ok", false, "message", out.trim()));
        } catch (IOException | InterruptedException e) {
            return ResponseEntity.status(500).body(Map.of("ok", false, "message", e.getMessage()));
        }
    }
}
