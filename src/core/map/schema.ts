import { z } from "zod";

const jpeg = z.string().startsWith("data:image/jpeg;base64,");
const metres = z.number().min(-500).max(500);

export const mapIdSchema = z.string().regex(/^[a-z0-9-]{3,60}$/);

export const pointSchema = z.object({ x: metres, y: metres });

export const spotSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["place", "obstacle"]),
  name: z.string().trim().min(1).max(60),
  x: metres,
  y: metres,
  radius: z.number().min(0).max(5),
  heading: z.number().min(0).max(360).nullable(),
  // an obstacle added later on the drawing has no photo
  photo: z.union([jpeg, z.string().url(), z.literal("")]),
  thumb: z.union([jpeg, z.string().url(), z.literal("")]),
  videoTime: z.number().nonnegative(),
  door: z.boolean().optional(),
  description: z.string().max(300).optional(),
  opens: z.enum(["in", "out", "sliding"]).nullable().optional(),
  hazard: z.enum(["glass", "stairs", "head"]).nullable().optional(),
  leadsTo: z.object({ mapId: mapIdSchema, spotId: z.string().min(1).max(40) }).nullable().optional(),
  via: z.enum(["door", "lift", "stairs"]).nullable().optional(),
  stairs: z
    .object({ steps: z.number().int().min(1).max(200), going: z.enum(["up", "down"]), handrail: z.enum(["left", "right", "both", "none"]) })
    .nullable()
    .optional(),
});

export const viewSchema = z.object({
  id: z.string().regex(/^v\d{1,4}$/),
  along: z.number().min(0).max(1).nullable(),
  x: metres,
  y: metres,
  heading: z.number().min(0).max(360),
  image: jpeg.max(80_000),
  intoRoom: z.boolean().default(false),
});

export const viewsSchema = z.array(viewSchema).max(80);

export const floorMapSchema = z
  .object({
    id: mapIdSchema,
    name: z.string().trim().min(1).max(80),
    status: z.enum(["review", "published"]),
    createdBy: z.string().max(60),
    createdAt: z.string(),
    updatedAt: z.string(),
    videoUrl: z.string().nullable(),
    outline: z.array(pointSchema).min(3).max(400),
    spots: z.array(spotSchema).min(1).max(150),
    walked: z.array(pointSchema).max(4000),
    closureError: z.number().min(0),
    version: z.number().int().nonnegative(),
    walls: z.array(z.object({ along: z.string().max(60).optional(), glass: z.boolean().optional() })).max(400).optional(),
    floor: z.string().trim().max(30).nullable().optional(),
  })
  .refine((map) => map.spots[0]?.kind === "place", { message: "the first spot must be the entrance" })
  .refine((map) => new Set(map.spots.map((s) => s.id)).size === map.spots.length, { message: "spot ids must be unique" });
