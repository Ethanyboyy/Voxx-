-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "plan" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN "traceId" TEXT;

-- CreateIndex
CREATE INDEX "AgentRun_userId_traceId_idx" ON "AgentRun"("userId", "traceId");
