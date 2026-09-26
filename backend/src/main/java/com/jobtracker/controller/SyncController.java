package com.jobtracker.controller;

import com.jobtracker.service.SyncService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/sync")
public class SyncController {

    private final SyncService syncService;

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
}
