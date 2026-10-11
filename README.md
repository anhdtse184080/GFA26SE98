# FA26SE095 – Backend

Backend NestJS 12 (TypeScript, ESM) cho nền tảng quản lý và cộng tác thiết kế nội thất tích hợp AI tạo sinh.
Dùng PostgreSQL 17 + pgvector (TypeORM) cho toàn bộ dữ liệu, kể cả dữ liệu AI.

## Yêu cầu

- Node.js ≥ 22 (dự án đang dùng Node 26)
- Docker Desktop (có Docker Compose v2)

## Chạy ở local

```bash
# 1. Cài dependencies
npm install

# 2. Đặt file .env vào thư mục gốc dự án

# 3. Bật PostgreSQL
npm run db:up

# 4. Chạy migration
npm run migration:run

# 5. Chạy app (watch mode)
npm run start:dev
```



Tắt DB:

```bash
npm run db:down            # dừng container, giữ dữ liệu
docker compose down -v     # dừng và XÓA toàn bộ dữ liệu (volume)
```

## Biến môi trường

File `.env` không có trong repo, mỗi thành viên nhận riêng. `POSTGRES_*` được docker-compose dùng để khởi tạo container, đồng thời app dùng để kết nối.
Nếu máy đã có Postgres chạy ở 5432 thì đổi `POSTGRES_PORT`.

## Migration (TypeORM)

`synchronize` luôn tắt; schema chỉ thay đổi qua migration trong `src/database/postgres/migrations/`.
TypeORM CLI chạy trên bản build trong `dist/` (dự án là ESM), nên các script đều tự `npm run build` trước.

```bash
# Sinh migration từ thay đổi entity
npm run migration:generate -- src/database/postgres/migrations/<TenMigration>

# Tạo migration rỗng để tự viết SQL
npm run migration:create -- src/database/postgres/migrations/<TenMigration>

npm run migration:run       # áp dụng
npm run migration:revert    # hoàn tác migration gần nhất
```

## Kiểm tra code

Chạy theo thứ tự sau khi sửa code:

```bash
npm run build
npm run lint
npm run test          # unit test (Vitest)
npm run test:e2e      # e2e, cần `npm run db:up` trước
```


