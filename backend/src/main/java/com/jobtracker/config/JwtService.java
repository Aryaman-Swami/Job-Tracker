package com.jobtracker.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

/**
 * Issues and verifies the login session token. Signing key comes from
 * JWT_SECRET if set (so tokens survive a redeploy); otherwise a random key
 * is generated per process start, which just means everyone has to log in
 * again after a restart -- fine for a single-user app.
 */
@Component
public class JwtService {

    private static final Duration EXPIRY = Duration.ofDays(1);

    private final SecretKey key;

    public JwtService() {
        String secret = System.getenv("JWT_SECRET");
        this.key = (secret != null && !secret.isBlank())
                ? Keys.hmacShaKeyFor(secret.getBytes(java.nio.charset.StandardCharsets.UTF_8))
                : Jwts.SIG.HS256.key().build();
    }

    public String issueToken(String username) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(username)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(EXPIRY)))
                .signWith(key)
                .compact();
    }

    public long expiryMillis() {
        return EXPIRY.toMillis();
    }

    /** Returns the username if the token is valid and unexpired, otherwise null. */
    public String verifyAndGetUsername(String token) {
        try {
            Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
            return claims.getSubject();
        } catch (JwtException | IllegalArgumentException e) {
            return null;
        }
    }
}
