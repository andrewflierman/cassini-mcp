# Extends the official LibreChat image with Bun runtime and the Cassini MCP server.
# The MCP server is invoked at runtime by LibreChat via stdio transport.
FROM ghcr.io/danny-avila/librechat:latest

# Switch to root to install packages and Bun.
USER root

# Alpine Linux doesn't include curl or bash by default. Install them.
RUN apk add --no-cache curl bash

# Install Bun to a system-wide location (/usr/local/bin) instead of root home.
# The official installer puts it in ~/.bun/bin, but we'll move it to /usr/local/bin
# so it's accessible to all users.
RUN curl -fsSL https://bun.sh/install | bash && \
    cp /root/.bun/bin/bun /usr/local/bin/bun && \
    chmod +x /usr/local/bin/bun

# Copy the Cassini MCP server source into the image.
# Build context is the repository root (set in docker-compose.yml).
COPY mcp/ /app/mcp-server/

# Install MCP server dependencies using Bun.
RUN cd /app/mcp-server && bun install

# Make the mcp-server directory accessible to the node user.
RUN chown -R node:node /app/mcp-server

# Switch back to the default user (node).
USER node
