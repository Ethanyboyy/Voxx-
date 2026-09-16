-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN "externalScope" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "observationContractDigest" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "observationWindowMinutes" INTEGER;
ALTER TABLE "Experiment" ADD COLUMN "observationWindowStart" DATETIME;
