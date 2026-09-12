FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57
WORKDIR /opt/harbor
RUN npm install --ignore-scripts --omit=dev --no-audit --no-fund ws@8.18.3 && useradd --uid 10003 --create-home relay
COPY infra/previews/relay.ts infra/previews/protocol.ts ./infra/previews/
COPY packages/previews/src/http-policy.ts ./packages/previews/src/
USER 10003:10003
ENTRYPOINT ["node","--disable-warning=ExperimentalWarning","/opt/harbor/infra/previews/relay.ts"]
