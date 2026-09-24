package com.jobtracker.controller;

import com.jobtracker.config.JwtService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    public record LoginRequest(String username, String password) {}

    @Value("${app.security.username}")
    private String expectedUsername;

    private final String expectedPasswordHash;
    private final PasswordEncoder encoder;
    private final JwtService jwtService;

    public AuthController(PasswordEncoder encoder, JwtService jwtService,
                           @Value("${app.security.password}") String expectedPassword) {
        this.encoder = encoder;
        this.jwtService = jwtService;
        if (expectedPassword == null || expectedPassword.isBlank()) {
            throw new IllegalStateException(
                    "APP_PASSWORD environment variable must be set (no default password is provided for security).");
        }
        this.expectedPasswordHash = encoder.encode(expectedPassword);
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody LoginRequest req) {
        boolean ok = req != null
                && expectedUsername.equals(req.username())
                && req.password() != null
                && encoder.matches(req.password(), expectedPasswordHash);

        if (!ok) {
            return ResponseEntity.status(401).body(Map.of("ok", false, "message", "Invalid username or password"));
        }

        String token = jwtService.issueToken(expectedUsername);
        return ResponseEntity.ok(Map.of("ok", true, "token", token, "expiresInMs", jwtService.expiryMillis()));
    }
}
