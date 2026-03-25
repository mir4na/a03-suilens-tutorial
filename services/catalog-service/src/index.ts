import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { desc, sql } from "drizzle-orm";
import { db } from "./db";
import { lenses } from "./db/schema";
import { eq } from "drizzle-orm";

const ensureSchema = async () => {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lenses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      model_name varchar(255) NOT NULL,
      manufacturer_name varchar(255) NOT NULL,
      min_focal_length integer NOT NULL,
      max_focal_length integer NOT NULL,
      max_aperture numeric(4, 1) NOT NULL,
      mount_type varchar(50) NOT NULL,
      day_price numeric(12, 2) NOT NULL,
      weekend_price numeric(12, 2) NOT NULL,
      description text
    )
  `);

  const existing = await db.select({ id: lenses.id }).from(lenses).limit(1);

  if (!existing[0]) {
    await db.insert(lenses).values([
      {
        modelName: "Summilux-M 35mm f/1.4 ASPH.",
        manufacturerName: "Leica",
        minFocalLength: 35,
        maxFocalLength: 35,
        maxAperture: "1.4",
        mountType: "Leica M",
        dayPrice: "450000.00",
        weekendPrice: "750000.00",
        description:
          "A legendary 35mm lens renowned for its rendering and character.",
      },
      {
        modelName: "Art 24-70mm f/2.8 DG DN",
        manufacturerName: "Sigma",
        minFocalLength: 24,
        maxFocalLength: 70,
        maxAperture: "2.8",
        mountType: "Sony E",
        dayPrice: "200000.00",
        weekendPrice: "350000.00",
        description:
          "Professional-grade standard zoom for mirrorless systems.",
      },
      {
        modelName: "NIKKOR Z 70-200mm f/2.8 VR S",
        manufacturerName: "Nikon",
        minFocalLength: 70,
        maxFocalLength: 200,
        maxAperture: "2.8",
        mountType: "Nikon Z",
        dayPrice: "350000.00",
        weekendPrice: "600000.00",
        description: "Nikon flagship telephoto zoom for the Z system.",
      },
    ]);
  }
};

const waitForDatabase = async () => {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await ensureSchema();
      return;
    } catch (error) {
      if (attempt === 20) throw error;
      console.warn(`Catalog schema init retry ${attempt}/20`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
};

const lensSchema = t.Object({
  id: t.String({ format: "uuid" }),
  modelName: t.String(),
  manufacturerName: t.String(),
  minFocalLength: t.Number(),
  maxFocalLength: t.Number(),
  maxAperture: t.String(),
  mountType: t.String(),
  dayPrice: t.String(),
  weekendPrice: t.String(),
  description: t.Nullable(t.String()),
});

const serializeLens = (lens: typeof lenses.$inferSelect) => ({
  ...lens,
  maxAperture: String(lens.maxAperture),
  dayPrice: String(lens.dayPrice),
  weekendPrice: String(lens.weekendPrice),
});

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "SuiLens Catalog Service API",
          version: "1.0.0",
          description: "Catalog API for SuiLens lens listings.",
        },
        tags: [{ name: "Catalog" }, { name: "Health" }],
      },
    }),
  )
  .get("/api/lenses", async () => {
    const result = await db.select().from(lenses).orderBy(desc(lenses.modelName));
    return result.map(serializeLens);
  }, {
    detail: {
      tags: ["Catalog"],
      summary: "List lenses",
      description: "Return all rentable lenses from the catalog.",
    },
    response: t.Array(lensSchema),
  })
  .get("/api/lenses/:id", async ({ params }) => {
    const results = await db
      .select()
      .from(lenses)
      .where(eq(lenses.id, params.id));
    if (!results[0]) {
      return new Response(JSON.stringify({ error: "Lens not found" }), {
        status: 404,
      });
    }
    return serializeLens(results[0]);
  }, {
    params: t.Object({
      id: t.String({ format: "uuid" }),
    }),
    detail: {
      tags: ["Catalog"],
      summary: "Get lens detail",
      description: "Return one lens by its ID.",
    },
  })
  .get("/health", () => ({ status: "ok", service: "catalog-service" }), {
    detail: {
      tags: ["Health"],
      summary: "Service health",
    },
    response: t.Object({
      status: t.String(),
      service: t.String(),
    }),
  })
  .listen(3001);

await waitForDatabase();

console.log(`Catalog Service running on port ${app.server?.port}`);
