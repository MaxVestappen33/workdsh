# Supply a reviewed Node 22/24 Debian image by digest; no local proof image dependency.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
USER root
ARG NODE_IMAGE
RUN case "$NODE_IMAGE" in *@sha256:*) ;; *) exit 1 ;; esac
RUN node -e "const [a,b]=process.versions.node.split('.').map(Number);if(!((a===22&&b>=19)||a>=24))process.exit(1)"
RUN apt-get update && apt-get install -y --no-install-recommends iptables util-linux ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/workdsh/profiles/enterprise
COPY package.json package-lock.json ./
COPY artifacts ./artifacts
COPY audit-runtime.mjs /server/audit-runtime.mjs
RUN npm ci --omit=dev --no-audit --no-fund && node /server/audit-runtime.mjs /opt/workdsh/profiles/enterprise && chmod -R a-w . && mkdir -p /run/secrets && chmod 700 /run/secrets
COPY probe-native-runtime.mjs session-bridge.mjs start.mjs gateway.mjs profile.mjs environment.mjs account-storage-fence.mjs user-entry.html shared-entry-client.js workdsh-features.json /server/
ENV WORKDSH_PORT=8080
EXPOSE 8080
ENTRYPOINT ["node", "/server/start.mjs"]
