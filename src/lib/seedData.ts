import { BusinessUnit, UserAccount } from '../types/erp';

export const BUSINESS_UNITS: BusinessUnit[] = [
  {
    id: 'real_estate',
    name: 'JAST Real Estate & Properties',
    code: 'JAST-RE',
    description: 'High-capital lot sales, commercial leasing, and property asset rotations',
    approvalThreshold: 30000,
    accentColor: 'indigo',
  },
  {
    id: 'pickleball',
    name: 'JAST Pickleball Court & Hub',
    code: 'JAST-PB',
    description: 'High-volume daily court bookings, tournament fees, and pro-shop cash flow',
    approvalThreshold: 30000,
    accentColor: 'emerald',
  },
  {
    id: 'jewelry',
    name: 'JAST Fine Jewelry Vault',
    code: 'JAST-JW',
    description: 'Premium 18k/24k gold, diamonds, and bespoke inventory margins',
    approvalThreshold: 30000,
    accentColor: 'amber',
  },
];

export const DEMO_USERS: UserAccount[] = [
  {
    id: 'usr-owner-jasmin',
    name: "Ma'am Jasmin Taurak",
    title: 'Managing Owner (Global Access)',
    role: 'owner',
    businessId: null,
  },
  {
    id: 'usr-bk-re',
    name: 'Elena Reyes',
    title: 'Bookkeeper — Real Estate',
    role: 'bookkeeper',
    businessId: 'real_estate',
  },
  {
    id: 'usr-bk-pb',
    name: 'Marco Santos',
    title: 'Court Coordinator & Clerk — Pickleball',
    role: 'bookkeeper',
    businessId: 'pickleball',
  },
  {
    id: 'usr-bk-jw',
    name: 'Clarissa Lim',
    title: 'Vault Bookkeeper — Jewelry',
    role: 'bookkeeper',
    businessId: 'jewelry',
  },
  {
    id: 'usr-staff-operations',
    name: 'JAST Sales & Booking Staff',
    title: 'Bookings — Real Estate & Pickleball • Sales — Jewelry',
    role: 'staff',
    businessId: null,
    businessIds: ['real_estate', 'pickleball', 'jewelry'],
  },
];
