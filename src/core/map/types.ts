export type Role = "staff" | "guided";

// metres in the room's own frame: the entrance is (0, 0) and +y is the direction
// the recorder faced when starting at the entrance, looking into the room
export type Point = { x: number; y: number };

export type SpotKind = "place" | "obstacle";

export type Spot = {
  id: string;
  kind: SpotKind;
  name: string;
  x: number;
  y: number;
  radius: number; // obstacles: how much room they take, places: 0
  heading: number | null; // which way the recorder faced when adding it, room frame
  photo: string;
  thumb: string;
  videoTime: number;
  door?: boolean; // a door to another room
  leadsTo?: DoorRef | null; // the matching door on the other side
  description?: string; // what it looks and feels like, written by the ai from the photo, checked by a colleague
  opens?: DoorOpening | null; // doors: which way the door swings, seen from this room
  hazard?: Hazard | null; // obstacles a cane does not find or that need extra care
  via?: Passage | null; // doors: an ordinary door, or a lift or stairs to another floor
  stairs?: Stairs | null; // stairs: as met when leaving this room through them
};

export type Passage = "door" | "lift" | "stairs";
export type Stairs = { steps: number; going: "up" | "down"; handrail: "left" | "right" | "both" | "none" };

export type DoorOpening = "in" | "out" | "sliding";
export type Hazard = "glass" | "stairs" | "head";

// what runs along one wall of the outline (the wall from outline[i] to outline[i + 1]): a sofa or cabinets
// the recorder walked past are the edge a cane touches there, a glass wall needs saying
export type WallSide = { along?: string; glass?: boolean };

// one side of a door: the place that stands for it in a room's map
export type DoorRef = { mapId: string; spotId: string };

// a small photo taken automatically while recording, so the ai can look at every part of the room when it
// analyses the recording, not only the places. along: share of the wall walk (0 to 1), the position then follows the
// walls even after a reviewer changed them; otherwise x and y are used
export type View = {
  id: string;
  along: number | null;
  x: number;
  y: number;
  heading: number;
  image: string;
  intoRoom: boolean; // taken in a corner, looking into the room
};

export type MapStatus = "review" | "published";

export type FloorMap = {
  id: string;
  name: string;
  status: MapStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  videoUrl: string | null;
  outline: Point[]; // walls, walked around once, first point is the entrance
  spots: Spot[]; // the entrance is always the first place
  walked: Point[]; // the second walk, kept so reviewers can see how the spots were reached
  closureError: number; // metres between start and end of the wall walk before it was corrected
  version: number;
  walls?: WallSide[];
  floor?: string | null; // "2", "-1", "ground floor": said in the lift
};

// a first day at work: a colleague picks the places a new person should learn, the ai writes the words
export type Tour = {
  id: string;
  guest: string;
  stops: DoorRef[];
  welcome: string;
  stopTexts: string[];
  quiz: { question: string; expected: string }[];
  createdBy: string;
  createdAt: string;
};

export type MapSummary = Pick<FloorMap, "id" | "name" | "status" | "createdBy" | "createdAt" | "updatedAt"> & {
  placeCount: number;
  obstacleCount: number;
  places: { id: string; name: string; door: boolean; via?: Passage | null }[];
};

export type Problem = {
  id: string;
  mapId: string;
  placeId: string;
  reason: string;
  reportedBy: string;
  at: string;
  resolved: boolean;
};

// something in the way for a while (wet floor, boxes): guided routes go around it until it expires
export type TempObstacle = {
  id: string;
  mapId: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  until: string;
  reportedBy: string;
  at: string;
  removed: boolean;
  hazard?: Hazard | null;
};

export type RecordingRequest = {
  id: string;
  note: string;
  at: string;
  done: boolean;
};
