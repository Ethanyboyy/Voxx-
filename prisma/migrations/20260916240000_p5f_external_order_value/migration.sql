-- AlterTable
ALTER TABLE "ExperimentMeasurement" ADD COLUMN "observedAmountMinor" INTEGER;
ALTER TABLE "ExperimentMeasurement" ADD COLUMN "observedAmountScale" INTEGER;
ALTER TABLE "ExperimentMeasurement" ADD COLUMN "observedCurrency" TEXT;
