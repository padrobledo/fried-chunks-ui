import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { fetchProducts } from "./api";
import { clearStoredCart, deleteCartItem, loadCart, saveCartItem } from "./storage";
import type { CartItem, Product } from "./types";

type ShopContextValue = {
  products: Product[];
  productsLoading: boolean;
  productsError: string;
  cart: CartItem[];
  cartReady: boolean;
  cartCount: number;
  cartTotal: number;
  cartNotice: string | null;
  dismissCartNotice: () => void;
  addToCart: (product: Product, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: (options?: { preserveView?: boolean }) => Promise<void>;
};

const ShopContext = createContext<ShopContextValue | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const cartNoticeTimer = useRef<number | null>(null);

  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch(() => setProductsError("No pudimos cargar el menú. Intentá nuevamente."))
      .finally(() => setProductsLoading(false));

    loadCart()
      .then(setCart)
      .finally(() => setCartReady(true));
  }, []);

  useEffect(() => () => {
    if (cartNoticeTimer.current !== null) window.clearTimeout(cartNoticeTimer.current);
  }, []);

  function dismissCartNotice() {
    if (cartNoticeTimer.current !== null) window.clearTimeout(cartNoticeTimer.current);
    cartNoticeTimer.current = null;
    setCartNotice(null);
  }

  function showCartNotice() {
    if (cartNoticeTimer.current !== null) window.clearTimeout(cartNoticeTimer.current);
    setCartNotice("Agregado al pedido");
    cartNoticeTimer.current = window.setTimeout(() => {
      cartNoticeTimer.current = null;
      setCartNotice(null);
    }, 1500);
  }

  useEffect(() => {
    function refreshCartFromStorage() {
      void loadCart()
        .then(setCart)
        .finally(() => setCartReady(true));
    }
    function refreshVisibleCart() {
      if (document.visibilityState === "visible") refreshCartFromStorage();
    }
    window.addEventListener("pageshow", refreshCartFromStorage);
    document.addEventListener("visibilitychange", refreshVisibleCart);
    return () => {
      window.removeEventListener("pageshow", refreshCartFromStorage);
      document.removeEventListener("visibilitychange", refreshVisibleCart);
    };
  }, []);

  function addToCart(product: Product, quantity = 1) {
    showCartNotice();
    setCart((current) => {
      const existing = current.find((item) => item.product_id === product.product_id);
      const nextItem: CartItem = {
        ...product,
        quantity: Math.min(99, (existing?.quantity ?? 0) + quantity),
      };
      void saveCartItem(nextItem);
      return existing
        ? current.map((item) => item.product_id === product.product_id ? nextItem : item)
        : [...current, nextItem];
    });
  }

  function setQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart((current) => current.map((item) => {
      if (item.product_id !== productId) return item;
      const nextItem = { ...item, quantity: Math.min(99, quantity) };
      void saveCartItem(nextItem);
      return nextItem;
    }));
  }

  function removeFromCart(productId: string) {
    setCart((current) => current.filter((item) => item.product_id !== productId));
    void deleteCartItem(productId);
  }

  async function clearCart({ preserveView = false } = {}) {
    if (!preserveView) setCart([]);
    await clearStoredCart();
  }

  const value = useMemo<ShopContextValue>(() => ({
    products,
    productsLoading,
    productsError,
    cart,
    cartReady,
    cartCount: cart.reduce((total, item) => total + item.quantity, 0),
    cartTotal: cart.reduce(
      (total, item) => total + Number(item.product_price) * item.quantity,
      0,
    ),
    cartNotice,
    dismissCartNotice,
    addToCart,
    setQuantity,
    removeFromCart,
    clearCart,
  }), [products, productsLoading, productsError, cart, cartReady, cartNotice]);

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const context = useContext(ShopContext);
  if (!context) throw new Error("useShop must be used inside ShopProvider");
  return context;
}
