import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import {
  HEALTH_INDICATORS,
  type HealthIndicator,
} from './../src/common/ports/health-indicator.js';

// Cần chạy `npm run db:up` trước.
describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) – Postgres và Mongo đều up', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'up', details: { postgres: 'up', mongo: 'up' } });
  });

  afterAll(async () => {
    await app.close();
  });
});

describe('HealthController (e2e) – một DB down', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const indicators: HealthIndicator[] = [
      { name: 'postgres', check: () => Promise.resolve('up') },
      { name: 'mongo', check: () => Promise.resolve('down') },
    ];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HEALTH_INDICATORS)
      .useValue(indicators)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) → 503 kèm report', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(503)
      .expect({ status: 'down', details: { postgres: 'up', mongo: 'down' } });
  });

  afterAll(async () => {
    await app.close();
  });
});
