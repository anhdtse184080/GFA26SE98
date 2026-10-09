import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // E2E không bao giờ gửi mail thật, kể cả khi .env của máy dev đặt MAIL_DRIVER=smtp.
    env: { MAIL_DRIVER: 'log' },
  },
});
