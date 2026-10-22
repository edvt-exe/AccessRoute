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
};

// a small photo taken automatically while recording, so the camera can later recognise any part of
// the room, not only the places. along: share of the wall walk (0 to 1), the position then follows the
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
};

export type MapSummary = Pick<FloorMap, "id" | "name" | "status" | "createdBy" | "createdAt" | "updatedAt"> & {
  placeCount: number;
  obstacleCount: number;
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

export type RecordingRequest = {
  id: string;
  note: string;
  at: string;
  done: boolean;
};
