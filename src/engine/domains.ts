import type { DomainId } from './types';

export interface DomainInfo {
  id: DomainId;
  name: string;
  /** Share of the exam (ISC2 CISSP outline, effective 15 April 2024). */
  weight: number;
}

export const DOMAINS: readonly DomainInfo[] = [
  { id: 1, name: 'Security and Risk Management', weight: 0.16 },
  { id: 2, name: 'Asset Security', weight: 0.1 },
  { id: 3, name: 'Security Architecture and Engineering', weight: 0.13 },
  { id: 4, name: 'Communication and Network Security', weight: 0.13 },
  { id: 5, name: 'Identity and Access Management (IAM)', weight: 0.13 },
  { id: 6, name: 'Security Assessment and Testing', weight: 0.12 },
  { id: 7, name: 'Security Operations', weight: 0.13 },
  { id: 8, name: 'Software Development Security', weight: 0.1 },
];

export const DOMAIN_IDS: readonly DomainId[] = DOMAINS.map((d) => d.id);

export function domainInfo(id: DomainId): DomainInfo {
  const info = DOMAINS.find((d) => d.id === id);
  if (!info) throw new Error(`unknown domain ${id}`);
  return info;
}
