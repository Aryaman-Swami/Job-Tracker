package com.jobtracker.controller;

import com.jobtracker.util.JobRowMapper;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/jobs")
public class JobController {

    private static final java.util.regex.Pattern NON_FULLTIME_TITLE = java.util.regex.Pattern.compile(
            "\\b(intern|interns|internship|internships|trainee|apprentice|apprenticeship|android|ios)\\b", java.util.regex.Pattern.CASE_INSENSITIVE);

    private final JdbcTemplate jdbc;
    private final JobRowMapper rowMapper = new JobRowMapper();

    public JobController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String source,
            @RequestParam(name = "needs_referral", required = false) String needsReferral,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {

        List<String> conditions = new ArrayList<>();
        List<Object> params = new ArrayList<>();

        if (status != null && !status.equals("all")) {
            conditions.add("status = ?");
            params.add(status);
        } else {
            conditions.add("status != ?");
            params.add("not_interested");
        }
        if ("n8n".equals(source)) {
            // "Auto-fetched" tab: any non-manual source (n8n, google-search,
            // workday, adzuna, ...), not just the literal historical "n8n"
            // value — new scraper sources shouldn't need a frontend change
            // to show up here.
            conditions.add("source != ?");
            params.add("manual");
        } else if (source != null) {
            conditions.add("source = ?");
            params.add(source);
        }
        if ("true".equals(needsReferral)) {
            conditions.add("needs_referral = ?");
            params.add(true);
        }

        // Date filter (inclusive, yyyy-MM-dd) on the posting date, falling back to
        // when we first saw the job for sources that don't report one.
        try {
            if (from != null && !from.isBlank()) {
                conditions.add("COALESCE(date_posted, created_at) >= ?");
                params.add(Timestamp.valueOf(java.time.LocalDate.parse(from.trim()).atStartOfDay()));
            }
            if (to != null && !to.isBlank()) {
                conditions.add("COALESCE(date_posted, created_at) < ?");
                params.add(Timestamp.valueOf(java.time.LocalDate.parse(to.trim()).plusDays(1).atStartOfDay()));
            }
        } catch (java.time.format.DateTimeParseException e) {
            return ResponseEntity.badRequest().build();
        }

        String where = conditions.isEmpty() ? "" : "WHERE " + String.join(" AND ", conditions);
        String order = " ORDER BY created_at DESC, id DESC";

        // Unpaginated callers (the existing frontend) still get the full list.
        if (page == null && size == null) {
            return ResponseEntity.ok(jdbc.query("SELECT * FROM jobs " + where + order, rowMapper, params.toArray()));
        }

        int pageSize = Math.min(Math.max(size == null ? 50 : size, 1), 200);
        int pageNum = Math.max(page == null ? 1 : page, 1);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM jobs " + where, Long.class, params.toArray());

        List<Object> pageParams = new ArrayList<>(params);
        pageParams.add(pageSize);
        pageParams.add((long) (pageNum - 1) * pageSize);
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT * FROM jobs " + where + order + " LIMIT ? OFFSET ?", rowMapper, pageParams.toArray());

        long totalCount = total == null ? 0 : total;
        return ResponseEntity.ok()
                .header("X-Total-Count", String.valueOf(totalCount))
                .header("X-Page", String.valueOf(pageNum))
                .header("X-Page-Size", String.valueOf(pageSize))
                .header("X-Total-Pages", String.valueOf((totalCount + pageSize - 1) / pageSize))
                .header("Access-Control-Expose-Headers", "X-Total-Count, X-Page, X-Page-Size, X-Total-Pages")
                .body(rows);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        String company = str(body.get("company"));
        String role = str(body.get("role"));
        if (isBlank(company) || isBlank(role)) {
            return ResponseEntity.badRequest().body(Map.of("error", "company and role are required"));
        }

        // Last line of defence for every scraper (incl. external n8n flows): interns,
        // trainees and apprentices are never wanted. Manual adds are left alone.
        if (!"manual".equals(orDefault(str(body.get("source")), "manual")) && NON_FULLTIME_TITLE.matcher(role).find()) {
            return ResponseEntity.ok(Map.of("skipped", true, "reason", "intern/trainee/mobile role"));
        }

        try {
            List<Map<String, Object>> rows = jdbc.query("""
                INSERT INTO jobs (job_ref_id, company, role, contact_name, contact_email, job_url, status, source, notes, description, needs_referral, linkedin_profile_url, date_posted)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT DO NOTHING
                RETURNING *
                """, rowMapper,
                    str(body.get("job_ref_id")), company, role,
                    str(body.get("contact_name")), str(body.get("contact_email")), str(body.get("job_url")),
                    orDefault(str(body.get("status")), "to_ask"), orDefault(str(body.get("source")), "manual"),
                    str(body.get("notes")), str(body.get("description")),
                    bool(body.get("needs_referral")), str(body.get("linkedin_profile_url")),
                    timestamp(body.get("date_posted")));

            if (rows.isEmpty()) return ResponseEntity.ok(Map.of("skipped", true));
            return ResponseEntity.status(HttpStatus.CREATED).body(rows.get(0));
        } catch (DataIntegrityViolationException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to save job: " + e.getMostSpecificCause().getMessage()));
        }
    }

    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable int id, @RequestBody Map<String, Object> body) {
        try {
            List<Map<String, Object>> rows = jdbc.query("""
                UPDATE jobs SET
                  job_ref_id = COALESCE(?, job_ref_id),
                  company = COALESCE(?, company),
                  role = COALESCE(?, role),
                  contact_name = COALESCE(?, contact_name),
                  contact_email = COALESCE(?, contact_email),
                  job_url = COALESCE(?, job_url),
                  status = COALESCE(?, status),
                  notes = COALESCE(?, notes),
                  description = COALESCE(?, description),
                  needs_referral = COALESCE(?, needs_referral),
                  linkedin_profile_url = COALESCE(?, linkedin_profile_url),
                  updated_at = NOW()
                WHERE id = ? RETURNING *
                """, rowMapper,
                    str(body.get("job_ref_id")), str(body.get("company")), str(body.get("role")),
                    str(body.get("contact_name")), str(body.get("contact_email")), str(body.get("job_url")),
                    str(body.get("status")), str(body.get("notes")), str(body.get("description")),
                    body.containsKey("needs_referral") ? bool(body.get("needs_referral")) : null,
                    str(body.get("linkedin_profile_url")), id);

            if (rows.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
            return ResponseEntity.ok(rows.get(0));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to update job: " + e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable int id) {
        jdbc.update("DELETE FROM jobs WHERE id = ?", id);
        return ResponseEntity.noContent().build();
    }

    private static String str(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o).trim();
        return s.isEmpty() ? null : s;
    }

    private static String orDefault(String s, String def) {
        return s == null ? def : s;
    }

    private static boolean bool(Object o) {
        return Boolean.TRUE.equals(o) || "true".equals(o);
    }

    private static Timestamp timestamp(Object o) {
        if (o == null) return null;
        try {
            return Timestamp.from(Instant.parse(String.valueOf(o)));
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
