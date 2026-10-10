package com.jobtracker.controller;

import com.jobtracker.service.ClaudeCliService;
import com.jobtracker.service.LatexPdfService;
import com.jobtracker.util.JobRowMapper;
import com.jobtracker.util.LatexUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tailor")
public class TailorController {

    private final JdbcTemplate jdbc;
    private final ClaudeCliService claude;
    private final LatexPdfService latexPdf;
    private final JobRowMapper rowMapper = new JobRowMapper();

    public TailorController(JdbcTemplate jdbc, ClaudeCliService claude, LatexPdfService latexPdf) {
        this.jdbc = jdbc;
        this.claude = claude;
        this.latexPdf = latexPdf;
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/{id}")
    public ResponseEntity<Map<String, Object>> tailor(@PathVariable int id, @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> jobs = jdbc.query("SELECT * FROM jobs WHERE id = ?", rowMapper, id);
        if (jobs.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
        Map<String, Object> job = jobs.get(0);

        String resume = (String) job.get("tailored_resume_latex");
        if (resume == null) {
            resume = jdbc.query("SELECT value FROM settings WHERE key = 'base_resume'",
                    rs -> rs.next() ? rs.getString("value") : null);
        }
        if (resume == null || resume.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Resume is empty. Please save your resume first."));
        }

        String role = (String) job.get("role");
        String company = (String) job.get("company");
        String description = (String) job.get("description");
        String notes = (String) job.get("notes");
        String desc = description != null ? description
                : "Role: " + role + "\nCompany: " + company + (notes != null ? "\n" + notes : "");

        Map<String, Object> atsFeedback = body == null ? null : (Map<String, Object>) body.get("atsFeedback");
        List<String> missingKeywords = atsFeedback == null ? null : (List<String>) atsFeedback.get("missing_keywords");
        List<String> suggestions = atsFeedback == null ? null : (List<String>) atsFeedback.get("suggestions");
        String extraInstructions = atsFeedback == null ? null : (String) atsFeedback.get("extra_instructions");

        String atsSection = "";
        if ((missingKeywords != null && !missingKeywords.isEmpty()) || (suggestions != null && !suggestions.isEmpty())) {
            atsSection = "\n=== ATS GAPS FROM LAST SCORE ===\nA previous ATS scan of this resume against this job found these gaps. Work in whichever of these are honestly true of the existing content — do not fabricate skills, tools, or experience that aren't already implied by the resume.\n"
                    + (missingKeywords != null && !missingKeywords.isEmpty() ? "Missing keywords: " + String.join(", ", missingKeywords) + "\n" : "")
                    + (suggestions != null && !suggestions.isEmpty() ? "Suggestions: " + String.join("; ", suggestions) + "\n" : "");
        }
        String extraSection = extraInstructions != null && !extraInstructions.isBlank()
                ? "\n=== ADDITIONAL INSTRUCTIONS FROM CANDIDATE ===\n" + extraInstructions.trim() + "\n"
                : "";

        String prompt = """
                You are tailoring a candidate's LaTeX resume for a specific job.

                STRICT RULES:
                1. Keep the total word count within ±5%% of the original. Do NOT add new bullet points, sections, or expand existing ones.
                2. Only rewrite existing bullet points to better match the job description's language and keywords — do not invent new content, achievements, or skills that aren't already present in some form.
                3. Before rewriting, find every skill, tool, or concept the job description mentions or clearly implies that is ALSO already true of the candidate somewhere in the resume (Skills section, Projects, or other Experience bullets) — including synonyms and close equivalents (e.g. JD "containerization" matches resume "Docker"; JD "unit testing" matches resume "unit-tested REST endpoints"). For every such match, make sure the JD's own wording appears at least once in the tailored bullets or summary, even if that means rephrasing an existing bullet rather than leaving it untouched. Do not skip a true, relevant keyword just because rewording takes effort — but never fabricate one that has no basis anywhere in the resume.
                4. Reorder or re-emphasize bullets within existing sections if it helps relevance — don't restructure the document.
                5. Keep all LaTeX structure, commands, packages, and formatting identical to the source. Only the text content of bullets/summary changes.
                6. Replace the job-title phrase in the Professional Summary. It opens with a bolded title phrase, e.g. \\textbf{Software Engineer} — replace just that phrase's inner text with the target role "%s". If that text is long or awkward inside the sentence, use a concise, natural equivalent instead of pasting it verbatim. Keep the \\textbf{} command itself — only the text inside it changes. Do this on every pass, even if the sentence still reads fine with the old title.

                OUTPUT FORMAT:
                First output the complete tailored LaTeX document, starting at \\documentclass and ending at \\end{document}. No markdown code fences, no commentary before or after it.
                Then, on a new line after \\end{document}, output exactly the marker "=== SKILLS MATCH ===" followed by a JSON array of 15 to 20 strings — pick the 15 to 20 most prominent skills/tools/technologies the job description names (aim for at least 15 whenever the job description names that many), each copied verbatim in the JD's own wording, and each one included only if the candidate's resume reasonably supports it, using a generous, real-world notion of "supports":
                   - Exact matches and close synonyms (per rule 3).
                   - Version/variant specifics of something the resume already shows (JD "Java 17" or "Java 8" matches resume "Java"; JD "React 18" matches resume "React").
                   - Standard ecosystem tooling that goes with a listed technology even if not separately named (JD "Maven" or "Gradle" matches resume "Java"/"Spring Boot"; JD "npm" matches resume "Node.js").
                   - Practices and methodologies clearly implied by the candidate's described work (JD "Agile" or "Scrum" matches a candidate who has shipped iteratively across sprints/features in a team; JD "CI/CD" matches resume "CI/CD" or a pipeline description).
                   - Domain terms implied by what the candidate actually built (JD "payments" or "fintech" matches resume work on a Payment Operations Portal, transactions, settlements, or onboarding/verification flows).
                   - Closely adjacent tools in the same category as something the candidate has used (JD "Angular" matches resume "React" as an equivalent frontend framework — name it as the JD's term, don't relabel it).
                   Never include a JD skill that belongs to a genuinely different, unrelated domain the resume gives no real basis for (e.g. don't claim "Salesforce" or "SAP" from a Java/Spring background with no CRM/ERP work). Among the JD skills that do genuinely match, pick the 15 to 20 most prominent/important ones in the JD, reading the "supports" bullets above generously so you reach at least 15 whenever the JD names enough skills — never output more than 20. Only output fewer than 15 if the JD itself names fewer than 15 skills, or the remainder belong to a genuinely unrelated domain. Do not paraphrase the JD's terms — copy them as written in the job description. Example: === SKILLS MATCH ===\n["Java 17", "Maven", "Agile", "Payments"]
                %s%s
                === JOB ===
                Role: %s
                Company: %s
                %s

                === RESUME ===
                %s""".formatted(role, atsSection, extraSection, role, company, desc, resume);

        try {
            ClaudeCliService.ClaudeResult result = claude.run(prompt, null);
            if (result.exitCode() != 0) {
                String errMsg = !result.stderr().isBlank() ? result.stderr().trim() : result.stdout().trim();
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("ok", false, "error", errMsg));
            }
            String out = result.stdout();
            int docStart = out.indexOf("\\documentclass");
            String endMarker = "\\end{document}";
            int docEnd = out.lastIndexOf(endMarker);
            if (docStart == -1 || docEnd == -1) throw new IllegalStateException("No LaTeX document in response");

            String rawLatex = LatexUtils.sanitizeForAts(out.substring(docStart, docEnd + endMarker.length()));
            LatexPdfService.OnePageResult onePage = latexPdf.enforceOnePage(rawLatex);

            if (onePage.compileFailed()) {
                String msg = "Tailored resume failed to compile — kept your previous version."
                        + (onePage.errorLine() != null ? " (" + onePage.errorLine() + ")" : "");
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("ok", false, "error", msg));
            }

            List<String> skillsMatch = List.of();
            int markerIdx = out.indexOf("=== SKILLS MATCH ===", docEnd);
            if (markerIdx != -1) {
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\[[\\s\\S]*]")
                        .matcher(out.substring(markerIdx));
                if (m.find()) {
                    try {
                        skillsMatch = new com.fasterxml.jackson.databind.ObjectMapper()
                                .readValue(m.group(), new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {});
                    } catch (Exception ignored) {}
                }
            }
            if (skillsMatch.size() > 20) skillsMatch = skillsMatch.subList(0, 20);
            String skillsMatchJson = com.jobtracker.util.JsonColumns.toJson(skillsMatch);

            jdbc.update("UPDATE jobs SET tailored_resume_latex = ?, tailored_skills_match = ?::jsonb, updated_at = NOW() WHERE id = ?",
                    onePage.latex(), skillsMatchJson, id);

            Map<String, Object> response = new java.util.LinkedHashMap<>();
            response.put("ok", true);
            response.put("latex", onePage.latex());
            response.put("pages", onePage.pages());
            response.put("note", onePage.note());
            response.put("skillsMatch", skillsMatch);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("ok", false, "error", "Claude returned an unexpected response."));
        }
    }

    @PostMapping("/{id}/latex")
    public ResponseEntity<Map<String, Object>> saveLatex(@PathVariable int id, @RequestBody Map<String, Object> body) {
        String latex = (String) body.get("latex");
        if (latex == null || latex.isEmpty()) return ResponseEntity.badRequest().body(Map.of("error", "No LaTeX content provided"));

        List<Map<String, Object>> rows = jdbc.query(
                "UPDATE jobs SET tailored_resume_latex = ?, updated_at = NOW() WHERE id = ? RETURNING *",
                rowMapper, latex, id);
        if (rows.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
        return ResponseEntity.ok(Map.of("ok", true, "job", rows.get(0)));
    }
}
