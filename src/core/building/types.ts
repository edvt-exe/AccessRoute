// Contractul hartii. Il modificam doar impreuna, toti trei.

export type LandmarkKind =
  | "entrance" | "lift" | "stairs" | "ramp" | "toilet" | "room" | "exit" | "other";

export type Landmark = {
  id: string;
  name: string;            // "Liftul principal"
  kind: LandmarkKind;
  floor: number;           // 0 = parter
  photo?: string;          // URL (Vercel Blob)
  note?: string;           // observatie vocala transcrisa
};

export type Route = {
  id: string;
  from: string;            // Landmark.id
  to: string;              // Landmark.id
  seconds: number;         // timp masurat intre repere
  meters: number;          // aproximativ: seconds * ~1.3
  stairs: boolean;
  doorType: "none" | "automatic" | "manual" | "heavy";
  lighting: "low" | "normal" | "bright";
  noise: "low" | "medium" | "high";
  instruction: string;     // text scurt, citit cu voce tare
  photo?: string;
  blocked?: boolean;       // setat de alerts (lift defect etc.)
};

export type BuildingMap = {
  id: string;
  name: string;
  version: number;
  status: "draft" | "published";   // doar "published" e folosit la navigare
  landmarks: Landmark[];
  routes: Route[];
  updatedAt: string;       // ISO
};

export type RouteProfile = {
  wheelchair: boolean;     // fara scari
  quiet: boolean;          // evita zonele zgomotoase
  voice: boolean;          // indicatii vocale
  paceFactor: number;      // 1 = normal; calibrat per persoana
};

export type Outage = {
  id: string;
  routeId?: string;
  landmarkId?: string;
  reason: string;
  reportedAt: string;
  resolved: boolean;
};

export type Alarm = {
  id: string;
  active: boolean;
  startedAt: string;
  message: string;
};
