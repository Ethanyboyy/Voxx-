import { db } from "@/lib/db";

export async function addDesignNote(userId: string, subjectType: string, subjectId: string, content: string) {
  return db.labDesignNote.create({ data: { userId, subjectType, subjectId, content } });
}

export async function listDesignNotes(userId: string, subjectType: string, subjectId: string) {
  return db.labDesignNote.findMany({
    where: { userId, subjectType, subjectId },
    orderBy: { createdAt: "desc" },
  });
}
