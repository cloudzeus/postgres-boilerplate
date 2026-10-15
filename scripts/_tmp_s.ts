import { softoneGetTable } from '@/lib/softone';
(async () => {
  console.log(JSON.stringify(await softoneGetTable('FINDOC', ['FINDOC','SERIES','SOSOURCE','TRDR','FINCODE'], 'FINDOC=115576')));
  console.log(JSON.stringify(await softoneGetTable('MTRLINES', ['FINDOC','MTRL','MTRUNIT','QTY','QTY1','PRICE','LINEVAL'], 'FINDOC=115576')));
  process.exit(0);
})();
