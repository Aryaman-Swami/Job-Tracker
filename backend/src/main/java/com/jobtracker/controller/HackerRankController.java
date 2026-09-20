package com.jobtracker.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jobtracker.rubric.HackerRankRubric;
import com.jobtracker.service.ClaudeCliService;
import com.jobtracker.util.JobRowMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/hackerrank-score")
public class HackerRankController {

    private static final Path RESUME_PATH = Path.of(System.getProperty("user.dir"), "..", "resume.tex").normalize();
    private static final Pattern JSON_BLOCK = Pattern.compile("\\{[\\s\\S]*}");

    private final JdbcTemplate jdbc;
    private final ClaudeCliService claude;
    private final ObjectMapper mapper = new ObjectMapper();
    private final JobRowMapper rowMapper = new JobRowMapper();

    public HackerRankController(JdbcTemplate jdbc, ClaudeCliService claude) {
        this.jdbc = jdbc;
        this.claude = claude;
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/{id}")
    public ResponseEntity<Map<String, Object>> score(@PathVariable int id) {
        List<Map<String, Object>> jobs = jdbc.query("SELECT * FROM jobs WHERE id = ?", rowMapper, id);
        if (jobs.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
        Map<String, Object> job = jobs.get(0);

        String resume = (String) job.get("tailored_resume_latex");
        if (resume == null) {
            try {
                resume = Files.readString(RESUME_PATH, StandardCharsets.UTF_8);
            } catch (IOException e) {
                return ResponseEntity.badRequest().body(Map.of("error", "No resume saved. Please save your resume first."));
            }
        }
        if (resume.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Resume is empty. Please save your resume first."));
        }

        try {
            String prompt = HackerRankRubric.buildPrompt(resume);
            ClaudeCliService.ClaudeResult result = claude.run(prompt, HackerRankRubric.SYSTEM_MESSAGE);
            if (result.exitCode() != 0) {
                String errMsg = !result.stderr().isBlank() ? result.stderr().trim() : result.stdout().trim();
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("ok", false, "error", errMsg));
            }
            Matcher m = JSON_BLOCK.matcher(result.stdout());
            if (!m.find()) throw new IllegalStateException("No JSON in response");
            Map<String, Object> parsed = mapper.readValue(m.group(), Map.class);

            Map<String, Object> scores = (Map<String, Object>) parsed.getOrDefault("scores", Map.of());
            int total = 0;
            List<Map<String, Object>> breakdown = new ArrayList<>();
            for (HackerRankRubric.Category cat : HackerRankRubric.CATEGORIES) {
                Map<String, Object> raw = (Map<String, Object>) scores.getOrDefault(cat.key(), Map.of());
                double rawScore = raw.get("score") instanceof Number n ? n.doubleValue() : 0;
                int score = (int) Math.max(0, Math.min(rawScore, cat.max()));
                total += score;
                Map<String, Object> entry = new java.util.LinkedHashMap<>();
                entry.put("key", cat.key());
                entry.put("label", cat.label());
                entry.put("max", cat.max());
                entry.put("icon", cat.icon());
                entry.put("score", score);
                entry.put("evidence", raw.getOrDefault("evidence", ""));
                breakdown.add(entry);
            }

            Map<String, Object> bonusPoints = (Map<String, Object>) parsed.getOrDefault("bonus_points", Map.of());
            double bonusRaw = bonusPoints.get("total") instanceof Number n ? n.doubleValue() : 0;
            int bonus = (int) Math.max(0, Math.min(bonusRaw, HackerRankRubric.BONUS_MAX));

            Map<String, Object> deductionsMap = (Map<String, Object>) parsed.getOrDefault("deductions", Map.of());
            double deductionsRaw = deductionsMap.get("total") instanceof Number n ? n.doubleValue() : 0;
            int deductions = (int) Math.max(0, deductionsRaw);

            total = (int) Math.max(HackerRankRubric.MIN_FINAL_SCORE,
                    Math.min(total + bonus - deductions, HackerRankRubric.MAX_FINAL_SCORE));

            Map<String, Object> response = new java.util.LinkedHashMap<>();
            response.put("ok", true);
            response.put("total", total);
            response.put("max_score", HackerRankRubric.MAX_SCORE);
            response.put("max_final_score", HackerRankRubric.MAX_FINAL_SCORE);
            response.put("breakdown", breakdown);
            response.put("bonus_points", Map.of("total", bonus, "breakdown", bonusPoints.getOrDefault("breakdown", "")));
            response.put("deductions", Map.of("total", deductions, "reasons", deductionsMap.getOrDefault("reasons", "")));
            response.put("key_strengths", parsed.getOrDefault("key_strengths", List.of()));
            response.put("areas_for_improvement", parsed.getOrDefault("areas_for_improvement", List.of()));
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("ok", false, "error", "Claude returned an unexpected response."));
        }
    }
}
