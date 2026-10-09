export const PARTNERSHIP_STATUSES = ['ACTIVE', 'SUSPENDED', 'ENDED'] as const;

export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number];

/** ENDED là trạng thái cuối. */
export const PARTNERSHIP_STATUS_TRANSITIONS: Readonly<
  Record<PartnershipStatus, readonly PartnershipStatus[]>
> = {
  ACTIVE: ['SUSPENDED', 'ENDED'],
  SUSPENDED: ['ACTIVE', 'ENDED'],
  ENDED: [],
};

export function canTransitionPartnershipStatus(
  from: PartnershipStatus,
  to: PartnershipStatus,
): boolean {
  return PARTNERSHIP_STATUS_TRANSITIONS[from].includes(to);
}
