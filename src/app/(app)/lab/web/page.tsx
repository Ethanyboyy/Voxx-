import { getCurrentUser } from "@/lib/auth/session";
import { listWebProfiles } from "@/lib/lab/webLab";
import { listLabProjects } from "@/lib/lab/projects";
import { WebLabClient } from "@/components/lab/WebLabClient";

export default async function WebLabPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [profiles, projects] = await Promise.all([listWebProfiles(user.id), listLabProjects(user.id)]);

  return (
    <div className="vox-panel-in">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Web Lab</h1>
      <p className="mt-1 text-sm text-muted">
        Theoretical web-shooter material, deployment, and attachment research — simulated only, never a real-world
        validation.
      </p>
      <WebLabClient
        initialProfiles={profiles.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          material: p.material,
          deployment: p.deployment,
          attachment: p.attachment,
          loadModelCount: p.loadModels.length,
        }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
