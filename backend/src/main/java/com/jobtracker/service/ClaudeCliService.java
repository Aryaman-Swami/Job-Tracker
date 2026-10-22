package com.jobtracker.service;

import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Shells out to the local `claude` CLI, exactly like the original Node app's spawn() calls. */
@Service
public class ClaudeCliService {

    public record ClaudeResult(int exitCode, String stdout, String stderr) {}

    public ClaudeResult run(String prompt, String appendSystemPrompt) throws IOException, InterruptedException {
        List<String> cmd = new ArrayList<>(List.of(
                "claude", "--print", "--dangerously-skip-permissions", "--disable-slash-commands",
                "--safe-mode", "--tools", "", "--model", "sonnet", "--no-session-persistence",
                "--effort", System.getenv().getOrDefault("CLAUDE_EFFORT", "medium")));
        if (appendSystemPrompt != null) {
            cmd.add("--append-system-prompt");
            cmd.add(appendSystemPrompt);
        }

        ProcessBuilder pb = new ProcessBuilder(cmd);
        // A pasted-from-terminal token in Render's env var UI can carry an invisible
        // trailing newline/whitespace, which silently breaks the Authorization header
        // and shows up as a 401 "Invalid bearer token" — trim defensively here so a
        // dashboard paste mistake can't reproduce that.
        trimIfPresent(pb.environment(), "CLAUDE_CODE_OAUTH_TOKEN");
        trimIfPresent(pb.environment(), "ANTHROPIC_API_KEY");
        Process proc = pb.start();

        Thread writer = new Thread(() -> {
            try (var out = proc.getOutputStream()) {
                out.write(prompt.getBytes(StandardCharsets.UTF_8));
            } catch (IOException ignored) {}
        });
        writer.start();

        StringBuilder out = new StringBuilder();
        StringBuilder err = new StringBuilder();
        Thread stdoutReader = new Thread(() -> readInto(proc.getInputStream(), out));
        Thread stderrReader = new Thread(() -> readInto(proc.getErrorStream(), err));
        stdoutReader.start();
        stderrReader.start();

        boolean finished = proc.waitFor(300, TimeUnit.SECONDS);
        writer.join(1000);
        stdoutReader.join(2000);
        stderrReader.join(2000);
        if (!finished) {
            proc.destroyForcibly();
            return new ClaudeResult(-1, out.toString(), "Claude CLI timed out after 300s");
        }

        return new ClaudeResult(proc.exitValue(), out.toString(), err.toString());
    }

    private static void trimIfPresent(java.util.Map<String, String> env, String key) {
        String value = env.get(key);
        if (value != null) env.put(key, value.trim());
    }

    private static void readInto(java.io.InputStream in, StringBuilder sb) {
        try {
            sb.append(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException ignored) {}
    }
}
