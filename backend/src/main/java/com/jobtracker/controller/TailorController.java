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

                STEP 0 - KEYWORD EXTRACTION (do this silently and briefly, no written output):
                Read the job description and list EVERY ATS keyword in it: hard skills, languages, frameworks, tools, platforms, cloud services, databases, methodologies (Agile, Scrum, TDD, CI/CD), domain terms, job titles, certifications, degrees, and recurring soft-skill phrases (e.g. "cross-functional collaboration"). Record each one EXACTLY as the JD writes it (spelling, casing, hyphenation). When the JD gives an acronym, its expansion, or both, plan to use both forms together on first use, e.g. "CI/CD (Continuous Integration/Continuous Delivery)", "RBAC (Role-Based Access Control)". For each keyword decide: PLACE (true of the candidate directly, or by a close/adjacent equivalent) or GAP (no honest basis anywhere in the resume).

                STRICT RULES:
                1. HARD CONSTRAINT: the result must still fit on ONE page with identical LaTeX structure. Do NOT add sections or new bullet points. You may lengthen or shorten existing bullets as needed to fit keywords, but keep each bullet to at most about 1.15x its original length and the total word count within about +8%% of the original, trimming filler words elsewhere to compensate. Never drop a metric or fact to make room for a keyword; trim connective filler instead.
                2. HONESTY: never invent experience, employers, metrics, dates, titles, degrees, certifications, or tools the candidate has no basis for. Every change must stay true. A keyword with no honest basis is a GAP: do not insert it anywhere, report it instead.
                3. MAXIMISE VERBATIM KEYWORD USE. For every PLACE keyword, the JD's exact wording (its spelling and casing, not a synonym) must appear at least once in the resume (summary, bullets, or skills). Put the highest-priority keywords (in the title, in the requirements, or repeated in the JD) in both the summary and a bullet. Where the candidate used a close equivalent, use the JD's term when it is truthfully the same thing (resume "Docker" with JD "containerization" -> "containerization with Docker"; resume "unit-tested endpoints" with JD "unit testing" -> "unit testing"). Keep the candidate's real tool name next to the JD term when they differ.
                4. SKILLS SECTION: rewrite the Skills lines so they list EVERY JD tool, language, framework, platform, and methodology the candidate plausibly has or has working familiarity with (same ecosystem, same category, or standard companion tooling: JD "Maven", "Gradle", "JUnit" with a Java/Spring candidate; "npm" with Node.js; "Jenkins" or "GitHub Actions" with CI/CD; "Agile" or "Scrum" with team sprint delivery; "microservices", "REST", "SQL" with the existing backend work). Use the JD's exact spelling and the acronym + expanded form. Keep existing skills the JD does not mention only if space allows, dropping the least relevant first. Keep one \\item per category line; you may rename category labels to the JD's terms. Do not list skills from an unrelated domain with no basis.
                5. ADJACENT TECHNOLOGY: when the JD names a technology adjacent to one the candidate used, use accurate phrasing that still carries the JD keyword, and never claim the specific unused product. Generic category terms from the JD are fair game when the candidate used a member of the category (JD "message brokers" or "event streaming" with Kafka/Azure Service Bus; JD "NoSQL" with MongoDB; JD "relational databases" with PostgreSQL/Oracle; JD "cloud-native" with Kubernetes/Azure). Do not claim RabbitMQ, Angular, Terraform, etc. unless the resume shows them.
                6. SUMMARY: rewrite the Professional Summary (single paragraph, about the same length) so it contains the JD's top 6-10 keywords and the JD's job-title phrase. It opens with a bolded title phrase, e.g. \\textbf{Software Engineer}: replace just that phrase's inner text with the target role "%s", or a concise natural equivalent if it is long or awkward. Keep the \\textbf{} command. Do this on every pass.
                7. Reorder bullets within a section, or items within a Skills line, to put the most JD-relevant first. Do not restructure the document.
                8. Keep all LaTeX structure, commands, packages, and formatting identical to the source. Only text (summary, bullets, skills items, project tech lists) changes. No tables, columns, icons, arrows, em/en dashes, or other non-ASCII symbols; plain ASCII only.
                9. Do ONE quick self-check at the end: every PLACE keyword appears verbatim and the length limits hold. Fix any miss in the same pass. Do not draft the document more than once and do not write out your analysis.

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
                Finally, on a new line after the skills JSON, output exactly the marker "=== KEYWORD COVERAGE ===" followed by one JSON object: {"total": <number of JD keywords you extracted>, "placed": [<keywords used verbatim in your resume>], "gaps": [<keywords with no honest basis, NOT inserted>], "coverage_pct": <integer: placed divided by (placed + gaps), times 100>}. Be accurate, this is checked against the resume text.
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
            // Keyword coverage report: Claude self-reports placed/gaps; we re-verify the
            // "placed" list against the final LaTeX text so the number can't be inflated.
            Map<String, Object> coverage = new java.util.LinkedHashMap<>();
            int covIdx = out.indexOf("=== KEYWORD COVERAGE ===", docEnd);
            if (covIdx != -1) {
                java.util.regex.Matcher cm = java.util.regex.Pattern.compile("\\{[\\s\\S]*}")
                        .matcher(out.substring(covIdx));
                if (cm.find()) {
                    try {
                        Map<String, Object> parsed = new com.fasterxml.jackson.databind.ObjectMapper()
                                .readValue(cm.group(), new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
                        List<String> placed = parsed.get("placed") instanceof List<?> pl
                                ? pl.stream().map(String::valueOf).toList() : List.of();
                        List<String> gaps = parsed.get("gaps") instanceof List<?> gl
                                ? gl.stream().map(String::valueOf).toList() : List.of();
                        String hay = onePage.latex().replace("\\textbf{", "").replace("\\mbox{", "")
                                .replace("}", "").toLowerCase();
                        List<String> verified = new java.util.ArrayList<>();
                        List<String> missed = new java.util.ArrayList<>();
                        for (String k : placed) {
                            (hay.contains(k.toLowerCase()) ? verified : missed).add(k);
                        }
                        int denom = verified.size() + missed.size() + gaps.size();
                        coverage.put("placed", verified);
                        coverage.put("claimedButNotFound", missed);
                        coverage.put("gaps", gaps);
                        coverage.put("coveragePct", denom == 0 ? 0 : Math.round(100f * verified.size() / denom));
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
            if (!coverage.isEmpty()) response.put("keywordCoverage", coverage);
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
