import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { EnvironmentVariables } from './config/env.validation.js';
import { setupSwagger } from './config/swagger.js';

async function bootstrap() {
  // ValidationPipe và DomainExceptionFilter đăng ký toàn cục trong CommonModule (APP_PIPE, APP_FILTER).
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    setupSwagger(app);
  }
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
