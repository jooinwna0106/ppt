FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/presentation ./presentation
COPY --from=build /app/sound-signal ./sound-signal

RUN mkdir -p /tmp/speed-quiz-show/uploads /tmp/speed-quiz-show/data

EXPOSE 10000

CMD ["npm", "start"]
