# FA26SE095 – Backend

Backend NestJS 12 (TypeScript, ESM) cho nền tảng quản lý và cộng tác thiết kế nội thất tích hợp AI tạo sinh.
Dùng PostgreSQL 17 (dữ liệu nghiệp vụ, TypeORM) và MongoDB 8 (dữ liệu AI, Mongoose).

## Yêu cầu

- Node.js ≥ 22 (dự án đang dùng Node 26)
- Docker Desktop (có Docker Compose v2)

## Chạy ở local

```bash
# 1. Cài dependencies
npm install

# 2. Tạo file .env từ mẫu (sửa JWT_SECRET, mật khẩu nếu cần)
cp .env.example .env

# 3. Bật PostgreSQL + MongoDB (chờ đến khi cả hai healthy)
npm run db:up

# 4. Chạy migration (hiện chưa có migration nghiệp vụ)
npm run migration:run

# 5. Chạy app (watch mode)
npm run start:dev

# 6. Kiểm tra kết nối DB
curl http://localhost:3000/health
# => {"status":"up","details":{"postgres":"up","mongo":"up"}}
```

`GET /health` trả `503` kèm chi tiết nếu một trong hai DB không kết nối được.
App kiểm tra biến môi trường khi khởi động: thiếu hoặc sai biến thì in ra danh sách lỗi và dừng.

Tắt DB:

```bash
npm run db:down            # dừng container, giữ dữ liệu
docker compose down -v     # dừng và XÓA toàn bộ dữ liệu (volume)
```

## Biến môi trường

Xem [.env.example](.env.example). `POSTGRES_*` và `MONGO_INITDB_*` được docker-compose dùng để khởi tạo container, đồng thời app dùng để kết nối. Nếu đổi user/mật khẩu Mongo thì sửa cả `MONGO_URI`.
Nếu đổi `POSTGRES_PORT`/`MONGO_PORT` (ví dụ máy đã có Postgres chạy ở 5432) thì sửa luôn port trong `MONGO_URI`.

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

## Cấu trúc chính

```
src/
├── config/          # ConfigModule global + validate biến môi trường
├── database/
│   ├── postgres/    # TypeORM (snake_case naming), data-source.ts cho CLI, migrations/
│   ├── mongo/       # Mongoose
│   ├── unit-of-work.ts        # mở transaction (AsyncLocalStorage)
│   └── transaction-context.ts # repository lấy EntityManager của transaction hiện tại
├── common/ports/    # interface hạ tầng dùng chung
└── modules/         # các module nghiệp vụ (health, ...)
```
