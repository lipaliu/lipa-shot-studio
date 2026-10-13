FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318 DATA_DIR=/app/.data
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/.data && chown node:node /app/.data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY prompts ./prompts
COPY vendor ./vendor
COPY examples ./examples
COPY licenses ./licenses
USER node
EXPOSE 4318
CMD ["node", "server/index.js"]
