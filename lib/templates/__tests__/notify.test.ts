import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock('@/lib/mailgun', () => ({ sendTransactionalEmail: (...a: unknown[]) => send(...a) }));

import { sendRuleNotifications, notificationHtml } from '../notify';

beforeEach(() => send.mockClear());

describe('sendRuleNotifications', () => {
  const base = {
    docId: 'd1',
    fileName: 'a.pdf',
    templateName: 'T',
    defaultEmails: 'a@x.gr; b@x.gr' as string | null,
    values: { total: { value: 12, color: '#000' } },
    appUrl: 'https://app',
  };

  it('sends one email per rule, to the rule emails or the template default, and returns the notified ids', async () => {
    const ids = await sendRuleNotifications({
      ...base,
      notifications: [{ conditionId: 'c1', subject: 'S1' }, { conditionId: 'c2', subject: 'S2', emails: 'z@x.gr' }],
      alreadyNotified: [],
    });
    expect(ids).toEqual(['c1', 'c2']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBe('a@x.gr, b@x.gr');
    expect(send.mock.calls[1][0]).toBe('z@x.gr');
  });

  it('skips rules already notified for this document and rules with no recipients', async () => {
    const ids = await sendRuleNotifications({
      ...base,
      defaultEmails: null,
      notifications: [{ conditionId: 'c1', subject: 'S1' }, { conditionId: 'c2', subject: 'S2', emails: 'z@x.gr' }],
      alreadyNotified: ['c2'],
    });
    expect(ids).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('a failed send does not throw and is not recorded', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    const ids = await sendRuleNotifications({ ...base, notifications: [{ conditionId: 'c1', subject: 'S1' }], alreadyNotified: [] });
    expect(ids).toEqual([]);
  });

  it('sends a rule only once even when it appears twice in the same run', async () => {
    const ids = await sendRuleNotifications({
      ...base,
      notifications: [{ conditionId: 'c1', subject: 'S1' }, { conditionId: 'c1', subject: 'S1 ξανά' }],
      alreadyNotified: [],
    });
    expect(ids).toEqual(['c1']);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('notificationHtml', () => {
  it('escapes values and links to the document', () => {
    const html = notificationHtml({ fileName: 'a<b>.pdf', templateName: 'T', values: { x: { value: '<i>', color: '#0078D4' } }, link: 'https://app/admin/ocr/d1' });
    expect(html).toContain('a&lt;b&gt;.pdf');
    expect(html).toContain('&lt;i&gt;');
    expect(html).toContain('https://app/admin/ocr/d1');
  });
});
