import { openDB, type DBSchema } from "idb";

import type { CartItem } from "./types";

interface FriedChunksDatabase extends DBSchema {
  cart: {
    key: string;
    value: CartItem;
  };
  // Solo se conserva en el tipo para poder eliminar el store legado durante la migración a v2.
  orders: {
    key: string;
    value: unknown;
  };
}

const databasePromise = openDB<FriedChunksDatabase>("fried-chunks", 2, {
  upgrade(database, oldVersion) {
    if (oldVersion < 1) database.createObjectStore("cart", { keyPath: "product_id" });
    if (database.objectStoreNames.contains("orders")) database.deleteObjectStore("orders");
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
