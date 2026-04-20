// Shared constants for the org / user compliance profile. Kept in one
// place because the personal Profile page and the org Profile page
// both need the same option lists — if they drift, matching breaks.

export const INDUSTRIES = [
  { value: 'technology', label: 'Technology / SaaS' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'finance', label: 'Finance / Banking' },
  { value: 'legal', label: 'Legal' },
  { value: 'education', label: 'Education' },
  { value: 'pharmaceutical', label: 'Pharmaceutical' },
  { value: 'retail', label: 'Retail / eCommerce' },
  { value: 'media', label: 'Media / Publishing' },
  { value: 'government', label: 'Government / Public sector' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'other', label: 'Other' },
] as const;

export const ORG_SIZES = [
  { value: '1', label: 'Just me' },
  { value: '2-10', label: '2–10' },
  { value: '11-50', label: '11–50' },
  { value: '51-200', label: '51–200' },
  { value: '201-1000', label: '201–1,000' },
  { value: '1001+', label: '1,001+' },
] as const;

export const COMPLIANCE = [
  'GDPR', 'CCPA', 'HIPAA', 'SOC 2', 'ISO 27001', 'PCI DSS',
  'FERPA', 'FedRAMP', 'SOX', 'NIS2', 'DORA',
] as const;

export const DATA_RESIDENCY = [
  { value: 'any', label: 'No preference' },
  { value: 'EU', label: 'EU only' },
  { value: 'US', label: 'US only' },
  { value: 'UK', label: 'UK only' },
  { value: 'other', label: 'Other / custom' },
] as const;

export type Industry = typeof INDUSTRIES[number]['value'];
export type OrgSize = typeof ORG_SIZES[number]['value'];
export type ComplianceTag = typeof COMPLIANCE[number];
export type DataResidency = typeof DATA_RESIDENCY[number]['value'];
