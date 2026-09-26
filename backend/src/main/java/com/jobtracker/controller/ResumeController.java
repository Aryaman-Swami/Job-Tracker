package com.jobtracker.controller;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/resume")
public class ResumeController {

    private final JdbcTemplate jdbc;

    public ResumeController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public Map<String, Object> get() {
        String content = jdbc.query("SELECT value FROM settings WHERE key = 'base_resume'",
                rs -> rs.next() ? rs.getString("value") : "");
        return Map.of("content", content == null ? "" : content);
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody Map<String, Object> body) {
        String content = body.get("content") == null ? "" : String.valueOf(body.get("content"));
        jdbc.update("""
                INSERT INTO settings (key, value) VALUES ('base_resume', ?)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """, content);
        return Map.of("ok", true);
    }
}
