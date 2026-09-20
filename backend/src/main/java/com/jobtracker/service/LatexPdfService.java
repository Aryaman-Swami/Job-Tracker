package com.jobtracker.service;

import com.jobtracker.util.LatexUtils;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class LatexPdfService {

    public record CompileResult(Integer pages, boolean attempted, boolean compiled, String errorLine, byte[] pdfBytes, String log) {}
    public record OnePageResult(String latex, Integer pages, String note, boolean compileFailed, String errorLine) {}

    private static final String[] CANDIDATE_NAMES = {"pdflatex", "xelatex", "lualatex"};
    private static final String[] KNOWN_DIRS = {
            System.getProperty("user.home") + "\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64",
            "C:\\Program Files\\MiKTeX\\miktex\\bin\\x64",
            "C:\\Program Files\\MiKTeX 2.9\\miktex\\bin\\x64",
    };

    public String resolveLatexBin() {
        for (String name : CANDIDATE_NAMES) {
            try {
                Process p = new ProcessBuilder("where", name).redirectErrorStream(true).start();
                if (p.waitFor(5, TimeUnit.SECONDS) && p.exitValue() == 0) return name;
            } catch (Exception ignored) {}
        }
        for (String dir : KNOWN_DIRS) {
            for (String name : CANDIDATE_NAMES) {
                Path exe = Path.of(dir, name + ".exe");
                if (Files.exists(exe)) return exe.toString();
            }
        }
        return null;
    }

    public CompileResult compilePdfAndCountPages(String latex) {
        String latexBin = resolveLatexBin();
        if (latexBin == null) return new CompileResult(null, false, false, null, null, null);

        String tmpName = "resume_check_" + System.currentTimeMillis() + "_" + Math.abs(new java.util.Random().nextInt());
        Path tmpDir = Path.of(System.getProperty("java.io.tmpdir"));
        Path texPath = tmpDir.resolve(tmpName + ".tex");
        Path logPath = tmpDir.resolve(tmpName + ".log");
        Path pdfPath = tmpDir.resolve(tmpName + ".pdf");

        try {
            Files.writeString(texPath, latex, StandardCharsets.UTF_8);
            Process proc = new ProcessBuilder(latexBin, "-interaction=nonstopmode", "-output-directory", tmpDir.toString(), texPath.toString())
                    .redirectErrorStream(true).start();
            proc.getInputStream().readAllBytes();
            proc.waitFor(60, TimeUnit.SECONDS);

            Integer pages = null;
            String errorLine = null;
            try {
                String log = Files.readString(logPath, StandardCharsets.UTF_8).replaceAll("\n", "");
                Matcher m = Pattern.compile("Output written on .*?\\((\\d+) pages?,").matcher(log);
                if (m.find()) pages = Integer.parseInt(m.group(1));
            } catch (IOException ignored) {}

            boolean compiled = Files.exists(pdfPath);
            if (!compiled) {
                try {
                    String log = Files.readString(logPath, StandardCharsets.UTF_8);
                    Matcher m = Pattern.compile("(?m)^!.*$").matcher(log);
                    if (m.find()) errorLine = m.group();
                } catch (IOException ignored) {}
            }

            return new CompileResult(pages, true, compiled, errorLine, null, null);
        } catch (Exception e) {
            return new CompileResult(null, true, false, e.getMessage(), null, null);
        } finally {
            for (String ext : new String[]{"tex", "pdf", "aux", "log", "out"}) {
                try { Files.deleteIfExists(tmpDir.resolve(tmpName + "." + ext)); } catch (IOException ignored) {}
            }
        }
    }

    // Hard one-page guarantee: compiles the tailored resume, and if it overflows
    // to a second page, trims Achievements bullets (last one first, then both)
    // and recompiles until it fits — or reports that it still doesn't.
    public OnePageResult enforceOnePage(String latex) {
        CompileResult result = compilePdfAndCountPages(latex);
        if (result.attempted() && !result.compiled()) {
            return new OnePageResult(latex, null, null, true, result.errorLine());
        }
        if (result.pages() == null || result.pages() <= 1) {
            return new OnePageResult(latex, result.pages(), null, false, null);
        }

        String current = latex;
        for (int attempt = 1; attempt <= 2; attempt++) {
            LatexUtils.RemovalResult trimmed = LatexUtils.removeLastAchievement(current);
            if (!trimmed.removed()) break;
            current = trimmed.latex();
            result = compilePdfAndCountPages(current);
            if (result.pages() != null && result.pages() <= 1) {
                String note = attempt == 1
                        ? "Removed 1 achievement bullet to keep the resume to one page."
                        : "Removed both achievement bullets to keep the resume to one page.";
                return new OnePageResult(current, result.pages(), note, false, null);
            }
        }

        return new OnePageResult(current, result.pages(), "Resume still exceeds one page after trimming both achievement bullets — please trim manually.", false, null);
    }

    public CompileResult compileToPdfBytes(String latex) {
        String latexBin = resolveLatexBin();
        if (latexBin == null) return new CompileResult(null, false, false, null, null, null);

        String tmpName = "resume_" + System.currentTimeMillis();
        Path tmpDir = Path.of(System.getProperty("java.io.tmpdir"));
        Path texPath = tmpDir.resolve(tmpName + ".tex");
        Path pdfPath = tmpDir.resolve(tmpName + ".pdf");
        Path logPath = tmpDir.resolve(tmpName + ".log");
        Path auxPath = tmpDir.resolve(tmpName + ".aux");

        try {
            Files.writeString(texPath, latex, StandardCharsets.UTF_8);
            Process proc = new ProcessBuilder(latexBin, "-interaction=nonstopmode", "-output-directory", tmpDir.toString(), texPath.toString())
                    .redirectErrorStream(true).start();
            String log = new String(proc.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            proc.waitFor(60, TimeUnit.SECONDS);

            if (proc.exitValue() == 0 && Files.exists(pdfPath)) {
                byte[] pdf = Files.readAllBytes(pdfPath);
                return new CompileResult(null, true, true, null, pdf, log);
            }
            String errorLine = log.lines().filter(l -> l.startsWith("!")).findFirst().orElse(null);
            return new CompileResult(null, true, false, errorLine, null, log);
        } catch (Exception e) {
            return new CompileResult(null, true, false, e.getMessage(), null, null);
        } finally {
            for (Path p : new Path[]{texPath, pdfPath, logPath, auxPath}) {
                try { Files.deleteIfExists(p); } catch (IOException ignored) {}
            }
        }
    }
}
