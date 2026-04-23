# Multi-stage build: compile TypeScript from source, then ship
# a clean production image.

# Stage 1: builder
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# Stage 2: production image
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/lib ./lib

ENV PORT=8080
ENV NODE_ENV=production
# FIREBASE_PROJECT_ID and FIREBASE_STORAGE_BUCKET are set at
# deploy time via gcloud run deploy --set-env-vars.

EXPOSE 8080
CMD ["node", "lib/index.js"]