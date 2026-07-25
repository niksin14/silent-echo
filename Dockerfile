FROM node:20-slim

# Install Python and curl, then download yt-dlp globally
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python-is-python3 ca-certificates curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
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
