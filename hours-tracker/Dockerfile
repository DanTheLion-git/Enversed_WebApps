FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data
ENV DATABASE_PATH=/data/hours.db
ENV JWT_SECRET=change-this-in-production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
