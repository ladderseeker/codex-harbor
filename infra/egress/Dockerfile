FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57
WORKDIR /opt/harbor-egress
# Exact dependency version; no project code or credentials are included in this image.
COPY infra/egress/package.json infra/egress/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY infra/egress/policy.mjs infra/egress/proxy.mjs infra/egress/bind.mjs infra/egress/main.mjs infra/egress/healthcheck.mjs infra/egress/resolver.mjs ./
USER 10002:10002
HEALTHCHECK --interval=1s --timeout=2s --start-period=2s --retries=5 CMD ["node", "healthcheck.mjs"]
CMD ["node", "main.mjs"]
