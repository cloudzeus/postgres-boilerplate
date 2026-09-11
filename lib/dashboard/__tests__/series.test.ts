import { describe, it, expect } from 'vitest';
import {
  parseRange, windowFor, isoDay, startOfDayUtc, delta, bucketByDay, isWeekend,
  dayLabel, niceMax, gridTicks, donutSlices, share, successRate, topN, DEFAULT_RANGE,
} from '../series';

describe('parseRange', () => {
  it('δέχεται μόνο 7 / 30 / 90', () => {
    expect(parseRange('7')).toBe(7);
    expect(parseRange('30')).toBe(30);
    expect(parseRange('90')).toBe(90);
  });

  it('πέφτει στην προεπιλογή για ό,τι άλλο', () => {
    for (const bad of [undefined, '', 'abc', '0', '-7', '31', '1e3', 'NaN']) {
      expect(parseRange(bad)).toBe(DEFAULT_RANGE);
    }
  });

  it('παίρνει την πρώτη τιμή όταν το query έχει διπλό key', () => {
    expect(parseRange(['90', '7'])).toBe(90);
    expect(parseRange(['bad'])).toBe(DEFAULT_RANGE);
  });
});

describe('windowFor', () => {
  const now = new Date('2026-09-11T13:45:00Z');

  it('η τρέχουσα περίοδος τελειώνει στο τέλος της σημερινής ημέρας', () => {
    const w = windowFor(now, 7);
    expect(isoDay(w.start)).toBe('2026-09-05');
    expect(isoDay(w.end)).toBe('2026-09-12'); // αποκλειστικό όριο
    expect(w.days).toHaveLength(7);
    expect(w.days[0]).toBe('2026-09-05');
    expect(w.days.at(-1)).toBe('2026-09-11');
  });

  it('η προηγούμενη περίοδος έχει ίσο μήκος και ακουμπά την τρέχουσα', () => {
    const w = windowFor(now, 30);
    expect(w.prevEnd.getTime()).toBe(w.start.getTime());
    const len = w.end.getTime() - w.start.getTime();
    const prevLen = w.prevEnd.getTime() - w.prevStart.getTime();
    expect(prevLen).toBe(30 * 86_400_000);
    expect(len).toBe(30 * 86_400_000);
    expect(isoDay(w.start)).toBe('2026-08-13');
    expect(isoDay(w.prevStart)).toBe('2026-07-14');
  });

  it('τα κλειδιά ημερών είναι συνεχόμενα και μοναδικά στις 90 ημέρες', () => {
    const w = windowFor(now, 90);
    expect(w.days).toHaveLength(90);
    expect(new Set(w.days).size).toBe(90);
    for (let i = 1; i < w.days.length; i++) {
      const prev = new Date(`${w.days[i - 1]}T00:00:00Z`).getTime();
      const cur = new Date(`${w.days[i]}T00:00:00Z`).getTime();
      expect(cur - prev).toBe(86_400_000);
    }
  });

  it('περνά σωστά αλλαγή μήνα και έτους', () => {
    const w = windowFor(new Date('2027-01-02T05:00:00Z'), 7);
    expect(w.days[0]).toBe('2026-12-27');
    expect(w.days.at(-1)).toBe('2027-01-02');
  });

  it('startOfDayUtc κόβει την ώρα', () => {
    expect(startOfDayUtc(now).toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });
});

describe('delta', () => {
  it('υπολογίζει ποσοστό ανόδου και πτώσης', () => {
    expect(delta(120, 100)).toEqual({ dir: 'up', pct: 20, diff: 20 });
    expect(delta(80, 100)).toEqual({ dir: 'down', pct: 20, diff: -20 });
  });

  it('ίσες τιμές είναι flat με 0 %', () => {
    expect(delta(5, 5)).toEqual({ dir: 'flat', pct: 0, diff: 0 });
  });

  it('μηδενική προηγούμενη περίοδος δεν παράγει άπειρο ποσοστό', () => {
    expect(delta(9, 0)).toEqual({ dir: 'up', pct: null, diff: 9 });
    expect(delta(0, 0)).toEqual({ dir: 'flat', pct: null, diff: 0 });
  });

  it('πτώση στο μηδέν είναι −100 %', () => {
    expect(delta(0, 40)).toEqual({ dir: 'down', pct: 100, diff: -40 });
  });
});

describe('bucketByDay', () => {
  const days = ['2026-09-09', '2026-09-10', '2026-09-11'];

  it('γεμίζει τις ημέρες χωρίς δεδομένα με μηδέν', () => {
    expect(bucketByDay([{ day: '2026-09-10', value: 4 }], days)).toEqual([0, 4, 0]);
  });

  it('αθροίζει πολλαπλές γραμμές της ίδιας ημέρας', () => {
    const rows = [
      { day: new Date('2026-09-09T03:00:00Z'), value: 2 },
      { day: new Date('2026-09-09T21:00:00Z'), value: 3 },
    ];
    expect(bucketByDay(rows, days)).toEqual([5, 0, 0]);
  });

  it('αγνοεί γραμμές εκτός παραθύρου', () => {
    expect(bucketByDay([{ day: '2026-01-01', value: 99 }], days)).toEqual([0, 0, 0]);
  });

  it('δέχεται Date και string με το ίδιο αποτέλεσμα', () => {
    const a = bucketByDay([{ day: new Date('2026-09-11T00:00:00Z'), value: 1 }], days);
    const b = bucketByDay([{ day: '2026-09-11', value: 1 }], days);
    expect(a).toEqual(b);
  });
});

describe('ετικέτες ημερών', () => {
  it('αναγνωρίζει σαββατοκύριακα', () => {
    expect(isWeekend('2026-09-12')).toBe(true);  // Σάββατο
    expect(isWeekend('2026-09-13')).toBe(true);  // Κυριακή
    expect(isWeekend('2026-09-11')).toBe(false); // Παρασκευή
  });

  it('γράφει ηη/μμ', () => {
    expect(dayLabel('2026-09-11')).toBe('11/09');
  });
});

describe('άξονας y', () => {
  it('niceMax στρογγυλεύει σε 1/2/5 × 10^n', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(23)).toBe(50);
    expect(niceMax(140)).toBe(200);
  });

  it('niceMax δεν επιστρέφει ποτέ 0 ή NaN', () => {
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
  });

  it('gridTicks δίνει ισαπέχουσες τιμές μέχρι το στρογγυλό μέγιστο', () => {
    expect(gridTicks(7, 4)).toEqual([2.5, 5, 7.5, 10]);
    expect(gridTicks(0, 2)).toEqual([0.5, 1]);
  });
});

describe('donutSlices', () => {
  const C = 100;

  it('τα τόξα αθροίζουν στην περίμετρο και ξεκινούν το ένα μετά το άλλο', () => {
    const { slices, total } = donutSlices([
      { key: 'a', label: 'A', value: 3, color: '#111' },
      { key: 'b', label: 'B', value: 1, color: '#222' },
    ], C);
    expect(total).toBe(4);
    expect(slices[0].pct).toBe(75);
    expect(slices[1].pct).toBe(25);
    expect(slices[0].dash).toBe('75.00 25.00');
    expect(slices[0].offset).toBe(0);
    expect(slices[1].offset).toBe(-75);
  });

  it('χωρίς δεδομένα δίνει μηδενικά τόξα, όχι NaN', () => {
    const { slices, total } = donutSlices([{ key: 'a', label: 'A', value: 0, color: '#111' }], C);
    expect(total).toBe(0);
    expect(slices[0].pct).toBe(0);
    expect(slices[0].dash).toBe('0.00 100.00');
  });

  it('κρατά και τις μηδενικές κατηγορίες για το υπόμνημα', () => {
    const { slices } = donutSlices([
      { key: 'a', label: 'A', value: 5, color: '#111' },
      { key: 'b', label: 'B', value: 0, color: '#222' },
    ], C);
    expect(slices).toHaveLength(2);
    expect(slices[1].value).toBe(0);
  });
});

describe('share / successRate / topN', () => {
  it('share αντέχει μηδενικό σύνολο', () => {
    expect(share(2, 8)).toBe(25);
    expect(share(2, 0)).toBe(0);
  });

  it('successRate αγνοεί τα FAILED από τον παρονομαστή', () => {
    expect(successRate({ EXTRACTED: 6, POSTED: 2, REVIEW: 2, FAILED: 10 })).toBe(80);
  });

  it('successRate χωρίς εκτελέσεις είναι null, όχι 0', () => {
    expect(successRate({})).toBeNull();
    expect(successRate({ FAILED: 4 })).toBeNull();
  });

  it('topN κόβει φθίνουσα με σταθερή σειρά στις ισοπαλίες', () => {
    const rows = [
      { label: 'Βήτα', value: 5 }, { label: 'Άλφα', value: 5 }, { label: 'Γάμα', value: 9 },
    ];
    expect(topN(rows, 2).map((r) => r.label)).toEqual(['Γάμα', 'Άλφα']);
    expect(topN(rows, 10)).toHaveLength(3);
  });

  it('topN δεν μεταλλάσσει τον αρχικό πίνακα', () => {
    const rows = [{ label: 'a', value: 1 }, { label: 'b', value: 2 }];
    topN(rows, 1);
    expect(rows.map((r) => r.label)).toEqual(['a', 'b']);
  });
});
