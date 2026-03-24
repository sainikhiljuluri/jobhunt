# Stage 1: Build frontend static files
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend + Python + serve frontend
FROM node:20-slim
WORKDIR /app

# Install Python 3 + pip
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY python/requirements.txt /app/python/requirements.txt
RUN python3 -m venv /app/python/venv && \
    /app/python/venv/bin/pip install --no-cache-dir -r /app/python/requirements.txt

ENV PYTHON_BIN=/app/python/venv/bin/python3

# Copy Python scraper
COPY python/ /app/python/

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --only=production --ignore-scripts && \
    npm rebuild better-sqlite3

# Copy backend source (includes src/data/*.json)
COPY backend/src/ ./src/

# Copy built frontend static files
COPY --from=frontend-build /app/frontend/out ../frontend/out

# Create data directory for SQLite
RUN mkdir -p ./data

ENV SKIP_BROWSER_SCRAPERS=true
EXPOSE 4000

CMD ["node", "src/server.js"]
