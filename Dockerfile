# Image môi trường DEV (hot-reload). Dùng cùng docker-compose.yml: mã nguồn được bind mount vào /app.
FROM node:26-alpine

WORKDIR /app

# Cài dependency trước để tận dụng cache layer khi chỉ sửa mã nguồn.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
