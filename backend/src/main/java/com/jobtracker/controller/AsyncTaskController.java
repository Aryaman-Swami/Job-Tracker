package com.jobtracker.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

/**
 * Runs the long Claude-backed endpoints (tailor, ATS score, HackerRank score)
 * in the background so the browser doesn't have to hold one HTTP connection
 * open for up to 5 minutes — mobile browsers kill that connection when the
 * screen turns off. The client starts a task, then polls for the result and
 * can resume polling after the screen comes back on.
 */
@RestController
@RequestMapping("/api/async")
public class AsyncTaskController {

    private static final long TTL_MS = 30 * 60 * 1000L;

    private record Task(long createdAt, boolean done, int status, Map<String, Object> body) {}

    private final Map<String, Task> tasks = new ConcurrentHashMap<>();
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    private final TailorController tailor;
    private final AtsScoreController ats;
    private final HackerRankController hackerRank;

    public AsyncTaskController(TailorController tailor, AtsScoreController ats, HackerRankController hackerRank) {
        this.tailor = tailor;
        this.ats = ats;
        this.hackerRank = hackerRank;
    }

    @PostMapping("/tailor/{id}")
    public Map<String, Object> startTailor(@PathVariable int id, @RequestBody(required = false) Map<String, Object> body) {
        return start(() -> tailor.tailor(id, body));
    }

    @PostMapping("/ats-score/{id}")
    public Map<String, Object> startAts(@PathVariable int id) {
        return start(() -> ats.score(id));
    }

    @PostMapping("/hackerrank-score/{id}")
    public Map<String, Object> startHackerRank(@PathVariable int id) {
        return start(() -> hackerRank.score(id));
    }

    @GetMapping("/task/{taskId}")
    public ResponseEntity<Map<String, Object>> status(@PathVariable String taskId) {
        Task t = tasks.get(taskId);
        if (t == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Task not found or expired"));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("done", t.done());
        if (t.done()) {
            res.put("status", t.status());
            res.put("body", t.body());
        }
        return ResponseEntity.ok(res);
    }

    private Map<String, Object> start(Supplier<ResponseEntity<Map<String, Object>>> work) {
        long now = System.currentTimeMillis();
        tasks.values().removeIf(t -> now - t.createdAt() > TTL_MS);

        String taskId = UUID.randomUUID().toString();
        tasks.put(taskId, new Task(now, false, 0, null));
        pool.submit(() -> {
            Task finished;
            try {
                ResponseEntity<Map<String, Object>> r = work.get();
                finished = new Task(now, true, r.getStatusCode().value(), r.getBody());
            } catch (Exception e) {
                finished = new Task(now, true, 500, Map.of("ok", false, "error", "Task failed unexpectedly."));
            }
            tasks.put(taskId, finished);
        });
        return Map.of("taskId", taskId);
    }
}
