// Static seed data for the Spider-Man Laboratory — original fictional design
// concepts (not copyrighted movie assets). Stats are procedurally derived per
// archetype + a deterministic per-suit seed so every design has genuinely
// different numbers, not just a different name on identical stats.

export type Archetype = "Stealth" | "Combat" | "Recon" | "Utility" | "Experimental" | "Aerial" | "Urban" | "Tactical";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function range(rand: () => number, min: number, max: number) {
  return min + rand() * (max - min);
}

type Range = [number, number];
interface ArchetypeProfile {
  stealth: Range;
  durability: Range;
  mobility: Range;
  stretchiness: Range;
  weightKg: Range;
  thermalLoadC: Range;
  protection: Range;
  environmentalResistance: Range;
  manufacturingComplexity: Range;
  estimatedBuildHours: Range;
  estimatedCostUsd: Range;
  flexibility: Range;
  impactResistance: Range;
  visibility: Range;
  noiseProfile: Range;
  sensorCapacity: Range;
  energyRequirementW: Range;
  maintenanceComplexity: Range;
}

const PROFILES: Record<Archetype, ArchetypeProfile> = {
  Stealth: {
    stealth: [78, 96], durability: [38, 58], mobility: [55, 75], stretchiness: [55, 75],
    weightKg: [2.8, 4.4], thermalLoadC: [28, 36], protection: [32, 52], environmentalResistance: [40, 60],
    manufacturingComplexity: [55, 80], estimatedBuildHours: [90, 180], estimatedCostUsd: [18000, 42000],
    flexibility: [55, 78], impactResistance: [30, 50], visibility: [8, 24], noiseProfile: [5, 22],
    sensorCapacity: [42, 62], energyRequirementW: [10, 22], maintenanceComplexity: [35, 55],
  },
  Combat: {
    stealth: [15, 38], durability: [72, 96], mobility: [35, 55], stretchiness: [30, 50],
    weightKg: [6.2, 9.4], thermalLoadC: [34, 44], protection: [74, 96], environmentalResistance: [55, 78],
    manufacturingComplexity: [65, 92], estimatedBuildHours: [160, 320], estimatedCostUsd: [42000, 78000],
    flexibility: [28, 48], impactResistance: [75, 96], visibility: [48, 72], noiseProfile: [38, 62],
    sensorCapacity: [45, 65], energyRequirementW: [30, 55], maintenanceComplexity: [55, 80],
  },
  Recon: {
    stealth: [58, 78], durability: [42, 62], mobility: [62, 82], stretchiness: [45, 65],
    weightKg: [3.2, 5.1], thermalLoadC: [26, 34], protection: [32, 52], environmentalResistance: [45, 65],
    manufacturingComplexity: [50, 75], estimatedBuildHours: [100, 200], estimatedCostUsd: [28000, 52000],
    flexibility: [50, 72], impactResistance: [35, 55], visibility: [22, 42], noiseProfile: [15, 32],
    sensorCapacity: [78, 97], energyRequirementW: [18, 34], maintenanceComplexity: [45, 65],
  },
  Utility: {
    stealth: [40, 60], durability: [45, 68], mobility: [45, 65], stretchiness: [40, 60],
    weightKg: [3.8, 5.8], thermalLoadC: [28, 36], protection: [40, 62], environmentalResistance: [42, 62],
    manufacturingComplexity: [40, 65], estimatedBuildHours: [80, 160], estimatedCostUsd: [18000, 36000],
    flexibility: [42, 62], impactResistance: [40, 60], visibility: [35, 55], noiseProfile: [25, 45],
    sensorCapacity: [40, 62], energyRequirementW: [15, 30], maintenanceComplexity: [30, 50],
  },
  Experimental: {
    stealth: [25, 90], durability: [30, 90], mobility: [30, 92], stretchiness: [30, 90],
    weightKg: [2.5, 8.5], thermalLoadC: [24, 48], protection: [25, 90], environmentalResistance: [30, 90],
    manufacturingComplexity: [78, 100], estimatedBuildHours: [200, 420], estimatedCostUsd: [55000, 120000],
    flexibility: [30, 90], impactResistance: [30, 90], visibility: [15, 60], noiseProfile: [10, 55],
    sensorCapacity: [40, 95], energyRequirementW: [20, 60], maintenanceComplexity: [55, 92],
  },
  Aerial: {
    stealth: [35, 58], durability: [38, 58], mobility: [80, 97], stretchiness: [72, 92],
    weightKg: [2.2, 3.9], thermalLoadC: [26, 34], protection: [30, 48], environmentalResistance: [45, 68],
    manufacturingComplexity: [58, 82], estimatedBuildHours: [110, 210], estimatedCostUsd: [32000, 58000],
    flexibility: [70, 92], impactResistance: [32, 52], visibility: [30, 52], noiseProfile: [18, 36],
    sensorCapacity: [52, 72], energyRequirementW: [18, 32], maintenanceComplexity: [42, 62],
  },
  Urban: {
    stealth: [52, 72], durability: [52, 72], mobility: [58, 78], stretchiness: [45, 65],
    weightKg: [3.6, 5.4], thermalLoadC: [28, 36], protection: [45, 65], environmentalResistance: [42, 62],
    manufacturingComplexity: [48, 72], estimatedBuildHours: [95, 180], estimatedCostUsd: [24000, 44000],
    flexibility: [48, 68], impactResistance: [45, 65], visibility: [28, 48], noiseProfile: [22, 40],
    sensorCapacity: [45, 65], energyRequirementW: [16, 28], maintenanceComplexity: [38, 58],
  },
  Tactical: {
    stealth: [30, 52], durability: [62, 82], mobility: [45, 65], stretchiness: [35, 55],
    weightKg: [5.2, 7.6], thermalLoadC: [32, 40], protection: [62, 82], environmentalResistance: [55, 75],
    manufacturingComplexity: [58, 82], estimatedBuildHours: [140, 260], estimatedCostUsd: [36000, 62000],
    flexibility: [35, 55], impactResistance: [62, 82], visibility: [40, 60], noiseProfile: [30, 50],
    sensorCapacity: [58, 78], energyRequirementW: [24, 42], maintenanceComplexity: [48, 68],
  },
};

const USE_CASE: Record<Archetype, string> = {
  Stealth: "silent infiltration and low-visibility night operations",
  Combat: "sustained close-quarters engagement and heavy impact absorption",
  Recon: "long-range surveillance and rapid environmental data-gathering",
  Utility: "general-purpose fieldwork across varied conditions",
  Experimental: "pushing untested design assumptions ahead of production viability",
  Aerial: "high-speed traversal, gliding, and vertical mobility",
  Urban: "dense city navigation, rooftop-to-street transitions, and civilian-blend operation",
  Tactical: "coordinated team operations under structured threat assessment",
};

export function generateSuitStats(archetype: Archetype, seedIndex: number) {
  const rand = mulberry32(seedIndex * 7919 + 13);
  const p = PROFILES[archetype];
  const pick = (r: Range, round = true) => {
    const v = range(rand, r[0], r[1]);
    return round ? Math.round(v) : Number(v.toFixed(2));
  };
  return {
    stealth: pick(p.stealth),
    durability: pick(p.durability),
    mobility: pick(p.mobility),
    stretchiness: pick(p.stretchiness),
    weightKg: pick(p.weightKg, false),
    thermalLoadC: pick(p.thermalLoadC, false),
    protection: pick(p.protection),
    environmentalResistance: pick(p.environmentalResistance),
    manufacturingComplexity: pick(p.manufacturingComplexity),
    estimatedBuildHours: pick(p.estimatedBuildHours, false),
    estimatedCostUsd: Math.round(pick(p.estimatedCostUsd, false) / 100) * 100,
    flexibility: pick(p.flexibility),
    impactResistance: pick(p.impactResistance),
    visibility: pick(p.visibility),
    noiseProfile: pick(p.noiseProfile),
    sensorCapacity: pick(p.sensorCapacity),
    energyRequirementW: pick(p.energyRequirementW, false),
    maintenanceComplexity: pick(p.maintenanceComplexity),
    confidence: "ESTIMATED" as const,
  };
}

export interface SuitSpec {
  codename: string;
  archetype: Archetype;
  colorPrimary: string;
  colorSecondary: string;
}

const PALETTE: [string, string][] = [
  ["#a855f7", "#0a0616"], ["#38bdf8", "#0a1622"], ["#f87171", "#1a0a0a"], ["#34d399", "#06140f"],
  ["#fbbf24", "#1a1206"], ["#818cf8", "#0e0d1f"], ["#f472b6", "#1a0a14"], ["#2dd4bf", "#06171a"],
  ["#e2e8f0", "#0a0a0c"], ["#c084fc", "#0d0616"],
];

const SUIT_NAMES: [string, Archetype][] = [
  ["Nightcrawler", "Stealth"], ["Blackout", "Stealth"], ["Specter", "Stealth"], ["Widow", "Tactical"],
  ["Ghost", "Stealth"], ["Apex", "Combat"], ["Vanguard", "Tactical"], ["Velocity", "Aerial"],
  ["Phantom", "Stealth"], ["Eclipse", "Recon"], ["Sentinel", "Combat"], ["Arachnid-X", "Experimental"],
  ["Shadowline", "Stealth"], ["Carbon", "Utility"], ["Aegis", "Combat"], ["Mirage", "Recon"],
  ["Nightfall", "Stealth"], ["Recon", "Recon"], ["Pulse", "Utility"], ["Vector", "Aerial"],
  ["Horizon", "Recon"], ["Titan", "Combat"], ["Strider", "Urban"], ["Flux", "Experimental"],
  ["Wraith", "Stealth"], ["Stealth-X", "Stealth"], ["Urban", "Urban"], ["Hyperion", "Aerial"],
  ["Ghostline", "Stealth"], ["Spectra", "Recon"], ["Black Vector", "Aerial"], ["Spider-X", "Experimental"],
  ["Helix", "Utility"], ["Raven", "Stealth"], ["Zero", "Experimental"], ["Phantom-X", "Stealth"],
  ["Nightwing", "Aerial"], ["Circuit", "Utility"], ["Carbon-X", "Utility"], ["Apex Black", "Combat"],
  ["Vanguard-X", "Tactical"], ["Shadow", "Stealth"], ["Mercury", "Aerial"], ["Onyx", "Combat"],
  ["Nova", "Experimental"], ["Dark Matter", "Experimental"], ["Ghost Runner", "Urban"], ["Iron Spider-Inspired Concept", "Tactical"],
  ["Tactical Arachnid", "Tactical"], ["Urban Phantom", "Urban"], ["Night Sentinel", "Combat"], ["Hyper Velocity", "Aerial"],
  ["Widow-Inspired Concept", "Stealth"], ["Carbon Web", "Utility"], ["Eclipse-X", "Recon"], ["Spectral", "Recon"],
  ["Zero Point", "Experimental"], ["Arachnid Prime", "Tactical"], ["Laboratory Prototype", "Experimental"], ["Experimental Mk.60", "Experimental"],
];

export const SUIT_SPECS: SuitSpec[] = SUIT_NAMES.map(([codename, archetype], i) => {
  const [colorPrimary, colorSecondary] = PALETTE[i % PALETTE.length];
  return { codename, archetype, colorPrimary, colorSecondary };
});

export function suitDescription(spec: SuitSpec): string {
  return `${spec.codename} is a ${spec.archetype.toLowerCase()}-class prototype suit designed for ${USE_CASE[spec.archetype]}.`;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const MATERIAL_SPECS = [
  { name: "Polymer Weave", category: "Textile", densityGCm3: 1.1, tensileStrengthMpa: 420, elasticityPercent: 65, abrasionResistance: 62, temperatureResistanceC: 180, moistureResistance: 55, costPerKgUsd: 45, confidence: "ESTIMATED" as const },
  { name: "Carbon Composite Plate", category: "Composite", densityGCm3: 1.6, tensileStrengthMpa: 1800, elasticityPercent: 4, abrasionResistance: 85, temperatureResistanceC: 320, moistureResistance: 90, costPerKgUsd: 210, confidence: "VERIFIED" as const },
  { name: "Smart Fabric Mesh", category: "Textile", densityGCm3: 0.95, tensileStrengthMpa: 250, elasticityPercent: 85, abrasionResistance: 48, temperatureResistanceC: 140, moistureResistance: 60, costPerKgUsd: 180, confidence: "HYPOTHETICAL" as const },
  { name: "Ballistic Weave", category: "Textile", densityGCm3: 1.44, tensileStrengthMpa: 3000, elasticityPercent: 3, abrasionResistance: 90, temperatureResistanceC: 150, moistureResistance: 40, costPerKgUsd: 95, confidence: "VERIFIED" as const },
  { name: "Graphene Mesh", category: "Nanomaterial", densityGCm3: 1.05, tensileStrengthMpa: 5000, elasticityPercent: 20, abrasionResistance: 88, temperatureResistanceC: 400, moistureResistance: 80, costPerKgUsd: 1200, confidence: "HYPOTHETICAL" as const },
  { name: "Titanium Alloy Mesh", category: "Metal", densityGCm3: 4.5, tensileStrengthMpa: 900, elasticityPercent: 10, abrasionResistance: 78, temperatureResistanceC: 600, moistureResistance: 95, costPerKgUsd: 60, confidence: "VERIFIED" as const },
  { name: "Thermal Gel Layer", category: "Insulation", densityGCm3: 1.2, tensileStrengthMpa: 15, elasticityPercent: 95, abrasionResistance: 20, temperatureResistanceC: 90, moistureResistance: 70, costPerKgUsd: 35, confidence: "ESTIMATED" as const },
  { name: "Shock-Absorbing Foam", category: "Padding", densityGCm3: 0.3, tensileStrengthMpa: 5, elasticityPercent: 70, abrasionResistance: 25, temperatureResistanceC: 80, moistureResistance: 40, costPerKgUsd: 22, confidence: "VERIFIED" as const },
  { name: "Nanofiber Weave", category: "Nanomaterial", densityGCm3: 0.85, tensileStrengthMpa: 2200, elasticityPercent: 55, abrasionResistance: 80, temperatureResistanceC: 260, moistureResistance: 75, costPerKgUsd: 650, confidence: "HYPOTHETICAL" as const },
  { name: "Ceramic Plate", category: "Ceramic", densityGCm3: 3.9, tensileStrengthMpa: 380, elasticityPercent: 1, abrasionResistance: 92, temperatureResistanceC: 900, moistureResistance: 98, costPerKgUsd: 140, confidence: "VERIFIED" as const },
  { name: "Memory Polymer", category: "Polymer", densityGCm3: 1.15, tensileStrengthMpa: 90, elasticityPercent: 98, abrasionResistance: 40, temperatureResistanceC: 110, moistureResistance: 65, costPerKgUsd: 260, confidence: "HYPOTHETICAL" as const },
  { name: "Photoreactive Coating", category: "Coating", densityGCm3: 0.5, tensileStrengthMpa: 8, elasticityPercent: 30, abrasionResistance: 35, temperatureResistanceC: 120, moistureResistance: 55, costPerKgUsd: 320, confidence: "HYPOTHETICAL" as const },
  { name: "Conductive Thread", category: "Electronics substrate", densityGCm3: 2.1, tensileStrengthMpa: 600, elasticityPercent: 12, abrasionResistance: 55, temperatureResistanceC: 200, moistureResistance: 50, costPerKgUsd: 410, confidence: "ESTIMATED" as const },
  { name: "Ferrofluid Damping Layer", category: "Fluid composite", densityGCm3: 1.35, tensileStrengthMpa: 2, elasticityPercent: 100, abrasionResistance: 10, temperatureResistanceC: 130, moistureResistance: 85, costPerKgUsd: 380, confidence: "HYPOTHETICAL" as const },
  { name: "Aerogel Insulation", category: "Insulation", densityGCm3: 0.03, tensileStrengthMpa: 0.5, elasticityPercent: 5, abrasionResistance: 8, temperatureResistanceC: 200, moistureResistance: 20, costPerKgUsd: 900, confidence: "VERIFIED" as const },
  { name: "Self-Healing Polymer", category: "Polymer", densityGCm3: 1.05, tensileStrengthMpa: 60, elasticityPercent: 90, abrasionResistance: 45, temperatureResistanceC: 100, moistureResistance: 60, costPerKgUsd: 540, confidence: "HYPOTHETICAL" as const },
  { name: "Piezoelectric Film", category: "Electronics substrate", densityGCm3: 1.78, tensileStrengthMpa: 55, elasticityPercent: 8, abrasionResistance: 30, temperatureResistanceC: 150, moistureResistance: 45, costPerKgUsd: 480, confidence: "ESTIMATED" as const },
  { name: "Optical Camouflage Mesh", category: "Nanomaterial", densityGCm3: 0.9, tensileStrengthMpa: 180, elasticityPercent: 60, abrasionResistance: 38, temperatureResistanceC: 110, moistureResistance: 50, costPerKgUsd: 1500, confidence: "HYPOTHETICAL" as const },
  { name: "Reinforced Elastomer", category: "Polymer", densityGCm3: 1.2, tensileStrengthMpa: 300, elasticityPercent: 80, abrasionResistance: 58, temperatureResistanceC: 140, moistureResistance: 62, costPerKgUsd: 88, confidence: "VERIFIED" as const },
  { name: "Kevlar-Analog Weave", category: "Textile", densityGCm3: 1.44, tensileStrengthMpa: 2800, elasticityPercent: 4, abrasionResistance: 87, temperatureResistanceC: 160, moistureResistance: 45, costPerKgUsd: 70, confidence: "VERIFIED" as const },
];

// ---------------------------------------------------------------------------
// Gadgets
// ---------------------------------------------------------------------------

export const GADGET_SPECS = [
  { name: "Wrist Interface Mk.I", category: "Wrist Interface", massKg: 0.18, powerRequirementW: 3.5, batteryLifeHours: 14, durability: 60, sensorAccuracy: 70, rangeM: 12, manufacturingComplexity: 55, estimatedCostUsd: 2200, reliability: 82 },
  { name: "Long-Range Comm Unit", category: "Communication Device", massKg: 0.09, powerRequirementW: 1.2, batteryLifeHours: 30, durability: 55, sensorAccuracy: 60, rangeM: 8000, manufacturingComplexity: 45, estimatedCostUsd: 1400, reliability: 88 },
  { name: "Multi-Spectrum Sensor Module", category: "Sensor Module", massKg: 0.12, powerRequirementW: 2.8, batteryLifeHours: 10, durability: 50, sensorAccuracy: 92, rangeM: 300, manufacturingComplexity: 72, estimatedCostUsd: 3600, reliability: 79 },
  { name: "Compact Recon Camera", category: "Compact Camera", massKg: 0.06, powerRequirementW: 0.9, batteryLifeHours: 6, durability: 40, sensorAccuracy: 85, rangeM: 150, manufacturingComplexity: 40, estimatedCostUsd: 950, reliability: 75 },
  { name: "Environmental Analyzer", category: "Environmental Sensor", massKg: 0.14, powerRequirementW: 2.1, batteryLifeHours: 20, durability: 58, sensorAccuracy: 88, rangeM: 5, manufacturingComplexity: 60, estimatedCostUsd: 2800, reliability: 84 },
  { name: "Wearable Field Computer", category: "Wearable Computer", massKg: 0.35, powerRequirementW: 6.5, batteryLifeHours: 9, durability: 62, sensorAccuracy: 65, rangeM: 0, manufacturingComplexity: 78, estimatedCostUsd: 5200, reliability: 80 },
  { name: "Suit Power-Management Core", category: "Power Management", massKg: 0.42, powerRequirementW: 0, batteryLifeHours: 48, durability: 70, sensorAccuracy: 50, rangeM: 0, manufacturingComplexity: 82, estimatedCostUsd: 6800, reliability: 90 },
  { name: "Web-Fluid Interface Rig", category: "Web-System Interface", massKg: 0.28, powerRequirementW: 1.5, batteryLifeHours: 25, durability: 55, sensorAccuracy: 55, rangeM: 25, manufacturingComplexity: 68, estimatedCostUsd: 3100, reliability: 76 },
  { name: "Tactical Navigation Unit", category: "Navigation Device", massKg: 0.1, powerRequirementW: 1.8, batteryLifeHours: 16, durability: 52, sensorAccuracy: 78, rangeM: 0, manufacturingComplexity: 50, estimatedCostUsd: 1900, reliability: 85 },
  { name: "Reflex Training Sensor", category: "Training Sensor", massKg: 0.05, powerRequirementW: 0.6, batteryLifeHours: 40, durability: 45, sensorAccuracy: 82, rangeM: 3, manufacturingComplexity: 35, estimatedCostUsd: 650, reliability: 88 },
  { name: "Personal Emergency Beacon", category: "Emergency Beacon", massKg: 0.07, powerRequirementW: 0.4, batteryLifeHours: 72, durability: 65, sensorAccuracy: 40, rangeM: 15000, manufacturingComplexity: 30, estimatedCostUsd: 480, reliability: 95 },
  { name: "Multi-Tool Utility Rig", category: "Utility Device", massKg: 0.22, powerRequirementW: 0.8, batteryLifeHours: 20, durability: 68, sensorAccuracy: 45, rangeM: 1, manufacturingComplexity: 42, estimatedCostUsd: 1100, reliability: 83 },
  { name: "Thermal Imaging Visor Module", category: "Sensor Module", massKg: 0.13, powerRequirementW: 2.4, batteryLifeHours: 12, durability: 48, sensorAccuracy: 90, rangeM: 200, manufacturingComplexity: 70, estimatedCostUsd: 4200, reliability: 78 },
  { name: "Micro-Drone Deploy Pack", category: "Utility Device", massKg: 0.5, powerRequirementW: 8, batteryLifeHours: 2, durability: 40, sensorAccuracy: 75, rangeM: 500, manufacturingComplexity: 85, estimatedCostUsd: 7400, reliability: 65 },
  { name: "Adaptive Camouflage Controller", category: "Wearable Computer", massKg: 0.31, powerRequirementW: 5.5, batteryLifeHours: 4, durability: 44, sensorAccuracy: 60, rangeM: 0, manufacturingComplexity: 90, estimatedCostUsd: 9800, reliability: 58 },
];

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export const SCENARIO_SPECS = [
  { name: "Rooftop Night Patrol", environment: "ROOFTOP" as const, objectiveType: "NAVIGATION" as const, difficulty: "BEGINNER" as const, timeOfDay: "night", precipitation: "none", windMs: 4, temperatureC: 12, fogPercent: 5, surfaceType: "gravel roof", elevationM: 45, obstacleCount: 4, description: "Standard rooftop-to-rooftop traversal patrol under clear night conditions." },
  { name: "Warehouse Infiltration", environment: "WAREHOUSE" as const, objectiveType: "ESCAPE" as const, difficulty: "INTERMEDIATE" as const, timeOfDay: "night", precipitation: "none", windMs: 0, temperatureC: 16, fogPercent: 0, surfaceType: "concrete", elevationM: 0, obstacleCount: 9, description: "Interior navigation and exit under low-visibility indoor conditions." },
  { name: "Urban Street Chase", environment: "URBAN_STREET" as const, objectiveType: "TIMED_TRAVERSAL" as const, difficulty: "INTERMEDIATE" as const, timeOfDay: "day", precipitation: "none", windMs: 6, temperatureC: 22, fogPercent: 0, surfaceType: "asphalt", elevationM: 5, obstacleCount: 12, description: "Fast timed traversal through dense street-level obstacles and traffic." },
  { name: "Industrial Sabotage Response", environment: "INDUSTRIAL_FACILITY" as const, objectiveType: "EQUIPMENT_TEST" as const, difficulty: "ADVANCED" as const, timeOfDay: "day", precipitation: "none", windMs: 2, temperatureC: 34, fogPercent: 0, surfaceType: "steel grating", elevationM: 18, obstacleCount: 10, description: "High-heat industrial environment stress-testing equipment reliability." },
  { name: "Forest Extraction", environment: "FOREST" as const, objectiveType: "RESCUE" as const, difficulty: "ADVANCED" as const, timeOfDay: "day", precipitation: "rain", windMs: 9, temperatureC: 14, fogPercent: 30, surfaceType: "wet earth", elevationM: 60, obstacleCount: 14, description: "Rescue traversal through dense forest canopy under rain and wind." },
  { name: "Training Arena Basic Course", environment: "TRAINING_ARENA" as const, objectiveType: "TRAINING" as const, difficulty: "BEGINNER" as const, timeOfDay: "day", precipitation: "none", windMs: 0, temperatureC: 20, fogPercent: 0, surfaceType: "padded mat", elevationM: 0, obstacleCount: 6, description: "Controlled beginner course for movement and agility fundamentals." },
  { name: "Rooftop Storm Traverse", environment: "ROOFTOP" as const, objectiveType: "NAVIGATION" as const, difficulty: "EXPERIMENTAL" as const, timeOfDay: "night", precipitation: "rain", windMs: 18, temperatureC: 8, fogPercent: 40, surfaceType: "wet metal", elevationM: 70, obstacleCount: 8, description: "Extreme-weather rooftop traversal — experimental stress scenario." },
  { name: "Urban Rescue Timed", environment: "URBAN_STREET" as const, objectiveType: "RESCUE" as const, difficulty: "ADVANCED" as const, timeOfDay: "day", precipitation: "none", windMs: 5, temperatureC: 26, fogPercent: 0, surfaceType: "asphalt", elevationM: 10, obstacleCount: 11, description: "Timed civilian rescue traversal through a dense urban block." },
  { name: "Industrial Environmental Test", environment: "INDUSTRIAL_FACILITY" as const, objectiveType: "ENVIRONMENTAL_TEST" as const, difficulty: "INTERMEDIATE" as const, timeOfDay: "day", precipitation: "none", windMs: 3, temperatureC: 40, fogPercent: 10, surfaceType: "steel grating", elevationM: 25, obstacleCount: 7, description: "Thermal and structural environmental stress test for equipment." },
  { name: "Laboratory Equipment Test", environment: "LABORATORY" as const, objectiveType: "EQUIPMENT_TEST" as const, difficulty: "BEGINNER" as const, timeOfDay: "day", precipitation: "none", windMs: 0, temperatureC: 21, fogPercent: 0, surfaceType: "polished floor", elevationM: 0, obstacleCount: 2, description: "Controlled indoor baseline test for new equipment calibration." },
];

// ---------------------------------------------------------------------------
// Training modules
// ---------------------------------------------------------------------------

export const TRAINING_MODULE_SPECS = [
  { name: "Basic Movement Drill", category: "MOVEMENT" as const, difficulty: "BEGINNER" as const, description: "Fundamentals of controlled directional movement.", objective: "Build baseline movement consistency.", durationMinutesEstimate: 10 },
  { name: "Advanced Traversal", category: "MOVEMENT" as const, difficulty: "ADVANCED" as const, description: "Multi-surface directional transitions at speed.", objective: "Maintain efficiency across changing terrain.", durationMinutesEstimate: 20 },
  { name: "Agility Ladder Course", category: "AGILITY" as const, difficulty: "BEGINNER" as const, description: "Short-interval footwork and direction changes.", objective: "Improve agility score baseline.", durationMinutesEstimate: 8 },
  { name: "Obstacle Agility Circuit", category: "AGILITY" as const, difficulty: "INTERMEDIATE" as const, description: "Combined agility and obstacle transitions.", objective: "Sustain agility under obstacle load.", durationMinutesEstimate: 15 },
  { name: "Balance Beam Protocol", category: "BALANCE" as const, difficulty: "BEGINNER" as const, description: "Narrow-surface balance control exercises.", objective: "Establish balance score baseline.", durationMinutesEstimate: 10 },
  { name: "Dynamic Balance Recovery", category: "BALANCE" as const, difficulty: "ADVANCED" as const, description: "Balance recovery under simulated destabilization.", objective: "Improve recovery speed after imbalance.", durationMinutesEstimate: 12 },
  { name: "Reflex Tap Trainer", category: "REACTION" as const, difficulty: "BEGINNER" as const, description: "Simple visual-cue reaction timing.", objective: "Establish baseline reaction time.", durationMinutesEstimate: 5 },
  { name: "Rapid Reflex Chain", category: "REACTION" as const, difficulty: "ADVANCED" as const, description: "Sequential reaction cues under time pressure.", objective: "Reduce reaction time variance.", durationMinutesEstimate: 10 },
  { name: "Obstacle Navigation Basics", category: "OBSTACLE_NAVIGATION" as const, difficulty: "BEGINNER" as const, description: "Simple obstacle traversal sequencing.", objective: "Build obstacle-clearing consistency.", durationMinutesEstimate: 12 },
  { name: "Complex Obstacle Field", category: "OBSTACLE_NAVIGATION" as const, difficulty: "ADVANCED" as const, description: "Dense multi-obstacle traversal under time pressure.", objective: "Sustain efficiency across a complex field.", durationMinutesEstimate: 18 },
  { name: "Defensive Positioning Fundamentals", category: "DEFENSIVE_POSITIONING" as const, difficulty: "BEGINNER" as const, description: "Basic stance and spatial positioning drills.", objective: "Establish defensive positioning baseline.", durationMinutesEstimate: 10 },
  { name: "Situational Awareness Scan", category: "SITUATIONAL_AWARENESS" as const, difficulty: "INTERMEDIATE" as const, description: "Environment-scanning and threat-identification drills.", objective: "Improve awareness scoring under distraction.", durationMinutesEstimate: 10 },
  { name: "De-Escalation Scenario Walkthrough", category: "DE_ESCALATION" as const, difficulty: "INTERMEDIATE" as const, description: "Decision-based de-escalation scenario training.", objective: "Improve decision quality under simulated tension.", durationMinutesEstimate: 15 },
  { name: "Emergency Escape Drill", category: "EMERGENCY_ESCAPE" as const, difficulty: "INTERMEDIATE" as const, description: "Timed emergency egress simulation.", objective: "Reduce escape completion time safely.", durationMinutesEstimate: 12 },
  { name: "Controlled Sparring Fundamentals", category: "SPARRING" as const, difficulty: "INTERMEDIATE" as const, description: "Simulated-opponent timing and spacing drills — non-contact, decision-focused.", objective: "Improve timing and defensive success rate.", durationMinutesEstimate: 15 },
];

// ---------------------------------------------------------------------------
// Tutorials
// ---------------------------------------------------------------------------

export const TUTORIAL_SPECS = [
  {
    key: "suit-tech-101", title: "Suit Technology 101", category: "SUIT_TECHNOLOGY" as const, difficulty: "BEGINNER" as const,
    lesson: "Every suit in the lab is built from layered components — outer shell, structural layer, thermal management, electronics, and sensors — each independently inspectable and swappable.",
    demonstration: "Open any suit in the Suit Bay and expand its component tree to see the layers in practice.",
    exercisePrompt: "Open a suit and identify its outer layer material.",
    quiz: [{ question: "What does the 'structural layer' primarily provide?", options: ["Camouflage color", "Load-bearing rigidity/durability", "Battery storage"], answerIndex: 1 }],
    prerequisiteKey: null as string | null,
  },
  {
    key: "materials-basics", title: "Materials Science Basics", category: "MATERIALS" as const, difficulty: "BEGINNER" as const,
    lesson: "Materials are compared on density, tensile strength, elasticity, abrasion/temperature/moisture resistance, and cost — each affects a design's weight, durability, and manufacturability tradeoffs.",
    demonstration: "Browse the Materials database and compare Carbon Composite Plate against Shock-Absorbing Foam.",
    exercisePrompt: "Find the material with the highest tensile strength in the database.",
    quiz: [{ question: "A material with high tensile strength but low elasticity is typically:", options: ["Stretchy and soft", "Rigid and strong", "Lightweight but weak"], answerIndex: 1 }],
    prerequisiteKey: null as string | null,
  },
  {
    key: "physics-web", title: "Physics of Theoretical Web-Systems", category: "PHYSICS" as const, difficulty: "INTERMEDIATE" as const,
    lesson: "Swing dynamics combine gravity and centripetal acceleration; the Web Lab's load model computes static/dynamic load, force, and tension from user mass, equipment mass, swing radius, and velocity. All results are HYPOTHETICAL engineering estimates, never real-world safety validation.",
    demonstration: "Open the Web Lab, view a profile's load models, and note the safety notice on every result.",
    exercisePrompt: "Compute a load model with a higher swing velocity and observe how force scales.",
    quiz: [{ question: "Web Lab load-model results represent:", options: ["A certified safety rating", "A theoretical simulation output only", "A manufacturing spec"], answerIndex: 1 }],
    prerequisiteKey: null as string | null,
  },
  {
    key: "engineering-principles", title: "Engineering Design Principles", category: "ENGINEERING" as const, difficulty: "INTERMEDIATE" as const,
    lesson: "Good iterative design tracks versions explicitly — every change should be a new version with a note explaining the tradeoff, so history stays inspectable rather than being silently overwritten.",
    demonstration: "Open a suit's version history and read a variant's note.",
    exercisePrompt: "Use the AI Lab Engineer to generate a lighter variant of a suit and review what changed.",
    quiz: [{ question: "Why version a design instead of editing stats in place?", options: ["It's required by law", "It preserves iteration history for comparison", "It reduces file size"], answerIndex: 1 }],
    prerequisiteKey: "suit-tech-101",
  },
  {
    key: "movement-fundamentals", title: "Movement Fundamentals", category: "MOVEMENT" as const, difficulty: "BEGINNER" as const,
    lesson: "Efficient movement balances speed against control — the Training Center's movement modules measure this via completion time and self-assessed efficiency.",
    demonstration: "Open Training Center and review the Basic Movement Drill module.",
    exercisePrompt: "Complete a training session and review your composite score.",
    quiz: [{ question: "What does the Training Center's composite score represent?", options: ["A random number", "An average of the metrics your session actually measured", "Your suit's mobility stat"], answerIndex: 1 }],
    prerequisiteKey: null as string | null,
  },
  {
    key: "defensive-awareness", title: "Defensive Awareness Basics", category: "DEFENSIVE_AWARENESS" as const, difficulty: "INTERMEDIATE" as const,
    lesson: "Defensive awareness training in this lab focuses on positioning, scanning, and decision quality — never on offensive techniques or causing harm.",
    demonstration: "Review the Defensive Positioning Fundamentals module description.",
    exercisePrompt: "Complete a situational-awareness training session.",
    quiz: [{ question: "This lab's defensive training is focused on:", options: ["Offensive combat technique", "Positioning, awareness, and safe decision-making", "Weapon handling"], answerIndex: 1 }],
    prerequisiteKey: "movement-fundamentals",
  },
  {
    key: "simulation-interpretation", title: "Interpreting Simulation Results", category: "SIMULATION" as const, difficulty: "INTERMEDIATE" as const,
    lesword: undefined,
    lesson: "Simulation telemetry (velocity, force, thermal load, fatigue) is a deterministic model output — useful for comparing design variants, but never a substitute for real-world testing.",
    demonstration: "Run a simulation in the Simulation Center and review its warnings list.",
    exercisePrompt: "Run the same simulation twice with different seeds and compare peak force.",
    quiz: [{ question: "A simulation warning about peak dynamic load means:", options: ["The design is certified unsafe", "The simulated load is high relative to body weight — worth noting, not a certification", "The simulation failed"], answerIndex: 1 }],
    prerequisiteKey: "physics-web",
  },
  {
    key: "equipment-operation", title: "Equipment Operation Safety", category: "EQUIPMENT_OPERATION" as const, difficulty: "BEGINNER" as const,
    lesson: "Every gadget has a reliability rating and power requirement — operating equipment outside its tested envelope (power, thermal, range) increases failure probability.",
    demonstration: "Open a gadget in the Engineering Bay and note its reliability and power stats.",
    exercisePrompt: "Compare two gadgets' reliability ratings.",
    quiz: [{ question: "A gadget's 'reliability' stat estimates:", options: ["Its purchase cost", "How consistently it performs as expected", "Its color"], answerIndex: 1 }],
    prerequisiteKey: null as string | null,
  },
  {
    key: "lab-safety", title: "Laboratory Safety Protocols", category: "LABORATORY_SAFETY" as const, difficulty: "BEGINNER" as const,
    lesson: "This lab clearly separates VERIFIED, ESTIMATED, HYPOTHETICAL, and UNKNOWN data. High-risk categories (human suspension, high-speed, structural attachment) always carry explicit simulation-only warnings and require independent professional validation before any real-world use.",
    demonstration: "Visit Data / Knowledge to see the confidence framework explained.",
    exercisePrompt: "Find one HYPOTHETICAL-confidence value in the Web Lab.",
    quiz: [{ question: "What does a HYPOTHETICAL confidence tag mean?", options: ["Independently verified fact", "A conceptual assumption, not measured or validated", "A manufacturing certainty"], answerIndex: 1 }],
    prerequisiteKey: null as string | null,
  },
  {
    key: "advanced-inspection", title: "Advanced Component Inspection", category: "ENGINEERING" as const, difficulty: "ADVANCED" as const,
    lesson: "Deep component trees (e.g. Mask → Lens System → Optical Module → Sensor Component) let you trace exactly which sub-part drives a given capability or weakness.",
    demonstration: "Open a flagship suit's Mask component and expand its nested sub-components.",
    exercisePrompt: "Trace a suit's sensor capability down to its deepest nested component.",
    quiz: [{ question: "Why nest components several levels deep?", options: ["To make the UI look busy", "To let engineering claims be traced to the specific sub-part responsible", "It's required by the database"], answerIndex: 1 }],
    prerequisiteKey: "suit-tech-101",
  },
];

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const PROJECT_SPECS = [
  { name: "Nightcrawler Program", description: "Stealth-suit iteration program built around the Nightcrawler family of designs." },
  { name: "Web System Alpha", description: "Theoretical web-shooter research track — material, deployment, and load modeling." },
  { name: "Mask Sensor Platform", description: "Cross-suit sensor and optics module standardization effort." },
  { name: "Urban Recon Initiative", description: "Recon and Urban archetype suits tuned for dense city operation." },
  { name: "Materials Research Track", description: "Ongoing material candidate evaluation for next-generation suit layers." },
];

// ---------------------------------------------------------------------------
// Experiments (hypothesis text — attached to specific suits at seed time)
// ---------------------------------------------------------------------------

export const EXPERIMENT_SPECS = [
  { title: "Reduce suit mass while maintaining mobility", hypothesis: "A 15% mass reduction on a Stealth-class suit will increase mobility without a proportional loss in protection.", status: "COMPLETED" as const, outcome: "Mass reduced 15%, mobility increased ~12%, durability decreased ~10% as expected.", confidence: "ESTIMATED" as const },
  { title: "Thermal load reduction via ventilated structural layer", hypothesis: "Adding ventilation channels to the structural layer reduces thermal load by at least 10% under sustained activity.", status: "COMPLETED" as const, outcome: "Thermal load reduced 11% in simulation; real-world validation still required.", confidence: "ESTIMATED" as const },
  { title: "Sensor capacity vs. stealth tradeoff", hypothesis: "Increasing sensor capacity above 80 forces visibility above 40 for Recon-class suits.", status: "FAILED" as const, outcome: "Correlation was weaker than hypothesized — sensor capacity and visibility were only loosely coupled in the tested variants.", confidence: "ESTIMATED" as const },
  { title: "Noise profile reduction on Combat-class suits", hypothesis: "Swapping to a softer outer material reduces noise profile by 20% with under 5% durability loss.", status: "RUNNING" as const, outcome: null, confidence: "HYPOTHETICAL" as const },
  { title: "Web-line dynamic load at increased swing velocity", hypothesis: "Doubling swing velocity more than doubles dynamic load due to the centripetal term.", status: "COMPLETED" as const, outcome: "Confirmed — dynamic load scaled superlinearly with velocity as the physics model predicts.", confidence: "ESTIMATED" as const },
  { title: "Manufacturing complexity ceiling for Experimental suits", hypothesis: "Experimental-class suits above 90 manufacturing complexity show diminishing stat returns.", status: "PLANNED" as const, outcome: null, confidence: "HYPOTHETICAL" as const },
  { title: "Reaction-time correlation with training frequency", hypothesis: "Repeated Reflex Tap Trainer sessions reduce measured reaction time over a training week.", status: "PLANNED" as const, outcome: null, confidence: "HYPOTHETICAL" as const },
  { title: "Fatigue accumulation under high equipment mass", hypothesis: "Simulated fatigue crosses 80% before 20s of sustained activity when equipment mass exceeds 3kg.", status: "COMPLETED" as const, outcome: "Confirmed in simulation for equipment mass above ~3.2kg at Advanced difficulty scenarios.", confidence: "ESTIMATED" as const },
  { title: "Aerial-class stretchiness vs. impact resistance", hypothesis: "High-stretchiness Aerial suits sacrifice impact resistance disproportionately compared to Urban-class.", status: "ABANDONED" as const, outcome: "Insufficient distinct variants tested before the research track was reprioritized.", confidence: "UNKNOWN" as const },
  { title: "Material cost vs. abrasion resistance efficiency frontier", hypothesis: "Graphene Mesh offers the best abrasion-resistance-per-dollar among nanomaterial candidates.", status: "FAILED" as const, outcome: "Kevlar-Analog Weave outperformed Graphene Mesh on a cost-normalized basis in this pass.", confidence: "ESTIMATED" as const },
];
