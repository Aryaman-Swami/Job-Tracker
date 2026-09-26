# Playwright's own base image ships Chromium (and its Linux deps) preinstalled
# for headless use — the local, headed flow (apply.js / server.js) never
# runs in this image, only the headless remote flow (remote-server.js).
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: skip our own postinstall (`playwright install chrome`) —
# the remote flow uses the base image's bundled headless Chromium instead of
# the "chrome" channel the local, headed flow uses, so there's nothing to
# download here.
RUN npm ci --omit=dev --ignore-scripts

COPY . .

ENV NODE_ENV=production
EXPOSE 5056
CMD ["node", "remote-server.js"]
