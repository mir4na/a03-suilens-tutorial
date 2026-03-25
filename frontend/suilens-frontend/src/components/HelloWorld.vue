<template>
  <v-container class="py-8">
    <div class="d-flex flex-column flex-lg-row ga-6 align-start">
      <div class="flex-grow-1 w-100">
        <v-sheet class="mb-6 pa-6 rounded-lg" color="grey-lighten-5">
          <div class="d-flex flex-column flex-md-row justify-space-between ga-4">
            <div>
              <p class="text-overline mb-1">SuiLens Assignment A3</p>
              <h1 class="text-h4 font-weight-bold mb-2">Live rental order demo</h1>
              <p class="text-body-1 text-medium-emphasis mb-0">
                Submit an order and watch the notification panel update immediately through WebSocket.
              </p>
            </div>

            <div class="d-flex flex-column align-start align-md-end ga-2">
              <v-chip :color="wsConnected ? 'green' : 'orange'" size="small" variant="flat">
                {{ wsConnected ? "WebSocket connected" : "WebSocket reconnecting" }}
              </v-chip>
              <v-chip color="blue" size="small" variant="outlined">
                {{ lenses.length }} lenses loaded
              </v-chip>
            </div>
          </div>
        </v-sheet>

        <v-alert
          v-if="lensesError"
          class="mb-4"
          type="error"
          variant="tonal"
          title="Failed to load catalog"
          :text="lensesError.message"
        />

        <v-row>
          <v-col
            v-for="lens in lenses"
            :key="lens.id"
            cols="12"
            md="6"
          >
            <v-card
              class="h-100"
              :color="selectedLens?.id === lens.id ? 'blue-lighten-5' : undefined"
              :variant="selectedLens?.id === lens.id ? 'flat' : 'outlined'"
            >
              <v-card-item>
                <template #prepend>
                  <v-avatar color="black" variant="tonal">
                    {{ lens.manufacturerName.slice(0, 1) }}
                  </v-avatar>
                </template>
                <v-card-title>{{ lens.modelName }}</v-card-title>
                <v-card-subtitle>
                  {{ lens.manufacturerName }} • {{ lens.mountType }}
                </v-card-subtitle>
              </v-card-item>

              <v-card-text>
                <p class="text-body-2 mb-4">{{ lens.description }}</p>
                <div class="d-flex flex-wrap ga-2 mb-4">
                  <v-chip size="small" variant="outlined">
                    {{ lens.minFocalLength }}-{{ lens.maxFocalLength }} mm
                  </v-chip>
                  <v-chip size="small" variant="outlined">
                    f/{{ lens.maxAperture }}
                  </v-chip>
                </div>
                <p class="text-body-1 font-weight-bold mb-0">
                  Rp{{ formatPrice(lens.dayPrice) }}/day
                </p>
              </v-card-text>

              <v-card-actions>
                <v-btn
                  color="primary"
                  variant="flat"
                  @click="selectLens(lens)"
                >
                  {{ selectedLens?.id === lens.id ? "Selected" : "Select lens" }}
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>
      </div>

      <div class="sidebar">
        <v-card class="mb-6">
          <v-card-title>Create order</v-card-title>
          <v-divider />
          <v-card-text>
            <v-alert
              v-if="orderError"
              class="mb-4"
              type="error"
              variant="tonal"
              :text="orderError"
            />

            <v-alert
              v-if="orderSuccess"
              class="mb-4"
              type="success"
              variant="tonal"
              :text="orderSuccess"
            />

            <v-text-field
              :model-value="selectedLens?.modelName ?? ''"
              class="mb-2"
              density="comfortable"
              label="Selected lens"
              readonly
            />

            <v-text-field
              v-model="form.customerName"
              class="mb-2"
              density="comfortable"
              label="Customer name"
            />

            <v-text-field
              v-model="form.customerEmail"
              class="mb-2"
              density="comfortable"
              label="Customer email"
            />

            <v-text-field
              v-model="form.startDate"
              class="mb-2"
              density="comfortable"
              label="Start date"
              type="date"
            />

            <v-text-field
              v-model="form.endDate"
              class="mb-4"
              density="comfortable"
              label="End date"
              type="date"
            />

            <v-btn
              block
              color="primary"
              :disabled="!canSubmit || createOrder.isPending.value"
              :loading="createOrder.isPending.value"
              @click="submitOrder"
            >
              Place order
            </v-btn>
          </v-card-text>
        </v-card>

        <v-card>
          <v-card-title class="d-flex justify-space-between align-center">
            <span>Live notifications</span>
            <v-btn size="small" variant="text" @click="clearNotifications">
              Clear
            </v-btn>
          </v-card-title>
          <v-divider />

          <v-card-text style="min-height: 480px">
            <div v-if="notifications.length === 0" class="text-medium-emphasis text-body-2">
              No notifications yet. Submit an order to see the live feed update.
            </div>

            <div v-else class="d-flex flex-column ga-3">
              <v-alert
                v-for="notification in notifications"
                :key="notification.id"
                border="start"
                color="green"
                density="comfortable"
                variant="tonal"
              >
                <div class="font-weight-medium">{{ notification.message }}</div>
                <div class="text-caption mt-1 text-medium-emphasis">
                  {{ formatTime(notification.sentAt) }}
                </div>
              </v-alert>
            </div>
          </v-card-text>
        </v-card>
      </div>
    </div>
  </v-container>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useLenses } from "../composables/useLenses";
import { useCreateOrder } from "../composables/useOrders";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${API_BASE.replace(/^http/, "ws")}/ws/notifications`;

const { data, error: lensesError } = useLenses();
const createOrder = useCreateOrder();

const lenses = computed(() => data.value ?? []);
const selectedLens = ref(null);
const notifications = ref([]);
const wsConnected = ref(false);
const orderError = ref("");
const orderSuccess = ref("");

const form = ref({
  customerName: "",
  customerEmail: "",
  startDate: "",
  endDate: "",
});

let socket;

const canSubmit = computed(() => {
  return (
    selectedLens.value &&
    form.value.customerName &&
    form.value.customerEmail &&
    form.value.startDate &&
    form.value.endDate
  );
});

function formatPrice(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value));
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function selectLens(lens) {
  selectedLens.value = lens;
  orderError.value = "";
}

function clearNotifications() {
  notifications.value = [];
}

async function loadNotifications() {
  const response = await fetch(`${API_BASE}/api/notifications?limit=10`);
  if (!response.ok) return;
  const payload = await response.json();
  notifications.value = payload.map((notification) => ({
    id: notification.id,
    message: notification.message,
    sentAt: notification.sentAt,
  }));
}

function connectWebSocket() {
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    wsConnected.value = true;
  });

  socket.addEventListener("close", () => {
    wsConnected.value = false;
    window.setTimeout(connectWebSocket, 1500);
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type !== "notification.created") return;

    notifications.value.unshift({
      id: payload.data.id,
      message: payload.data.message,
      sentAt: payload.data.sentAt,
    });
  });
}

async function submitOrder() {
  if (!selectedLens.value) return;

  orderError.value = "";
  orderSuccess.value = "";

  try {
    const order = await createOrder.mutateAsync({
      customerName: form.value.customerName,
      customerEmail: form.value.customerEmail,
      lensId: selectedLens.value.id,
      startDate: form.value.startDate,
      endDate: form.value.endDate,
    });

    orderSuccess.value = `Order ${order.id} created successfully. Wait for the notification feed to update.`;
  } catch (error) {
    orderError.value = error.message || "Failed to create order";
  }
}

onMounted(async () => {
  await loadNotifications();
  connectWebSocket();
});

onBeforeUnmount(() => {
  socket?.close();
});
</script>

<style scoped>
.sidebar {
  width: 100%;
  max-width: 420px;
}
</style>
