package com.jobtracker.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Allows the Vite dev server (a different origin/port) to call the API
 * during development, and the deployed Netlify frontend (a different origin
 * from the deployed backend) to call it in production. Set FRONTEND_ORIGIN
 * to the Netlify site URL (e.g. https://job-tracker.netlify.app) when the
 * frontend and backend are deployed separately.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        var mapping = registry.addMapping("/api/**")
                .allowedOriginPatterns("http://localhost:*", "http://127.0.0.1:*")
                .allowedMethods("GET", "POST", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");

        String frontendOrigin = System.getenv("FRONTEND_ORIGIN");
        if (frontendOrigin != null && !frontendOrigin.isBlank()) {
            mapping.allowedOriginPatterns("http://localhost:*", "http://127.0.0.1:*", frontendOrigin);
        }
    }
}
