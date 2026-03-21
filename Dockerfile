# Stage 1: Build frontend static files
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend with Playwright + serve frontend
FROM mcr.microsoft.com/playwright:v1.42.1-jammy
WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --only=production

# Copy backend source
COPY backend/src/ ./src/

# Copy built frontend static files
COPY --from=frontend-build /app/frontend/out ../frontend/out

# Create data directory for SQLite
RUN mkdir -p ./data

EXPOSE 4000

CMD ["node", "src/server.js"]
