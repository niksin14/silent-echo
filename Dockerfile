FROM node:20-slim

# Install Python (required for running yt-dlp on Linux)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose port and configure environment
ENV PORT=3000
EXPOSE 3000

# Run the app
CMD ["node", "server.js"]
