import amqplib from "amqplib";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { notifications } from "./db/schema";
import { broadcastNotification } from "./realtime";

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const EXCHANGE_NAME = "suilens.events";
const QUEUE_NAME = "notification-service.order-events";

export async function startConsumer() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS notifications (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id uuid NOT NULL,
          type varchar(50) NOT NULL,
          recipient varchar(255) NOT NULL,
          message text NOT NULL,
          sent_at timestamp NOT NULL DEFAULT now()
        )
      `);
      break;
    } catch (error) {
      if (attempt === 20) throw error;
      console.warn(`Notification schema init retry ${attempt}/20`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  let retries = 0;
  const maxRetries = 10;
  const retryDelay = 2000;

  while (retries < maxRetries) {
    try {
      const connection = await amqplib.connect(RABBITMQ_URL);
      const channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
      await channel.assertQueue(QUEUE_NAME, { durable: true });
      await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, "order.*");

      console.log(`Notification Service listening on queue: ${QUEUE_NAME}`);

      channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return;

        try {
          const event = JSON.parse(msg.content.toString());
          console.log(`Received event: ${event.event}`, event.data);

          if (event.event === "order.placed") {
            const { orderId, customerName, customerEmail, lensName } =
              event.data;

            const [notification] = await db.insert(notifications).values({
              orderId,
              type: "order_placed",
              recipient: customerEmail,
              message: `Hi ${customerName}, your rental order for ${lensName} has been placed successfully. Order ID: ${orderId}`,
            }).returning();

            if (notification) {
              broadcastNotification({
                type: "notification.created",
                timestamp: new Date().toISOString(),
                data: {
                  id: notification.id,
                  orderId: notification.orderId,
                  recipient: notification.recipient,
                  message: notification.message,
                  sentAt: new Date(notification.sentAt).toISOString(),
                },
              });
            }

            console.log(`Notification recorded for order ${orderId}`);
          }

          channel.ack(msg);
        } catch (error) {
          console.error("Error processing message:", error);
          channel.nack(msg, false, true);
        }
      });

      return;
    } catch (error) {
      retries++;
      console.warn(
        `Failed to connect to RabbitMQ (attempt ${retries}/${maxRetries}):`,
        (error as Error).message,
      );
      if (retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  console.error(
    "Failed to connect to RabbitMQ after maximum retries. Continuing without consumer.",
  );
}
