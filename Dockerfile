# ==============================================================================
# Stage 1: Build Vite / TypeScript Frontend
# ==============================================================================
FROM node:22-alpine AS frontend-builder
WORKDIR /app/web

COPY web/package*.json ./
RUN npm install

COPY web/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Python Backend Runtime
# ==============================================================================
FROM python:3.12-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OP25TAP_DATA_DIR=/app/data

# Install Python requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY api/ ./api/
COPY db/ ./db/
COPY ingest/ ./ingest/
COPY config/ ./config/

# Copy compiled frontend assets from Stage 1
COPY --from=frontend-builder /app/web/dist ./web/dist

# Create persistent data directory
RUN mkdir -p /app/data/db

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
