FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-noto-cjk fonts-texgyre curl ca-certificates openssl poppler-utils && rm -rf /var/lib/apt/lists/* \
 # DCiT fonts: Thai Sarabun (Google Fonts); Helvetica renders as TeX Gyre Heros (metric-compatible clone) when converting to PDF
 && mkdir -p /usr/share/fonts/truetype/sarabun \
 && for w in Regular Bold Italic BoldItalic; do curl -fsSL "https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-$w.ttf" -o /usr/share/fonts/truetype/sarabun/Sarabun-$w.ttf; done \
 && fc-cache -f
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
