# Multi-stage build for production

# --- Frontend build ---
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Backend build ---
FROM node:20-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

# --- Production image ---
FROM node:20-alpine AS production
WORKDIR /app

RUN apk add --no-cache tini

COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev

COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=256
ENV PORT=3001
ENV HOST=0.0.0.0
ENV FRONTEND_DIST=../frontend/dist

EXPOSE 3001

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/dist/index.js"]
