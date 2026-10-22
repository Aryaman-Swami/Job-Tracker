package com.jobtracker.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jobtracker.service.ClaudeCliService;
import com.jobtracker.util.JobRowMapper;
import com.jobtracker.util.JsonColumns;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/ats-score")
public class AtsScoreController {

    private static final Path RESUME_PATH = Path.of(System.getProperty("user.dir"), "..", "resume.tex").normalize();
    private static final Pattern JSON_BLOCK = Pattern.compile("\\{[\\s\\S]*}");

    private final JdbcTemplate jdbc;
    private final ClaudeCliService claude;
    private final ObjectMapper mapper = new ObjectMapper();
    private final JobRowMapper rowMapper = new JobRowMapper();

    public AtsScoreController(JdbcTemplate jdbc, ClaudeCliService claude) {
        this.jdbc = jdbc;
        this.claude = claude;
    }

    // Returns the persisted last score for this job (if any), so the UI can
    // render the ATS score card immediately on load without recomputing it.
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getPersisted(@PathVariable int id) {
        List<Map<String, Object>> jobs = jdbc.query("SELECT * FROM jobs WHERE id = ?", rowMapper, id);
        if (jobs.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
        Map<String, Object> job = jobs.get(0);

        if (job.get("ats_score") == null) {
            return ResponseEntity.ok(Map.of("ok", true, "scored", false));
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("ok", true);
        response.put("scored", true);
        response.put("score", job.get("ats_score"));
        response.put("breakdown", job.get("ats_breakdown"));
        response.put("matched_keywords", job.get("ats_matched_keywords"));
        response.put("missing_keywords", job.get("ats_missing_keywords"));
        response.put("suggestions", job.get("ats_suggestions"));
        response.put("scored_at", job.get("ats_scored_at"));
        return ResponseEntity.ok(response);
    }

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

        String role = (String) job.get("role");
        String company = (String) job.get("company");
        String description = (String) job.get("description");
        String notes = (String) job.get("notes");
        String desc = description != null ? description
                : "Role: " + role + "\nCompany: " + company + (notes != null ? "\n" + notes : "");

        String prompt = """
                Analyze the resume against the job description and return ONLY a valid JSON object (no markdown, no code fences, no explanation) in exactly this format:
                {
                  "score": <integer 0-100>,
                  "breakdown": {
                    "keywords": <integer 0-100>,
                    "skills": <integer 0-100>,
                    "experience": <integer 0-100>,
                    "title_alignment": <integer 0-100>
                  },
                  "matched_keywords": [<up to 15 keyword strings found in both resume and JD, copied verbatim in the JD's wording>],
                  "missing_keywords": [<up to 15 important JD keywords absent from resume, most important first, copied verbatim in the JD's wording>],
                  "suggestions": [<3-4 short actionable improvement strings>]
                }

                Keyword method (same as the resume tailoring step, so scores and tailoring agree): first extract every hard skill, tool, language, framework, methodology, job title, certification and soft-skill phrase from the JD. A keyword counts as matched only if its exact wording (case-insensitive; an acronym or its expansion both count) appears in the resume text. A keyword that is only implied or a synonym counts as missing, because ATS filters match strings. In "suggestions", for each missing keyword the candidate could truthfully claim, say where to insert it; never suggest fabricating experience.

                === JOB ===
                Role: %s
                Company: %s
                %s

                === RESUME ===
                %s""".formatted(role, company, desc, resume);

        try {
            ClaudeCliService.ClaudeResult result = claude.run(prompt, null);
            if (result.exitCode() != 0) {
                String errMsg = !result.stderr().isBlank() ? result.stderr().trim() : result.stdout().trim();
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("ok", false, "error", errMsg));
            }
            Matcher m = JSON_BLOCK.matcher(result.stdout());
            if (!m.find()) throw new IllegalStateException("No JSON in response");
            Map<String, Object> parsed = mapper.readValue(m.group(), Map.class);

            Object scoreObj = parsed.get("score");
            int score = scoreObj instanceof Number n ? n.intValue() : 0;
            Object breakdown = parsed.get("breakdown");
            Object matched = parsed.get("matched_keywords");
            Object missing = parsed.get("missing_keywords");
            Object suggestions = parsed.get("suggestions");

            jdbc.update("""
                    UPDATE jobs SET
                      ats_score = ?,
                      ats_breakdown = ?::jsonb,
                      ats_matched_keywords = ?::jsonb,
                      ats_missing_keywords = ?::jsonb,
                      ats_suggestions = ?::jsonb,
                      ats_scored_at = NOW()
                    WHERE id = ?
                    """,
                    score, JsonColumns.toJson(breakdown), JsonColumns.toJson(matched),
                    JsonColumns.toJson(missing), JsonColumns.toJson(suggestions), id);

            Map<String, Object> response = new LinkedHashMap<>(parsed);
            response.put("ok", true);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("ok", false, "error", "Claude returned an unexpected response."));
        }
    }
}
