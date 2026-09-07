FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57
RUN apt-get update && apt-get install --no-install-recommends -y git=1:2.39.5-0+deb12u3 python3=3.11.2-1+b1 && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home runner
COPY infra/git/helper.py /opt/harbor/helper.py
USER 10001:10001
ENTRYPOINT ["python3","/opt/harbor/helper.py"]
