package com.jobtracker.service;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Reads the compiled resume PDF the way an ATS parser does (its embedded text
 * layer, not the rendered page) and reports what a parser would actually see.
 * Pure Java (PDFBox), no external binary, and no Claude call, so it is cheap.
 */
@Service
public class PdfTextCheckService {

    public record Check(String name, boolean ok, String detail) {}

    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");
    private static final Pattern PHONE = Pattern.compile("\\+?\\d[\\d\\s().-]{8,}\\d");
    // U+FFFD, private-use area (icon-font glyphs), and control characters other than whitespace.
    private static final Pattern GARBLED = Pattern.compile("[\\uFFFD\\uE000-\\uF8FF\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]");
    private static final String[] SECTION_ORDER = {"summary", "skills", "experience", "projects", "education"};

    public Map<String, Object> analyze(byte[] pdf, List<String> keywords) throws Exception {
        String text;
        int pages;
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            pages = doc.getNumberOfPages();
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(false); // content-stream order = what most parsers read
            text = stripper.getText(doc);
        }
        String lower = text.toLowerCase(Locale.ROOT);

        List<Check> checks = new ArrayList<>();
        boolean hasText = text.strip().length() > 200;
        checks.add(new Check("Text layer present", hasText,
                hasText ? text.strip().length() + " characters extracted"
                        : "Almost no text extracted: a parser would see a blank or image-only resume"));
        boolean email = EMAIL.matcher(text).find();
        checks.add(new Check("Email readable", email, email ? "Found as plain text" : "No email address in the text layer"));
        boolean phone = PHONE.matcher(text).find();
        checks.add(new Check("Phone readable", phone, phone ? "Found as plain text" : "No phone number in the text layer"));
        long garbled = GARBLED.matcher(text).results().count();
        checks.add(new Check("No garbled glyphs", garbled == 0,
                garbled == 0 ? "Clean" : garbled + " unreadable characters (icon fonts or bad encoding)"));

        // Section headings should appear in a sane reading order.
        int last = -1;
        boolean ordered = true;
        List<String> found = new ArrayList<>();
        String[] lines = lower.split("\\R");
        for (String s : SECTION_ORDER) {
            // Only short, heading-like lines count, so body text mentioning "experience" doesn't match.
            int idx = -1;
            for (int i = 0; i < lines.length; i++) {
                String ln = lines[i].strip();
                if (ln.length() <= 40 && ln.contains(s)) { idx = i; break; }
            }
            if (idx < 0) continue;
            found.add(s);
            if (idx < last) ordered = false;
            last = Math.max(last, idx);
        }
        checks.add(new Check("Reading order", ordered && !found.isEmpty(),
                found.isEmpty() ? "No standard section headings found"
                        : ordered ? "Sections read in order: " + String.join(" > ", found)
                        : "Sections appear out of order in the text layer"));

        List<String> readable = new ArrayList<>();
        List<String> unreadable = new ArrayList<>();
        // Normalise whitespace so line-wraps inside a phrase don't cause false misses.
        String flat = lower.replaceAll("\\s+", " ");
        for (String k : keywords) {
            if (k == null || k.isBlank()) continue;
            String kk = k.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").strip();
            (flat.contains(kk) ? readable : unreadable).add(k);
        }

        boolean allOk = checks.stream().allMatch(Check::ok);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("passed", allOk);
        out.put("pages", pages);
        out.put("checks", checks);
        out.put("keywords_in_pdf", readable);
        // Matched by the ATS score but absent from the PDF text: a parser can't see them.
        out.put("keywords_lost_in_pdf", unreadable);
        return out;
    }
}
