package com.jobtracker.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Unauthenticated endpoint for Render's health checker -- everything else lives under /api/** and requires auth. */
@RestController
public class HealthController {
    @GetMapping("/healthz")
    public String healthz() {
        return "ok";
    }
}
