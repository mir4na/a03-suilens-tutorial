type NotificationEvent = {
  type: "notification.created";
  timestamp: string;
  data: {
    id: string;
    orderId: string;
    recipient: string;
    message: string;
    sentAt: string;
  };
};

const clients = new Set<any>();

export const registerClient = (client: any) => {
  clients.add(client);
};

export const unregisterClient = (client: any) => {
  clients.delete(client);
};

export const broadcastNotification = (event: NotificationEvent) => {
  const payload = JSON.stringify(event);

  for (const client of clients) {
    try {
      client.send(payload);
    } catch {
      clients.delete(client);
    }
  }
};
