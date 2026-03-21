# Stage 1: Build frontend static files
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend + serve frontend (no Playwright - saves 1GB+ image size)
FROM node:20-slim
WORKDIR /app

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
