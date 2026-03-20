# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /src/modex

COPY package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src

RUN npm ci
RUN npm run build

FROM golang:1.26-bookworm AS sidecar-build
WORKDIR /src/modex/backend/sidecar

COPY backend/sidecar/go.mod backend/sidecar/go.sum ./
RUN go mod download

COPY backend/sidecar ./
RUN CGO_ENABLED=0 go build -o /out/modex-sidecar ./cmd/modex-sidecar

FROM node:22-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive
ENV GOPATH=/go
ENV PATH=/usr/local/go/bin:${PATH}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates caddy curl git openssh-client ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@0.115.0

WORKDIR /workspace/modex

COPY . /workspace/modex
COPY --from=frontend-build /src/modex/node_modules /opt/modex-node_modules
COPY --from=sidecar-build /usr/local/go /usr/local/go
COPY --from=sidecar-build /go/pkg /go/pkg
COPY --from=sidecar-build /out/modex-sidecar /usr/local/bin/modex-sidecar
COPY docker/e2e/Caddyfile /etc/caddy/Caddyfile
COPY docker/e2e/entrypoint.sh /usr/local/bin/modex-e2e-entrypoint

RUN chmod +x /usr/local/bin/modex-e2e-entrypoint /usr/local/bin/modex-sidecar

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/modex-e2e-entrypoint"]
