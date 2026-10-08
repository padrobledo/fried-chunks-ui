import { openDB, type DBSchema } from "idb";

import type { CartItem, KnownOrder, OrderStatus } from "./types";

interface FriedChunksDatabase extends DBSchema {
  cart: {
    key: string;
    value: CartItem;
  };
  orders: {
    key: string;
    value: KnownOrder;
  };
}

const databasePromise = openDB<FriedChunksDatabase>("fried-chunks", 1, {
  upgrade(database) {
    database.createObjectStore("cart", { keyPath: "product_id" });
    database.createObjectStore("orders", { keyPath: "order_id" });
  },
});

export async function loadCart(): Promise<CartItem[]> {
  return (await databasePromise).getAll("cart");
}

export async function saveCartItem(item: CartItem): Promise<void> {
  await (await databasePromise).put("cart", item);
}

export async function deleteCartItem(productId: string): Promise<void> {
  await (await databasePromise).delete("cart", productId);
}

export async function clearStoredCart(): Promise<void> {
  await (await databasePromise).clear("cart");
}

export async function rememberOrder(orderId: string): Promise<void> {
  const database = await databasePromise;
  const existing = await database.get("orders", orderId);
  await database.put("orders", existing ?? {
    order_id: orderId,
    created_at: Date.now(),
  });
}

export async function saveOrderStatus(status: OrderStatus): Promise<void> {
  const database = await databasePromise;
  const existing = await database.get("orders", status.order_id);
  const serverCreatedAt = Date.parse(status.created_at);
  await database.put("orders", {
    order_id: status.order_id,
    created_at: Number.isNaN(serverCreatedAt)
      ? existing?.created_at ?? Date.now()
      : serverCreatedAt,
    last_status: status,
  });
}

export async function loadKnownOrders(): Promise<KnownOrder[]> {
  const orders = await (await databasePromise).getAll("orders");
  return orders.sort((left, right) => right.created_at - left.created_at);
}
