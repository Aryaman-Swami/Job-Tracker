package com.jobtracker.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * Allows the Vite dev server (a different origin/port) to call the API
 * during development, and the deployed Netlify frontend (a different origin
 * from the deployed backend) to call it directly in production (some
 * endpoints bypass the Netlify /api/* proxy — see frontend/src/api.js —
 * since Claude-CLI/LaTeX calls can outlast Netlify's proxy timeout). Set
 * FRONTEND_ORIGIN to the Netlify site URL (e.g. https://job-tracker.netlify.app)
 * when the frontend and backend are deployed separately.
 *
 * Exposed as an explicit CorsConfigurationSource bean (rather than just a
 * WebMvcConfigurer#addCorsMappings) so SecurityConfig's http.cors(...) picks
 * it up too — Spring Security's filter chain runs before Spring MVC's own
 * CORS handling, so without this, cross-origin preflight (OPTIONS) requests
 * were being rejected by Security itself (403) before ever reaching MVC.
 */
@Configuration
public class WebConfig {
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(List.of("http://localhost:*", "http://127.0.0.1:*"));
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));

        String frontendOrigin = System.getenv("FRONTEND_ORIGIN");
        if (frontendOrigin != null && !frontendOrigin.isBlank()) {
            config.setAllowedOriginPatterns(List.of("http://localhost:*", "http://127.0.0.1:*", frontendOrigin));
        }

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }
}
