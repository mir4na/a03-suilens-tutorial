import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { desc } from "drizzle-orm";
import { startConsumer } from "./consumer";
import { db } from "./db";
import { notifications } from "./db/schema";
import { registerClient, unregisterClient } from "./realtime";

const notificationSchema = t.Object({
  id: t.String({ format: "uuid" }),
  orderId: t.String({ format: "uuid" }),
  type: t.String(),
  recipient: t.String({ format: "email" }),
  message: t.String(),
  sentAt: t.String(),
});

const serializeNotification = (notification: typeof notifications.$inferSelect) => ({
  ...notification,
  sentAt: notification.sentAt.toISOString(),
});

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "SuiLens Notification Service API",
          version: "1.0.0",
          description: "Notification read API and live WebSocket updates for SuiLens.",
        },
        tags: [{ name: "Notifications" }, { name: "Health" }],
      },
    }),
  )
  .get("/api/notifications", async ({ query }) => {
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 100);
    const result = await db.select().from(notifications).orderBy(desc(notifications.sentAt)).limit(limit);
    return result.map(serializeNotification);
  }, {
    query: t.Object({
      limit: t.Optional(t.String()),
    }),
    detail: {
      tags: ["Notifications"],
      summary: "List notifications",
      description: "Return the latest order notification records.",
    },
    response: t.Array(notificationSchema),
  })
  .ws("/ws/notifications", {
    open(ws) {
      registerClient(ws);
      ws.send(JSON.stringify({
        type: "connection.ready",
        timestamp: new Date().toISOString(),
      }));
    },
    close(ws) {
      unregisterClient(ws);
    },
  })
  .get("/health", () => ({ status: "ok", service: "notification-service" }), {
    detail: {
      tags: ["Health"],
      summary: "Service health",
    },
    response: t.Object({
      status: t.String(),
      service: t.String(),
    }),
  })
  .listen(3003);

startConsumer().catch(console.error);

console.log(`Notification Service running on port ${app.server?.port}`);
