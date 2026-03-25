import { useMutation, useQueryClient } from '@tanstack/vue-query';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

interface CreateOrderPayload {
  customerName: string;
  customerEmail: string;
  lensId: string;
  startDate: string;
  endDate: string;
}

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateOrderPayload) => {
      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const raw = await response.text();

        try {
          const error = JSON.parse(raw);
          const message =
            error?.error ||
            error?.message ||
            error?.summary ||
            raw;
          throw new Error(message || 'Failed to create order');
        } catch {
          throw new Error(raw || 'Failed to create order');
        }
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
