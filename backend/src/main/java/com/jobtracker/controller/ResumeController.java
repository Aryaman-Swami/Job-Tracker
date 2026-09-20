package com.jobtracker.controller;

import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

@RestController
@RequestMapping("/api/resume")
public class ResumeController {

    // Same file the LaTeX skills tailor/compile — kept at the project root
    // so `resume.tex` continues to be the single base resume everything reads from.
    private static final Path RESUME_PATH = Path.of(System.getProperty("user.dir"), "..", "resume.tex").normalize();

    @GetMapping
    public Map<String, Object> get() {
        try {
            String content = Files.readString(RESUME_PATH, StandardCharsets.UTF_8);
            return Map.of("content", content);
        } catch (IOException e) {
            return Map.of("content", "");
        }
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody Map<String, Object> body) throws IOException {
        String content = body.get("content") == null ? "" : String.valueOf(body.get("content"));
        Files.writeString(RESUME_PATH, content, StandardCharsets.UTF_8);
        return Map.of("ok", true);
    }
}
