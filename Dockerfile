# Dockerfile
FROM node:18-slim

# Install Lua 5.1
RUN apt-get update && apt-get install -y lua5.1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose the port Railway will allocate
EXPOSE 3000

# Start the server
CMD ["node", "api/obfuscate.js"]
