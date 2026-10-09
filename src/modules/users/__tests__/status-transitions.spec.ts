import { canTransitionPartnershipStatus } from '../partnership-status.js';
import { canTransitionUserStatus } from '../user-status.js';

describe('canTransitionUserStatus', () => {
  it.each([
    ['INVITED', 'ACTIVE'],
    ['ACTIVE', 'LOCKED'],
    ['ACTIVE', 'INACTIVE'],
    ['LOCKED', 'ACTIVE'],
    ['INACTIVE', 'ACTIVE'],
  ] as const)('cho phép %s → %s', (from, to) => {
    expect(canTransitionUserStatus(from, to)).toBe(true);
  });

  it.each([
    ['ACTIVE', 'INVITED'],
    ['LOCKED', 'INVITED'],
    ['ACTIVE', 'ACTIVE'],
  ] as const)('không cho phép %s → %s', (from, to) => {
    expect(canTransitionUserStatus(from, to)).toBe(false);
  });
});

describe('canTransitionPartnershipStatus', () => {
  it('ACTIVE ↔ SUSPENDED, kết thúc được từ cả hai', () => {
    expect(canTransitionPartnershipStatus('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransitionPartnershipStatus('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionPartnershipStatus('SUSPENDED', 'ENDED')).toBe(true);
  });

  it('ENDED là trạng thái cuối', () => {
    expect(canTransitionPartnershipStatus('ENDED', 'ACTIVE')).toBe(false);
    expect(canTransitionPartnershipStatus('ENDED', 'SUSPENDED')).toBe(false);
  });
});
