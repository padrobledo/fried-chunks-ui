import type { CartItem, Checkout, OrderStatus, Product } from "./types";

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${apiUrl}${path}`, { ...init, credentials: "include" });
}

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchProducts(): Promise<Product[]> {
  return jsonResponse<Product[]>(await apiFetch("/products"));
}

export async function fetchOrderStatus(orderId: string): Promise<OrderStatus> {
  return jsonResponse<OrderStatus>(await apiFetch(`/orders/${orderId}/status`));
}

export async function fetchOrderStatuses(): Promise<OrderStatus[]> {
  return jsonResponse<OrderStatus[]>(await apiFetch("/orders/statuses"));
}

export async function createCartCheckout(items: CartItem[]): Promise<Checkout> {
  return jsonResponse<Checkout>(await apiFetch("/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: items.map(({ product_id, quantity }) => ({ product_id, quantity })),
    }),
  }));
}

export async function retryOrder(orderId: string): Promise<Checkout> {
  return jsonResponse<Checkout>(await apiFetch(`/orders/${orderId}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }));
}

export async function abandonOrder(orderId: string): Promise<OrderStatus> {
  return jsonResponse<OrderStatus>(await apiFetch(`/orders/${orderId}/abandoned`, {
    method: "POST",
  }));
}
