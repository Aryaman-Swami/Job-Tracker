package com.jobtracker.controller;

import com.jobtracker.service.LatexPdfService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/pdf")
public class PdfController {

    private final LatexPdfService latexPdf;

    public PdfController(LatexPdfService latexPdf) {
        this.latexPdf = latexPdf;
    }

    @PostMapping
    public ResponseEntity<?> generate(@RequestBody Map<String, Object> body) {
        String latex = (String) body.get("latex");
        String filename = body.get("filename") != null ? String.valueOf(body.get("filename")) : "tailored_resume";
        if (latex == null || latex.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No LaTeX content provided"));
        }

        if (latexPdf.resolveLatexBin() == null) {
            return ResponseEntity.status(500).body(Map.of("error", "No LaTeX compiler found. Install MiKTeX from https://miktex.org/download and restart the server."));
        }

        LatexPdfService.CompileResult result = latexPdf.compileToPdfBytes(latex);
        if (result.compiled() && result.pdfBytes() != null) {
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_PDF)
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + filename + ".pdf\"")
                    .body(result.pdfBytes());
        }

        String error = result.errorLine() != null
                ? "LaTeX compilation failed: " + result.errorLine().replaceFirst("^!\\s*", "")
                : "LaTeX compilation failed.";
        return ResponseEntity.status(500).body(Map.of("error", error, "log", result.log() == null ? "" : result.log()));
    }
}
