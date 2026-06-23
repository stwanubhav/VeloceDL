# Use an official Node.js base image
FROM node:20-bullseye-slim

# Install system dependencies (ffmpeg and python3 are required for yt-dlp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install the latest version of yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set environment to production
ENV NODE_ENV=production
ENV PORT=3000
ENV YT_DLP_PATH=yt-dlp
ENV FFMPEG_PATH=ffmpeg

# Create app directory
WORKDIR /usr/src/app

# Copy dependency mappings and install production packages
COPY package*.json ./
RUN npm ci --only=production

# Copy source code and assets
COPY src/ ./src
COPY public/ ./public

# Expose the application port
EXPOSE 3000

# Command to run the application
CMD [ "node", "src/server.js" ]
