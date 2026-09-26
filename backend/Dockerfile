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

# Node.js (for the Claude Code CLI), TeX Live (for pdflatex, incl. the Lato
# font package used by resume.tex), and python3 (used by the optional
# /api/sync "run scraper now" button).
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl gnupg python3 python3-pip \
      texlive-latex-base texlive-latex-recommended texlive-latex-extra \
      texlive-fonts-recommended texlive-fonts-extra \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Scraper lives at /scraper so SyncService's "<app cwd>/../scraper" path
# resolves the same way it does in local dev (backend/ and scraper/ as siblings).
COPY scraper /scraper
RUN pip3 install --no-cache-dir -r /scraper/requirements.txt

COPY --from=build /app/target/job-tracker-backend.jar ./app.jar

# One-time seed for the base-resume DB migration (DbInitializer copies this
# into the settings table on first boot if it's empty); the app reads/writes
# the DB from then on, not this file.
COPY resume.tex /resume.tex

# claude CLI refuses --dangerously-skip-permissions when running as root, so
# the app must run as an unprivileged user.
RUN useradd --create-home --home-dir /home/appuser --shell /bin/bash appuser \
    && chown -R appuser:appuser /app /scraper
USER appuser
ENV HOME=/home/appuser

EXPOSE 3000
ENTRYPOINT ["java", "-Djdk.tls.client.protocols=TLSv1.2", "-jar", "app.jar"]
