FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY lib/ ./lib/

ENV PORT=8080
ENV ENVIRONMENT=dev
ENV GCP_PROJECT=ropi-aoss-dev

EXPOSE 8080

CMD ["node", "lib/index.js"]
