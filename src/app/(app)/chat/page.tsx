import { getCurrentUser } from "@/lib/auth/session";
import { listConversations } from "@/lib/chat/service";
import { ChatClient } from "@/components/chat/ChatClient";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const conversations = await listConversations(user.id);

  return (
    <div className="flex h-full">
      <ChatClient
        initialConversations={conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() }))}
      />
    </div>
  );
}
