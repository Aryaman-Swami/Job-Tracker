package com.jobtracker.util;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Ports of the LaTeX post-processing helpers from the original server.js. */
public final class LatexUtils {

    private LatexUtils() {}

    public record Block(int start, int end) {}

    public static int findBalancedBraceEnd(String text, int openBraceIdx) {
        int depth = 0;
        for (int i = openBraceIdx; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '{') depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) return i;
            }
        }
        return -1;
    }

    public static List<Block> findCommandBlocks(String text, String command) {
        List<Block> blocks = new ArrayList<>();
        Pattern p = Pattern.compile(Pattern.quote("\\" + command) + "\\s*\\{");
        Matcher m = p.matcher(text);
        while (m.find()) {
            int braceStart = text.indexOf('{', m.start());
            int braceEnd = findBalancedBraceEnd(text, braceStart);
            if (braceEnd == -1) break;
            blocks.add(new Block(m.start(), braceEnd + 1));
        }
        return blocks;
    }

    // Claude-written rewrites often use em/en dashes and arrows that pdflatex's
    // ligature/kerning tables turn into glyphs some ATS parsers can't decode
    // (and multi-hyphen runs like "--"/"---" trigger the same ligature behavior).
    // Normalize those to plain ASCII before compiling/saving.
    public static String sanitizeForAts(String text) {
        return text
                // Model-written LaTeX comments ("% tailored by ...") never reach the PDF but sit in the
                // saved/copied source; drop them. An escaped percent sign is kept.
                .replaceAll("(?m)(?<!\\\\)%.*$", "")
                // Invisible/zero-width characters, soft hyphens and non-breaking spaces some models emit.
                .replaceAll("[\\u200B-\\u200F\\u2060-\\u2064\\uFEFF\\u00AD]", "")
                .replace('\u00A0', ' ')
                .replaceAll("[\\u2018\\u2019]", "'")
                .replaceAll("[\\u201C\\u201D]", "\"")
                .replace("\u2026", "...")
                .replaceAll("[\\u2012-\\u2015\\u2212]", "-")
                .replace("\u2192", " to ")
                .replaceAll("-{2,}", "-")
                .replaceAll("(?m)[ \\t]+$", "");
    }

    public record RemovalResult(String latex, boolean removed, int remaining) {}

    // Removes the last \resumeSubItem{...} bullet from the Achievements section
    // (and any \vspace{} directly preceding it), so a tailored resume that
    // overflows to a second page can be trimmed back down to one.
    /** Cuts the Professional Summary down to its first sentence; returns the input unchanged if it is already one sentence. */
    public static String shortenSummaryToFirstSentence(String latex) {
        int sectionStart = latex.indexOf("\\section{Professional Summary}");
        if (sectionStart == -1) return latex;
        int nextSection = latex.indexOf("\\section{", sectionStart + 1);
        int sectionEnd = nextSection == -1 ? latex.length() : nextSection;
        String section = latex.substring(sectionStart, sectionEnd);
        int open = section.indexOf("\\small{");
        int close = section.lastIndexOf('}');
        if (open == -1 || close <= open) return latex;
        String inner = section.substring(open + "\\small{".length(), close);
        Matcher m = Pattern.compile("[a-z0-9)}]\\.\\s+(?=[A-Z])").matcher(inner);
        if (!m.find()) return latex;
        String first = inner.substring(0, m.start() + 2);
        return latex.substring(0, sectionStart) + section.substring(0, open + "\\small{".length())
                + first + section.substring(close) + latex.substring(sectionEnd);
    }

    public static RemovalResult removeLastAchievement(String latex) {
        int sectionStart = latex.indexOf("\\section{Achievements}");
        if (sectionStart == -1) return new RemovalResult(latex, false, 0);
        int nextSection = latex.indexOf("\\section{", sectionStart + 1);
        int sectionEnd = nextSection == -1 ? latex.length() : nextSection;
        String sectionText = latex.substring(sectionStart, sectionEnd);

        List<Block> items = findCommandBlocks(sectionText, "resumeSubItem");
        if (items.isEmpty()) return new RemovalResult(latex, false, 0);

        Block last = items.get(items.size() - 1);
        int removeStart = last.start();
        String before = sectionText.substring(0, removeStart);
        Matcher vspaceMatch = Pattern.compile("\\\\vspace\\{[^}]*\\}\\s*$").matcher(before);
        if (vspaceMatch.find()) removeStart -= vspaceMatch.group().length();

        int removeEnd = last.end();
        while (removeEnd < sectionText.length() && Character.isWhitespace(sectionText.charAt(removeEnd))) removeEnd++;

        String newSectionText = sectionText.substring(0, removeStart) + sectionText.substring(removeEnd);
        int remaining = findCommandBlocks(newSectionText, "resumeSubItem").size();
        String finalSectionText = remaining == 0 ? "" : newSectionText;

        String newLatex = latex.substring(0, sectionStart) + finalSectionText + latex.substring(sectionEnd);
        return new RemovalResult(newLatex, true, remaining);
    }
}
