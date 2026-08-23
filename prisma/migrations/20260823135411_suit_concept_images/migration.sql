-- CreateTable
CREATE TABLE "LabSuitImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "suitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabSuitImage_suitId_fkey" FOREIGN KEY ("suitId") REFERENCES "LabSuit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
