# syntax=docker/dockerfile:1
FROM node:24.20.0-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8766 \
    DATA_DIR=/data
WORKDIR /app

# 새 영속 볼륨의 권한을 준비한 뒤 애플리케이션은 node 사용자로 실행한다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY server/ ./server/
COPY index.html ./index.html
COPY games/ ./games/
COPY community/ ./community/
COPY assets/ ./assets/
RUN <<'SHELL'
set -eu
mkdir -p /data
chown node:node /data
chmod 0700 /data
cat > /usr/local/bin/community-entrypoint <<'SCRIPT'
#!/bin/sh
set -eu
if [ "$(id -u)" = 0 ]; then
  if [ "${DATA_DIR:-/data}" != /data ]; then
    printf '%s\n' '운영 데이터 경로는 /data여야 합니다.' >&2
    exit 1
  fi
  chown node:node /data
  chmod 0700 /data
  exec gosu node "$@"
fi
exec "$@"
SCRIPT
chmod 0755 /usr/local/bin/community-entrypoint
SHELL

EXPOSE 8766
STOPSIGNAL SIGTERM
ENTRYPOINT ["community-entrypoint"]
CMD ["node", "server/index.js"]
