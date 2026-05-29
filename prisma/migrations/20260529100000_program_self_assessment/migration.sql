-- CreateEnum
CREATE TYPE "QuestionnaireScoringModel" AS ENUM ('WEIGHTED', 'POINTS_SUM');

-- CreateEnum
CREATE TYPE "QuestionnaireStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "QuestionAnswerType" AS ENUM ('BOOLEAN', 'SINGLE_CHOICE', 'NUMERIC', 'SCALE');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssessmentVerdict" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AnswerSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "ProgramQuestionnaire" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "scoringModel" "QuestionnaireScoringModel" NOT NULL DEFAULT 'WEIGHTED',
    "threshold" DECIMAL(8,2),
    "maxScore" DECIMAL(8,2),
    "sourceNote" TEXT,
    "status" "QuestionnaireStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedModel" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramQuestionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramQuestion" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "code" TEXT,
    "text" TEXT NOT NULL,
    "criterionRef" TEXT,
    "helpText" TEXT,
    "answerType" "QuestionAnswerType" NOT NULL DEFAULT 'SINGLE_CHOICE',
    "weight" DECIMAL(8,2),
    "maxPoints" DECIMAL(8,2),
    "companyField" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProgramQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramQuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProgramQuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAssessment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "questionnaireId" TEXT,
    "eligible" BOOLEAN,
    "eligibilityResult" JSONB,
    "questionnaireScore" DECIMAL(8,2),
    "questionnaireMax" DECIMAL(8,2),
    "questionnairePassed" BOOLEAN,
    "overallVerdict" "AssessmentVerdict" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAnswer" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueBool" BOOLEAN,
    "valueNumber" DECIMAL(14,4),
    "valueText" TEXT,
    "selectedOptionId" TEXT,
    "pointsAwarded" DECIMAL(8,2),
    "source" "AnswerSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "AssessmentAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramQuestionnaire_programId_key" ON "ProgramQuestionnaire"("programId");

-- CreateIndex
CREATE INDEX "ProgramQuestion_questionnaireId_idx" ON "ProgramQuestion"("questionnaireId");

-- CreateIndex
CREATE INDEX "ProgramQuestionOption_questionId_idx" ON "ProgramQuestionOption"("questionId");

-- CreateIndex
CREATE INDEX "CompanyAssessment_companyId_idx" ON "CompanyAssessment"("companyId");

-- CreateIndex
CREATE INDEX "CompanyAssessment_programId_idx" ON "CompanyAssessment"("programId");

-- CreateIndex
CREATE INDEX "CompanyAssessment_programId_eligible_idx" ON "CompanyAssessment"("programId", "eligible");

-- CreateIndex
CREATE INDEX "AssessmentAnswer_assessmentId_idx" ON "AssessmentAnswer"("assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentAnswer_questionId_idx" ON "AssessmentAnswer"("questionId");

-- AddForeignKey
ALTER TABLE "ProgramQuestionnaire" ADD CONSTRAINT "ProgramQuestionnaire_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramQuestion" ADD CONSTRAINT "ProgramQuestion_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "ProgramQuestionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramQuestionOption" ADD CONSTRAINT "ProgramQuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ProgramQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAssessment" ADD CONSTRAINT "CompanyAssessment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAssessment" ADD CONSTRAINT "CompanyAssessment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAssessment" ADD CONSTRAINT "CompanyAssessment_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "ProgramQuestionnaire"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAnswer" ADD CONSTRAINT "AssessmentAnswer_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CompanyAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAnswer" ADD CONSTRAINT "AssessmentAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ProgramQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
