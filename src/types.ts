export type Product = {
  product_id: string;
  product_name: string;
  product_description: string;
  product_price: string;
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

export type OrderStatus = {
  order_id: string;
  status: string;
  payment_status: string;
  payment_status_detail: string | null;
  payment_attempt_status: string | null;
  payment_attempt_status_detail: string | null;
  can_retry: boolean;
  checkout_state: string;
  total_amount: string;
  currency: string;
};

export type KnownOrder = {
  order_id: string;
  created_at: number;
  last_status?: OrderStatus;
};
