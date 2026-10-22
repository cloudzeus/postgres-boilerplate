import { describe, it, expect } from 'vitest';
import { approvalFingerprint, approvalStatus, canApproveLevel, requiredLevels, type ApprovalConfig, type ApprovalRecord } from '../approvals';

const CFG: ApprovalConfig = { enabled: true, level1Amount: 1000, level1Roles: ['ADMIN'], level2Amount: 10000, level2Roles: ['SUPER_ADMIN'], whenWarnings: false };
const R = (level: number, decision: string, userId: string, fingerprint = 'f1', comment: string | null = null): ApprovalRecord => ({ level, decision, userId, userEmail: `${userId}@x`, comment, fingerprint, createdAt: new Date() });

describe('requiredLevels', () => {
  it('ανενεργό ⇒ καμία', () => expect(requiredLevels(50000, { ...CFG, enabled: false }, true).levels).toEqual([]));
  it('κάτω από το όριο 1 ⇒ καμία· πάνω ⇒ [1]· πάνω από το όριο 2 ⇒ [1, 2]', () => {
    expect(requiredLevels(999, CFG, false).levels).toEqual([]);
    expect(requiredLevels(1000, CFG, false).levels).toEqual([1]);
    expect(requiredLevels(12500, CFG, false).levels).toEqual([1, 2]);
  });
  it('παρατηρήσεις ⇒ [1] όταν είναι ενεργό', () => {
    expect(requiredLevels(100, { ...CFG, whenWarnings: true }, true).levels).toEqual([1]);
    expect(requiredLevels(100, CFG, true).levels).toEqual([]);
  });
});

describe('approvalStatus', () => {
  it('δύο εγκρίσεις από διαφορετικούς χρήστες ⇒ ικανοποιείται', () => {
    expect(approvalStatus([1, 2], 'x', [R(1, 'APPROVED', 'a'), R(2, 'APPROVED', 'b')], 'f1').satisfied).toBe(true);
  });
  it('τέσσερα μάτια: ο ΙΔΙΟΣ χρήστης και στα δύο επίπεδα ⇒ λείπει το 2', () => {
    const s = approvalStatus([1, 2], 'x', [R(1, 'APPROVED', 'a'), R(2, 'APPROVED', 'a')], 'f1');
    expect(s.missing).toEqual([2]);
  });
  it('έγκριση για ΑΛΛΗ εκδοχή του παραστατικού δεν μετράει', () => {
    expect(approvalStatus([1], 'x', [R(1, 'APPROVED', 'a', 'παλιό')], 'f1').satisfied).toBe(false);
  });
  it('απόρριψη ⇒ μπλοκάρει, μέχρι νεότερη έγκριση στο ίδιο επίπεδο', () => {
    const rej = approvalStatus([1], 'x', [R(1, 'REJECTED', 'a', 'f1', 'λάθος ποσό')], 'f1');
    expect(rej.rejected?.comment).toBe('λάθος ποσό');
    const later = { ...R(1, 'APPROVED', 'b'), createdAt: new Date(Date.now() + 1000) };
    expect(approvalStatus([1], 'x', [R(1, 'REJECTED', 'a', 'f1', 'λάθος'), later], 'f1').satisfied).toBe(true);
  });
});

describe('canApproveLevel & αποτύπωμα', () => {
  it('ρόλοι ανά επίπεδο· ο SUPER_ADMIN πάντα', () => {
    expect(canApproveLevel(1, 'ADMIN', CFG)).toBe(true);
    expect(canApproveLevel(2, 'ADMIN', CFG)).toBe(false);
    expect(canApproveLevel(2, 'SUPER_ADMIN', CFG)).toBe(true);
    expect(canApproveLevel(1, 'EMPLOYEE', CFG)).toBe(false);
  });
  it('αλλαγή ποσού γραμμής ⇒ άλλο αποτύπωμα', () => {
    const base = { total: 1240, net: 1000, vat: 240, trdr: 1, series: '2061', number: '17', date: '2026-10-20', lines: [{ net: 1000 }] };
    expect(approvalFingerprint(base)).toBe(approvalFingerprint({ ...base }));
    expect(approvalFingerprint({ ...base, lines: [{ net: 999 }] })).not.toBe(approvalFingerprint(base));
  });
});
