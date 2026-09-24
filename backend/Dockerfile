# Multi-stage build: compile the jar, then assemble a runtime image that also
# has pdflatex (for resume PDF export) and the Claude Code CLI (for the
# "Tailor with Claude" feature) available on PATH.
#
# Build context is the REPO ROOT (Render's Docker runtime always builds from
# the repo root regardless of dockerfilePath), so every COPY below is
# rooted at backend/, not at this Dockerfile's own directory.

FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY backend/pom.xml .
RUN mvn -B -q dependency:go-offline
COPY backend/src ./src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

# Node.js (for the Claude Code CLI), TeX Live (for pdflatex), and python3
# (used by the optional /api/sync "run scraper now" button).
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl gnupg python3 python3-pip \
      texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/job-tracker-backend.jar ./app.jar
EXPOSE 3000
ENTRYPOINT ["java", "-jar", "app.jar"]
