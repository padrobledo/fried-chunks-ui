export type ProductCategory = "chunks" | "fries" | "beverages" | "combos";

export type Product = {
  product_id: string;
  product_name: string;
  product_description: string;
  product_price: string;
  category: ProductCategory;
  available: boolean;
  picture: string | null;
};

export type CartItem = Product & {
  quantity: number;
};

export type Checkout = {
  checkout_url: string;
  order_id: string;
  provider_order_id: string;
};

export type FulfillmentStatus =
  | "received"
  | "preparing"
  | "ready_to_ship"
  | "on_the_way"
  | "delivered"
  | "delayed_kitchen"
  | "delayed_delivery"
  | "picked_up";

export type OrderItem = {
  product_id: string | null;
  product_name: string;
  product_description: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
};

export type OrderStatus = {
  order_id: string;
  status: string;
  fulfillment_status: FulfillmentStatus | null;
  payment_status: string;
  payment_status_detail: string | null;
  payment_attempt_status: string | null;
  payment_attempt_status_detail: string | null;
  can_retry: boolean;
  checkout_state: string;
  total_amount: string;
  currency: string;
  items: OrderItem[];
};

export type KnownOrder = {
  order_id: string;
  created_at: number;
  last_status?: OrderStatus;
};
