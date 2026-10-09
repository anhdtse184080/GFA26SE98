// Dùng làm Stop hook cho Claude Code: chạy build → lint → unit test.
// Lỗi thì in kết quả ra stderr và thoát mã 2 để Claude Code đọc lỗi và tự sửa tiếp.
import { spawnSync } from 'node:child_process';

const steps = ['build', 'lint', 'test'];

for (const step of steps) {
  const r = spawnSync('npm', ['run', step], { encoding: 'utf8', shell: true });
  if (r.status !== 0) {
    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().split('\n').slice(-60).join('\n');
    console.error(`[verify] "npm run ${step}" thất bại. Hãy sửa lỗi rồi kiểm tra lại.\n\n${output}`);
    process.exit(2);
  }
}
console.log('[verify] build, lint, test đều pass.');
