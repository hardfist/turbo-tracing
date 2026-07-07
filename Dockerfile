FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl nodejs npm \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@11.8.0 \
  && pnpm install --prod --frozen-lockfile
COPY . .
RUN mkdir -p /data && chown -R nobody:nogroup /data /app
USER nobody
EXPOSE 3000
CMD ["node", "src/server.js"]
