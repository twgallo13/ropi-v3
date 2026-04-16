FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY lib/ ./lib/

ENV PORT=8080
ENV NODE_ENV=development
ENV FIREBASE_PROJECT_ID=ropi-aoss-dev
ENV FIREBASE_STORAGE_BUCKET=ropi-aoss-dev-imports

EXPOSE 8080

CMD ["node", "lib/index.js"]
