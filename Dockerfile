FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install --prod --frozen-lockfile=false
COPY src ./src
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "start"]
