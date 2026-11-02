FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-noto-cjk openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
