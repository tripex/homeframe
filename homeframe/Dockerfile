# Homeframe add-on image.
#
# The Supervisor builds an add-on with only this folder as the build
# context, so the repository root (packages/, apps/, catalog/) cannot be
# COPY'd. Instead the build clones the Homeframe source at the git tag that
# matches the add-on version (v<version> from config.yaml, passed by the
# Supervisor as BUILD_VERSION). Every add-on version therefore builds exactly
# one released source tree, and updating the add-on means bumping
# config.yaml and tagging that commit.
#
# HOMEFRAME_REF overrides the ref (a branch or tag) for local testing:
#   docker build --build-arg BUILD_VERSION=0.3.0 --build-arg HOMEFRAME_REF=main homeframe/

FROM node:22-alpine AS build
ARG BUILD_VERSION
ARG HOMEFRAME_REF=""
ARG HOMEFRAME_REPOSITORY=https://github.com/tripex/homeframe.git

RUN apk add --no-cache git
WORKDIR /src
RUN ref="${HOMEFRAME_REF:-v${BUILD_VERSION}}" \
    && echo "Building Homeframe from ${HOMEFRAME_REPOSITORY} at ${ref}" \
    && git clone --depth 1 --branch "${ref}" "${HOMEFRAME_REPOSITORY}" .

RUN npm install --no-audit --no-fund \
    && npm run build \
    && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.name="Homeframe" \
  io.hass.description="Calm, AI-first dashboards for wall tablets" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="aarch64|amd64" \
  org.opencontainers.image.source="https://github.com/tripex/homeframe"

ENV NODE_ENV=production \
    HOMEFRAME_ROOT=/opt/homeframe \
    HOMEFRAME_DATA_DIR=/data \
    HOMEFRAME_ASSETS_DIR=/config \
    HOMEFRAME_PORT=8099

WORKDIR /opt/homeframe
# Workspace packages are symlinked from node_modules/@homeframe, so the
# packages/ folder must sit next to node_modules exactly as in the build.
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages ./packages
COPY --from=build /src/apps/dashboard/package.json ./apps/dashboard/package.json
COPY --from=build /src/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build /src/catalog ./catalog
COPY --from=build /src/schemas ./schemas
COPY --from=build /src/AGENTS.md /src/homeframe.agent.json ./

CMD ["node", "packages/runtime/dist/server.js"]
