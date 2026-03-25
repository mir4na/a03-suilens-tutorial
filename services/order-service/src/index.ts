import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { db } from "./db";
import { orders } from "./db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { publishEvent } from "./events";

const CATALOG_SERVICE_URL =
  process.env.CATALOG_SERVICE_URL || "http://localhost:3001";

interface CatalogLens {
  id: string;
  modelName: string;
  manufacturerName: string;
  dayPrice: string;
}

const ensureSchema = async () => {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await db.execute(sql`
    DO $$
    BEGIN
      CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'active', 'returned', 'cancelled');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_name varchar(255) NOT NULL,
      customer_email varchar(255) NOT NULL,
      lens_id uuid NOT NULL,
      lens_snapshot jsonb NOT NULL,
      start_date timestamp NOT NULL,
      end_date timestamp NOT NULL,
      total_price numeric(12, 2) NOT NULL,
      status order_status NOT NULL DEFAULT 'pending',
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
};

const waitForDatabase = async () => {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await ensureSchema();
      return;
    } catch (error) {
      if (attempt === 20) throw error;
      console.warn(`Order schema init retry ${attempt}/20`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
};

const orderSchema = t.Object({
  id: t.String({ format: "uuid" }),
  customerName: t.String(),
  customerEmail: t.String({ format: "email" }),
  lensId: t.String({ format: "uuid" }),
  lensSnapshot: t.Object({
    modelName: t.String(),
    manufacturerName: t.String(),
    dayPrice: t.String(),
  }),
  startDate: t.String(),
  endDate: t.String(),
  totalPrice: t.String(),
  status: t.String(),
  createdAt: t.String(),
});

const createOrderBody = t.Object({
  customerName: t.String(),
  customerEmail: t.String({ format: "email" }),
  lensId: t.String({ format: "uuid" }),
  startDate: t.String(),
  endDate: t.String(),
});

const serializeOrder = (order: typeof orders.$inferSelect) => ({
  ...order,
  lensSnapshot: order.lensSnapshot as {
    modelName: string;
    manufacturerName: string;
    dayPrice: string;
  },
  startDate: order.startDate.toISOString(),
  endDate: order.endDate.toISOString(),
  createdAt: order.createdAt.toISOString(),
});

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "SuiLens Order Service API",
          version: "1.0.0",
          description: "Order placement and tracking API for SuiLens.",
        },
        tags: [{ name: "Orders" }, { name: "Health" }],
      },
    }),
  )
  .post(
    "/api/orders",
    async ({ body }) => {
      const lensResponse = await fetch(
        `${CATALOG_SERVICE_URL}/api/lenses/${body.lensId}`,
      );
      if (!lensResponse.ok) {
        return new Response(JSON.stringify({ error: "Lens not found" }), {
          status: 404,
        });
      }
      const lens = (await lensResponse.json()) as CatalogLens;

      const start = new Date(body.startDate);
      const end = new Date(body.endDate);
      const days = Math.ceil(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days <= 0) {
        return new Response(
          JSON.stringify({ error: "End date must be after start date" }),
          { status: 400 },
        );
      }
      const totalPrice = (days * parseFloat(lens.dayPrice)).toFixed(2);

      const [order] = await db
        .insert(orders)
        .values({
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          lensId: body.lensId,
          lensSnapshot: {
            modelName: lens.modelName,
            manufacturerName: lens.manufacturerName,
            dayPrice: lens.dayPrice,
          },
          startDate: start,
          endDate: end,
          totalPrice,
        })
        .returning();
      if (!order) {
        return new Response(
          JSON.stringify({ error: "Failed to create order" }),
          { status: 500 },
        );
      }

      await publishEvent("order.placed", {
        orderId: order.id,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        lensName: lens.modelName,
      });

      return new Response(JSON.stringify(serializeOrder(order)), { status: 201 });
    },
    {
      body: createOrderBody,
      detail: {
        tags: ["Orders"],
        summary: "Create order",
        description: "Create a new lens rental order and publish an order event.",
      },
      response: {
        201: orderSchema,
        400: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() }),
      },
    },
  )
  .get("/api/orders", async () => {
    const result = await db.select().from(orders).orderBy(desc(orders.createdAt));
    return result.map(serializeOrder);
  }, {
    detail: {
      tags: ["Orders"],
      summary: "List orders",
      description: "Return all orders ordered by creation time.",
    },
    response: t.Array(orderSchema),
  })
  .get("/api/orders/:id", async ({ params }) => {
    const results = await db
      .select()
      .from(orders)
      .where(eq(orders.id, params.id));
    if (!results[0]) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
      });
    }
    return serializeOrder(results[0]);
  }, {
    params: t.Object({
      id: t.String({ format: "uuid" }),
    }),
    detail: {
      tags: ["Orders"],
      summary: "Get order detail",
      description: "Return a single order by its ID.",
    },
  })
  .get("/health", () => ({ status: "ok", service: "order-service" }), {
    detail: {
      tags: ["Health"],
      summary: "Service health",
    },
    response: t.Object({
      status: t.String(),
      service: t.String(),
    }),
  })
  .listen(3002);

await waitForDatabase();

console.log(`Order Service running on port ${app.server?.port}`);
