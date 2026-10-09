import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

/**
 * Swagger UI tại `/docs`, JSON spec tại `/docs-json`.
 * Bearer áp dụng toàn cục: bấm Authorize, dán `accessToken` từ `POST /auth/login`;
 * route `@Public()` vẫn gọi được khi không có token.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('FA26SE095 API')
    .setDescription(
      'API nền tảng quản lý và cộng tác thiết kế nội thất.\n\n' +
        'Lỗi luôn có dạng `{ "code": "EMAIL_ALREADY_EXISTS", "message": "...", "details": {} }`.',
    )
    .setVersion('0.0.1')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
