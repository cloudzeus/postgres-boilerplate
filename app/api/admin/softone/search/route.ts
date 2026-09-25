import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAnyPermission } from '@/lib/rbac';
import { ISSUER_SODTYPES } from '@/lib/softone';
import { classificationLabeller } from '@/lib/ocr/mydata-labels';
import { SXACCOUNT_MTRTYPE } from '@/lib/softone';

// Searches the local SoftOne mirrors for manual matching (items / traders / χρεοπιστώσεις).
// GET ?type=items|products|services|expenses|lineitems|sxaccounts|accounts|suppliers|traders&q=...
// `sxaccounts` = λογαριασμοί εσόδων/εξόδων των ΑΠΛΟΓΡΑΦΙΚΩΝ (MTRL SODTYPE 61), μόνο τα έξοδα.
// `suppliers`/`traders` δέχονται και `sodtype=12|16|15` για έναν ΜΟΝΟ τύπο καρτέλας.
// `lineitems` (χρεοπιστώσεις) δέχεται και `category=<MTRCATEGORY>` για να στενέψει η λίστα σε μία
// κατηγορία δαπάνης — διαφορετικά η επιλογή από εκατοντάδες κωδικούς είναι πρακτικά αδύνατη.
// `suppliers` and `traders` are the same query (SODTYPE 12 προμηθευτές + 16 πιστωτές + 15
// χρεώστες — ό,τι μπορεί να εκδώσει παραστατικό προς εμάς); the queue pages call it `traders`
// because a creditor or a debtor is not a supplier.
export async function GET(req: Request) {
  await requireAnyPermission('ocr.read', 'metadata.read', 'metadata.manage');
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type') ?? 'items';
  const q = (sp.get('q') ?? '').trim();
  /**
   * ΜΟΝΟ οι χρεοπιστώσεις φυλλομετρούνται με κενή αναζήτηση.
   *
   * Ο κωδικός τους ΕΙΝΑΙ ο λογαριασμός γενικής, οπότε το «τι υπάρχει» είναι νόμιμη ερώτηση: ο
   * χρήστης που επιμερίζει μια δαπάνη δεν ξέρει από πού ΑΡΧΙΖΕΙ ο λογαριασμός που ψάχνει — θέλει
   * να δει τη λίστα και να διαλέξει. Οι υπόλοιποι τύποι (συναλλασσόμενοι, είδη, λογαριασμοί)
   * μετρούν σε χιλιάδες και μένουν πίσω από αναζήτηση.
   */
  const browsable = type === 'lineitems' || type === 'sxaccounts';
  if (q.length < 2 && !browsable) return NextResponse.json({ results: [] });

  if (type === 'suppliers' || type === 'traders') {
    // `sodtype=16` στενεύει σε ΕΝΑΝ τύπο καρτέλας. Το χρειάζεται η σελίδα ενός παραστατικού: η
    // σειρά του ορίζει τι δέχεται η κεφαλίδα (πιστωτή, προμηθευτή ή χρεώστη), και μια λίστα που
    // δείχνει και τους τρεις καλεί τον χρήστη να διαλέξει αυτόν που θα απορριφθεί αργότερα.
    const only = Number(sp.get('sodtype'));
    const sodtypes = (ISSUER_SODTYPES as readonly number[]).includes(only) ? [only] : [...ISSUER_SODTYPES];
    const rows = await prisma.softoneTrader.findMany({
      where: {
        sodtype: { in: sodtypes },
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }, { afm: { contains: q } }],
      },
      take: 25, orderBy: { name: 'asc' },
      select: { trdr: true, code: true, name: true, afm: true, kind: true, city: true, sodtype: true },
    });
    return NextResponse.json({
      // `afm` on its own as well as inside `sub`: the caller that links a supplier needs the
      // bare VAT number, and digging it back out of the display string is guesswork.
      results: rows.map((r) => ({ id: r.trdr, code: r.code, name: r.name, afm: r.afm ?? null, sodtype: r.sodtype, kind: r.kind ?? null, sub: [r.kind, r.afm && `ΑΦΜ ${r.afm}`, r.city].filter(Boolean).join(' · ') })),
    });
  }

  // ── Αναλυτική ανά γραμμή: κέντρο κόστους / έργο / δραστηριότητα ─────────────
  if (type === 'costcenters') {
    const rows = await prisma.softoneCostCenter.findMany({
      where: { isActive: true, OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }] },
      take: 25, orderBy: { name: 'asc' },
      select: { costcntr: true, code: true, name: true, sohCode: true },
    });
    return NextResponse.json({
      results: rows.map((r) => ({
        id: r.costcntr, code: r.code, name: r.name,
        sub: ['κέντρο κόστους', r.sohCode && `ιεραρχία ${r.sohCode}`].filter(Boolean).join(' · '),
      })),
    });
  }

  if (type === 'projects') {
    // `trdr`: τα έργα ΤΟΥ εκδότη πρώτα — μια σύντομη σωστή λίστα είναι όλο το νόημα.
    const trdr = Number(sp.get('trdr'));
    const onlyTrader = sp.get('scope') !== 'all' && Number.isFinite(trdr) && trdr > 0;
    const rows = await prisma.softoneProject.findMany({
      where: {
        isActive: true,
        ...(onlyTrader ? { trdr } : {}),
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }],
      },
      take: 25, orderBy: { name: 'asc' },
      select: { prjc: true, code: true, name: true, trdr: true },
    });
    return NextResponse.json({
      scope: onlyTrader ? 'trader' : 'all',
      results: rows.map((r) => ({
        id: r.prjc, code: r.code, name: r.name,
        sub: ['έργο', r.trdr ? `συναλλασσόμενος ${r.trdr}` : null].filter(Boolean).join(' · '),
      })),
    });
  }

  if (type === 'projectstages') {
    const rows = await prisma.softoneProjectStage.findMany({
      where: { isActive: true, OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }] },
      take: 25, orderBy: { name: 'asc' },
      select: { prjcStage: true, code: true, name: true },
    });
    return NextResponse.json({
      results: rows.map((r) => ({ id: r.prjcStage, code: r.code, name: r.name, sub: 'κατηγορία δραστηριότητας' })),
    });
  }

  if (type === 'accounts') {
    // Λογιστικό σχέδιο (ACNT) — ΜΟΝΟ κινούμενοι λογαριασμοί. Ένας συγκεντρωτικός δεν δέχεται
    // εγγραφές, οπότε δεν είναι υποψήφιος για την «Γενικής» μιας χρεοπίστωσης· το ίδιο κριτήριο
    // χρησιμοποιεί και ο έλεγχος πριν την καταχώριση (`isPostable`).
    const rows = await prisma.softoneAccount.findMany({
      where: {
        isActive: true, postable: true,
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }],
      },
      take: 25, orderBy: { code: 'asc' },
      select: { acnt: true, code: true, name: true, grade: true },
    });
    return NextResponse.json({
      results: rows.map((r) => ({
        id: r.acnt, code: r.code, name: r.name,
        sub: ['λογαριασμός γενικής', r.grade != null ? `βαθμίδα ${r.grade}` : null].filter(Boolean).join(' · '),
      })),
    });
  }

  if (type === 'sxaccounts') {
    // ΑΠΛΟΓΡΑΦΙΚΑ: λογαριασμοί εσόδων/εξόδων (`MTRL` SODTYPE 61, καθρέφτης `SoftoneSxAccount`).
    // Προσφέρουμε ΜΟΝΟ τα ΕΞΟΔΑ (MTRTYPE 2): σε εισερχόμενο παραστατικό ένας λογαριασμός εσόδων ή
    // ΦΠΑ είναι λάθος επιλογή, και το ΦΠΑ το συμπληρώνει μόνο του το SoftOne.
    const rows = await prisma.softoneSxAccount.findMany({
      where: {
        isActive: true, mtrType: SXACCOUNT_MTRTYPE.expense,
        ...(q.length >= 2
          ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }] }
          : {}),
      },
      take: q.length < 2 ? 500 : 25,
      orderBy: { code: 'asc' },
      select: { mtrl: true, code: true, name: true, vat: true, myDataCode: true },
    });
    return NextResponse.json({
      results: rows.map((r) => ({
        id: r.mtrl, code: r.code, name: r.name, vat: r.vat ?? null,
        sub: ['λογαριασμός εξόδων', r.vat && `ΦΠΑ ${r.vat}`].filter(Boolean).join(' · '),
      })),
    });
  }

  if (type === 'lineitems') {
    // Χρεοπιστώσεις (LINEITEM → MTRL SODTYPE 53): το μόνο που δέχεται γραμμή LINLINES.
    const category = Number(sp.get('category'));
    const rows = await prisma.softoneLineItem.findMany({
      where: {
        isActive: true,
        ...(Number.isFinite(category) && category > 0 ? { mtrCategory: category } : {}),
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }],
      },
      // Φυλλομέτρηση: ΟΛΕΣ, με σειρά ΚΩΔΙΚΟΥ — ο κωδικός είναι ο λογαριασμός, οπότε η αριθμητική
      // σειρά ομαδοποιεί μόνη της (61.xx αμοιβές, 62.xx παροχές, 64.xx διάφορα έξοδα).
      // Αναζήτηση: οι 25 καλύτερες κατά περιγραφή.
      take: q.length < 2 ? 500 : 25,
      orderBy: q.length < 2 ? { code: 'asc' } : { name: 'asc' },
      select: {
        mtrl: true, code: true, name: true, vat: true, mtrCategory: true,
        classType: true, classCategory: true, myDataCode: true,
      },
    });
    const label = await classificationLabeller();
    const categories = rows.length
      ? await prisma.softoneLineCategory.findMany({
          where: { mtrCategory: { in: rows.map((r) => r.mtrCategory).filter((v): v is number => v != null) } },
          select: { mtrCategory: true, name: true },
        })
      : [];
    const catName = new Map(categories.map((c) => [c.mtrCategory, c.name]));
    return NextResponse.json({
      results: rows.map((r) => {
        const cls = label(r);
        return {
          id: r.mtrl, code: r.code, name: r.name, isService: false, vat: r.vat ?? null,
          myData: cls.label, noClass: cls.missing,
          sub: ['χρεοπίστωση', r.mtrCategory != null ? catName.get(r.mtrCategory) : null, r.vat && `ΦΠΑ ${r.vat}`]
            .filter(Boolean).join(' · '),
        };
      }),
    });
  }

  if (type === 'expenses') {
    // Έξοδα (EditMaster EXPENSES → EXPN) — τρίτο μητρώο της ουράς «Είδη & έξοδα».
    const rows = await prisma.softoneExpense.findMany({
      where: {
        isActive: true,
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }],
      },
      take: 25, orderBy: { name: 'asc' },
      select: { expn: true, code: true, name: true, vat: true, classTypeX: true, classCategoryX: true },
    });
    const label = await classificationLabeller();
    return NextResponse.json({
      results: rows.map((r) => {
        // Για παραστατικά που ΛΑΜΒΑΝΟΥΜΕ ισχύει το ζεύγος χαρακτηρισμού ΕΞΟΔΩΝ (…X).
        const cls = label({ classType: r.classTypeX, classCategory: r.classCategoryX });
        return {
          id: r.expn, code: r.code, name: r.name, isService: false, vat: r.vat ?? null,
          myData: cls.label, noClass: cls.missing,
          sub: ['έξοδο', r.vat && `ΦΠΑ ${r.vat}`].filter(Boolean).join(' · '),
        };
      }),
    });
  }

  if (type === 'products' || type === 'services') {
    // Ρητά μητρώα ανά κατηγορία, ώστε ο καλών να μη χρειάζεται το `service` flag.
    const rows = await prisma.softoneItem.findMany({
      where: {
        isService: type === 'services',
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q } }, { code1: { contains: q } }, { code2: { contains: q } },
        ],
      },
      take: 25, orderBy: { name: 'asc' },
      select: { mtrl: true, code: true, code1: true, code2: true, name: true, isService: true, myDataCode: true },
    });
    const label = await classificationLabeller();
    return NextResponse.json({
      results: rows.map((r) => {
        const cls = label({ myDataCode: r.myDataCode });
        return {
          id: r.mtrl, code: r.code, name: r.name, isService: r.isService,
          myData: cls.label, noClass: cls.missing,
          sub: [r.isService ? 'υπηρεσία' : 'είδος', r.code2 && `εργ. ${r.code2}`, r.code1 && `EAN ${r.code1}`].filter(Boolean).join(' · '),
        };
      }),
    });
  }

  // items (products + services)
  const onlyService = sp.get('service'); // '1' = only services, '0' = only products, null = both
  const rows = await prisma.softoneItem.findMany({
    where: {
      AND: [
        onlyService === '1' ? { isService: true } : onlyService === '0' ? { isService: false } : {},
        { OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q } }, { code1: { contains: q } }, { code2: { contains: q } },
        ] },
      ],
    },
    take: 25, orderBy: { name: 'asc' },
    select: { mtrl: true, code: true, code1: true, code2: true, name: true, isService: true },
  });
  return NextResponse.json({
    results: rows.map((r) => ({
      id: r.mtrl, code: r.code, name: r.name, isService: r.isService,
      sub: [r.isService ? 'υπηρεσία' : 'είδος', r.code2 && `εργ. ${r.code2}`, r.code1 && `EAN ${r.code1}`].filter(Boolean).join(' · '),
    })),
  });
}
