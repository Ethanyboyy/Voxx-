import { getCurrentUser } from "@/lib/auth/session";
import { listMaterials } from "@/lib/lab/materials";
import { MaterialsClient } from "@/components/lab/MaterialsClient";

export default async function MaterialsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const materials = await listMaterials(user.id);

  return (
    <div className="vox-panel-in">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Materials Database</h1>
      <p className="mt-1 text-sm text-muted">Reference materials for suits, gadgets, and web formulas.</p>
      <MaterialsClient
        initialMaterials={materials.map((m) => ({
          id: m.id,
          name: m.name,
          category: m.category,
          densityGCm3: m.densityGCm3,
          tensileStrengthMpa: m.tensileStrengthMpa,
          elasticityPercent: m.elasticityPercent,
          abrasionResistance: m.abrasionResistance,
          temperatureResistanceC: m.temperatureResistanceC,
          moistureResistance: m.moistureResistance,
          costPerKgUsd: m.costPerKgUsd,
          notes: m.notes,
          confidence: m.confidence,
          isCustom: m.userId !== null,
        }))}
      />
    </div>
  );
}
