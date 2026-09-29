# Hosted / reproducible run: Node 22 + Python (librosa) + Chromium + FFmpeg (bundled via ffmpeg-static)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip chromium fonts-liberation fonts-noto-color-emoji libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json requirements.txt ./
RUN npm ci --omit=dev && python3 -m venv .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt
COPY . .
ENV CHROME_PATH=/usr/bin/chromium HOST=0.0.0.0 PORT=4377 PROJECTS_DIR=/data/projects NO_OPEN=1
VOLUME /data
EXPOSE 4377
# APP_PASSWORD and FAL_KEY must be provided at run time:  docker run -p 4377:4377 -e APP_PASSWORD=... -e FAL_KEY=... -v studio-data:/data animation-studio
CMD ["node", "server/index.js"]
