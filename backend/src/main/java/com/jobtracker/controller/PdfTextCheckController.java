package com.jobtracker.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jobtracker.service.LatexPdfService;
import com.jobtracker.service.PdfTextCheckService;
import com.jobtracker.util.JobRowMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * On-demand "does an ATS parser see this resume correctly?" check. Deliberately a
 * separate endpoint from /api/tailor: no Claude call, runs only when the UI asks,
 * so it adds no time to tailoring.
 */
@RestController
@RequestMapping("/api/pdf-check")
public class PdfTextCheckController {

    private final JdbcTemplate jdbc;
    private final LatexPdfService latexPdf;
    private final PdfTextCheckService checker;
    private final ObjectMapper mapper = new ObjectMapper();
    private final JobRowMapper rowMapper = new JobRowMapper();

    public PdfTextCheckController(JdbcTemplate jdbc, LatexPdfService latexPdf, PdfTextCheckService checker) {
        this.jdbc = jdbc;
        this.latexPdf = latexPdf;
        this.checker = checker;
    }

    @PostMapping("/{id}")
    public ResponseEntity<Map<String, Object>> check(@PathVariable int id) {
        List<Map<String, Object>> jobs = jdbc.query("SELECT * FROM jobs WHERE id = ?", rowMapper, id);
        if (jobs.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
        Map<String, Object> job = jobs.get(0);

        String latex = (String) job.get("tailored_resume_latex");
        if (latex == null || latex.isBlank()) {
            List<String> base = jdbc.query("SELECT value FROM settings WHERE key = 'base_resume'", (rs, i) -> rs.getString(1));
            latex = base.isEmpty() ? null : base.get(0);
        }
        if (latex == null || latex.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No resume saved."));
        }

        LatexPdfService.CompileResult compiled = latexPdf.compileToPdfBytes(latex);
        if (!compiled.attempted()) {
            return ResponseEntity.status(500).body(Map.of("error", "No LaTeX compiler found."));
        }
        if (!compiled.compiled() || compiled.pdfBytes() == null) {
            return ResponseEntity.status(500).body(Map.of("error",
                    compiled.errorLine() != null ? "LaTeX compilation failed: " + compiled.errorLine() : "LaTeX compilation failed."));
        }

        try {
            return ResponseEntity.ok(checker.analyze(compiled.pdfBytes(), matchedKeywords(job.get("ats_matched_keywords"))));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Could not read the PDF text layer."));
        }
    }

    private List<String> matchedKeywords(Object raw) {
        List<String> out = new ArrayList<>();
        if (raw instanceof List<?> l) {
            for (Object o : l) if (o != null) out.add(o.toString());
        } else if (raw instanceof String s && !s.isBlank()) {
            try {
                for (Object o : mapper.readValue(s, List.class)) if (o != null) out.add(o.toString());
            } catch (Exception ignored) {}
        }
        return out;
    }
}
