package com.jobtracker.controller;

import com.jobtracker.service.SyncService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/sync")
public class SyncController {

    private final SyncService syncService;
    private final String cronToken = System.getenv("SYNC_CRON_TOKEN");

    public SyncController(SyncService syncService) {
        this.syncService = syncService;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> sync() {
        Map<String, Object> result = syncService.runSync();
        if (Boolean.TRUE.equals(result.get("ok"))) {
            return ResponseEntity.ok(result);
        }
        return ResponseEntity.status(500).body(result);
    }

    /**
     * Unauthenticated GET for an external cron pinger (e.g. cron-job.org) to hit on a
     * schedule, since it can't hold a JWT that expires daily. Guarded by a static
     * shared-secret token instead of the normal login flow.
     */
    @GetMapping("/cron")
    public ResponseEntity<Map<String, Object>> cronSync(@RequestParam(name = "token", required = false) String token) {
        if (cronToken == null || cronToken.isBlank() || !cronToken.equals(token)) {
            return ResponseEntity.status(401).body(Map.of("ok", false, "message", "Invalid or missing token"));
        }
        Map<String, Object> result = syncService.runSync();
        if (Boolean.TRUE.equals(result.get("ok"))) {
            return ResponseEntity.ok(result);
        }
        return ResponseEntity.status(500).body(result);
    }
}
