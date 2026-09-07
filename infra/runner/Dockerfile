FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57
RUN npm install --global @openai/codex@0.153.4 && useradd --uid 10001 --create-home runner && mkdir -p /home/runner/.codex && chown -R 10001:10001 /home/runner
USER 10001:10001
WORKDIR /workspace
ENV CODEX_HOME=/home/runner/.codex
ENTRYPOINT []
CMD ["codex", "app-server", "--listen", "stdio://"]
