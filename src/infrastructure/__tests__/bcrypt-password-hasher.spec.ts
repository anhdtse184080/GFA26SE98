import { BcryptPasswordHasher } from '../bcrypt-password-hasher.js';

describe('BcryptPasswordHasher', () => {
  // Rounds thấp cho test nhanh; production dùng DEFAULT_BCRYPT_ROUNDS.
  const hasher = new BcryptPasswordHasher(4);

  it('hash không chứa mật khẩu gốc và đúng định dạng bcrypt', async () => {
    const hash = await hasher.hash('Secret@123');

    expect(hash).not.toContain('Secret@123');
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
  });

  it('cùng mật khẩu hash hai lần cho kết quả khác nhau (salt)', async () => {
    const [a, b] = await Promise.all([
      hasher.hash('Secret@123'),
      hasher.hash('Secret@123'),
    ]);

    expect(a).not.toBe(b);
  });

  it('compare trả true với mật khẩu đúng, false với mật khẩu sai', async () => {
    const hash = await hasher.hash('Secret@123');

    await expect(hasher.compare('Secret@123', hash)).resolves.toBe(true);
    await expect(hasher.compare('secret@123', hash)).resolves.toBe(false);
  });

  it('mặc định dùng cost 10', async () => {
    const hash = await new BcryptPasswordHasher().hash('x');

    expect(hash).toMatch(/^\$2[aby]\$10\$/);
  });
});
