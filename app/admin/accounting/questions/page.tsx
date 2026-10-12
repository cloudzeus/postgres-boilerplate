import { requirePermission, hasPermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { loadAccountingQuestions, QUESTION_GROUP_LABEL } from '@/lib/accounting/questions';
import { QuestionsClient } from './questions-client';

export const dynamic = 'force-dynamic';

/**
 * ΕΡΩΤΗΜΑΤΑ ΛΟΓΙΣΤΗ — κάθε απόφαση λογιστικοποίησης που πήρε η εφαρμογή, για έγκριση ή αλλαγή.
 * Παράγονται ζωντανά (βλ. `lib/accounting/questions.ts`): νέα απόφαση ⇒ νέο ερώτημα.
 */
export default async function AccountingQuestionsPage() {
  await requirePermission('metadata.read');
  const [questions, canAnswer] = await Promise.all([loadAccountingQuestions(), hasPermission('ocr.categorize')]);
  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Ερωτήματα λογιστή"
        description="Πώς καταχωρείται κάθε κατηγορία δαπάνης, ποιοι λογαριασμοί και ποια έξοδα δημιουργήθηκαν — για έγκριση ή αλλαγή από τον λογιστή."
        helpAnchor="accounting-questions"
      />
      <QuestionsClient questions={questions} groupLabels={QUESTION_GROUP_LABEL} canAnswer={canAnswer} />
    </div>
  );
}
