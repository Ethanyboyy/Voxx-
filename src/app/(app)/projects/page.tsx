import { getCurrentUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/projects/service";
import { ProjectsClient } from "@/components/projects/ProjectsClient";
import { RoomHeader } from "@/components/ui/Instrument";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const projects = await listProjects(user.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <RoomHeader
        system="Execution"
        title="Projects"
        description={<>Everything VOX is helping you build or move forward.</>}
      />
      <ProjectsClient
        initialProjects={projects.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
