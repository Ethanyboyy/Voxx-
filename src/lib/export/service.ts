import { exportMemories } from "@/lib/memory/service";
import { listProjects, listGoals, listTasks, listDecisions, listIdeas, listExperiments } from "@/lib/projects/service";
import { listConversations, getConversation } from "@/lib/chat/service";
import { listResearchItems } from "@/lib/research/service";
import { getGraph } from "@/lib/knowledge/service";
import { listPatterns } from "@/lib/cognition/patterns";
import { listPermissions } from "@/lib/permissions/service";
import { getNotificationPreference } from "@/lib/notifications/service";
import { listAgentRuns } from "@/lib/agents/service";
import { listConnections } from "@/lib/connections/service";

/**
 * Full data portability export (§48 of the master directive): everything
 * VOX has stored about the user, as one JSON document. Reuses the existing
 * service layer exclusively — no raw db access here — and deliberately
 * excludes ConnectionCredential contents (secrets never leave the server).
 */
export async function exportAllData(userId: string) {
  const [
    memories,
    projects,
    goals,
    tasks,
    decisions,
    ideas,
    experiments,
    conversationSummaries,
    research,
    graph,
    patterns,
    permissions,
    notificationPreference,
    agentRuns,
    connections,
  ] = await Promise.all([
    exportMemories(userId),
    listProjects(userId),
    listGoals(userId),
    listTasks(userId),
    listDecisions(userId),
    listIdeas(userId),
    listExperiments(userId),
    listConversations(userId),
    listResearchItems(userId),
    getGraph(userId),
    listPatterns(userId),
    listPermissions(userId),
    getNotificationPreference(userId),
    listAgentRuns(userId, 500),
    listConnections(userId),
  ]);

  const conversations = await Promise.all(
    conversationSummaries.map((c) => getConversation(userId, c.id))
  );

  return {
    exportedAt: new Date().toISOString(),
    memories,
    projects,
    goals,
    tasks,
    decisions,
    ideas,
    experiments,
    conversations: conversations.filter(Boolean),
    research,
    knowledgeGraph: graph,
    patterns,
    permissions,
    notificationPreference,
    agentRuns,
    connections: connections.map((c) => ({
      service: c.catalog.service,
      displayName: c.catalog.displayName,
      status: c.status,
      readEnabled: c.connection?.readEnabled ?? false,
      writeEnabled: c.connection?.writeEnabled ?? false,
      // credential contents are intentionally omitted — secrets never leave the server
    })),
  };
}
