import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import { abandonOrder, createCartCheckout, fetchOrderStatus, retryOrder } from "./api";
import { ShopProvider, useShop } from "./ShopContext";
import { loadKnownOrders, rememberOrder, saveOrderStatus } from "./storage";
import type { KnownOrder, OrderStatus, Product } from "./types";

const storedOrderKey = "fried_chunks_order_id";
const terminalStatuses = new Set([
  "paid", "failed", "cancelled", "expired", "refunded", "partially_refunded", "disputed",
]);

function formatPrice(value: string | number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency, minimumFractionDigits: 0,
  }).format(Number(value));
}

function shortOrderId(orderId: string) {
  return orderId.slice(0, 8).toUpperCase();
}

function returnedWithoutPayment(status: OrderStatus, returnKind: string) {
  return status.payment_attempt_status === null
    && (status.checkout_state === "abandoned"
      || (
        returnKind === "failure"
        && status.status === "awaiting_payment"
        && status.payment_status === "created"
      ));
}

function statusContent(status: OrderStatus, returnKind = "") {
  if (status.status === "paid") {
    return { icon: "✓", title: "Pago exitoso", text: "Recibimos tu pago correctamente.", tone: "success" };
  }
  if (returnedWithoutPayment(status, returnKind)) {
    return { icon: "↩", title: "No completaste el pago", text: "Volviste a la tienda antes de finalizar. No se registró ningún cobro.", tone: "pending" };
  }
  if (["insufficient_amount", "card_insufficient_amount", "cc_rejected_insufficient_amount"]
    .includes(status.payment_attempt_status_detail ?? status.payment_status_detail ?? "")) {
    return { icon: "×", title: "Fondos insuficientes", text: "La tarjeta no tiene saldo o límite disponible. Probá con otra tarjeta.", tone: "error" };
  }
  if (status.status === "failed") {
    return { icon: "×", title: "Pago rechazado", text: "El pago no pudo procesarse. Podés volver a intentarlo.", tone: "error" };
  }
  if (status.status === "cancelled" || status.status === "expired") {
    return { icon: "×", title: "Pago no completado", text: "La operación fue cancelada o venció.", tone: "error" };
  }
  if (status.status === "refunded" || status.status === "partially_refunded") {
    return { icon: "↩", title: "Pago reembolsado", text: "Mercado Pago informó una devolución.", tone: "pending" };
  }
  if (status.status === "disputed") {
    return { icon: "!", title: "Pago en revisión", text: "La operación está en mediación o contracargo.", tone: "pending" };
  }
  if (returnKind === "failure") {
    return { icon: "×", title: "Pago no completado", text: "Mercado Pago no confirmó el cobro.", tone: "error" };
  }
  return { icon: "…", title: "Pago pendiente", text: "Estamos esperando la confirmación de Mercado Pago.", tone: "pending" };
}

function ProductArtwork({ product, large = false }: { product: Product; large?: boolean }) {
  if (product.picture) {
    return <img src={product.picture} alt={product.product_name} className={`product-picture${large ? " product-picture--large" : ""}`} />;
  }
  return (
    <div className={`product-placeholder${large ? " product-placeholder--large" : ""}`} aria-hidden="true">
      <span>FC</span><small>Próximamente foto</small>
    </div>
  );
}

function BottomNavigation() {
  const { cartCount } = useShop();
  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      <NavLink to="/" end><span aria-hidden="true">⌂</span>Inicio</NavLink>
      <NavLink to="/menu"><span aria-hidden="true">☰</span>Menú</NavLink>
      <NavLink to="/orders"><span aria-hidden="true">▤</span>Pedidos</NavLink>
      <NavLink to="/cart" className="cart-nav-link">
        <span aria-hidden="true">▱</span>Carrito{cartCount > 0 && <b>{cartCount}</b>}
      </NavLink>
    </nav>
  );
}

function ShopLayout() {
  const location = useLocation();
  const { cartCount, cartTotal } = useShop();
  const showCartDock = cartCount > 0 && location.pathname !== "/cart";
  return (
    <div className="app-frame">
      <Outlet />
      {showCartDock && (
        <Link className="cart-dock" to="/cart">
          <span>{cartCount} {cartCount === 1 ? "producto" : "productos"}</span>
          <strong>Ver carrito · {formatPrice(cartTotal)}</strong>
        </Link>
      )}
      <BottomNavigation />
    </div>
  );
}

function HomePage() {
  const { products, productsLoading, productsError } = useShop();
  const [returnMessage, setReturnMessage] = useState("");

  useEffect(() => {
    const orderId = localStorage.getItem(storedOrderKey);
    if (!orderId) return;
    void rememberOrder(orderId);
    fetchOrderStatus(orderId)
      .then(async (status) => {
        await saveOrderStatus(status);
        if (status.status === "paid") setReturnMessage("Tu último pago fue acreditado.");
        else if (status.status === "failed") setReturnMessage("Tu último pago fue rechazado. Podés intentarlo nuevamente.");
        else if (["awaiting_payment", "payment_processing"].includes(status.status)) {
          const abandoned = await abandonOrder(orderId);
          await saveOrderStatus(abandoned);
          setReturnMessage("Volviste sin completar el pago. El pedido quedó guardado.");
        }
        localStorage.removeItem(storedOrderKey);
      })
      .catch(() => undefined);
  }, []);

  return (
    <main className="page page--home">
      <div className="shell">
        <header className="topbar">
          <Link className="brand" to="/">Fried Chunks</Link>
          <span className="open-badge"><i /> Pedidos online</span>
        </header>
        {returnMessage && <div className="notice">{returnMessage}</div>}
        <section className="home-hero">
          <div className="hero-copy">
            <span className="eyebrow">Crujiente de verdad</span>
            <h1>Elegí.<br />Pedí.<br /><em>Disfrutá.</em></h1>
            <p>Tu próximo antojo está a unos pocos toques.</p>
            <div className="hero-actions">
              <Link className="button-link" to="/menu">Ver menú</Link>
              <Link className="text-link" to="/orders">Mis pedidos →</Link>
            </div>
          </div>
          <div className="hero-art" aria-label="Espacio reservado para la foto principal">
            <div className="hero-art__stamp">FC</div><span>Foto principal</span>
          </div>
        </section>
        <section className="section-block">
          <div className="section-heading">
            <div><span className="eyebrow">Para arrancar</span><h2>Los favoritos</h2></div>
            <Link to="/menu">Ver todos</Link>
          </div>
          {productsLoading && <p className="loading">Preparando el menú…</p>}
          {productsError && <div className="notice notice--error">{productsError}</div>}
          <div className="featured-row">
            {products.slice(0, 3).map((product) => (
              <Link className="featured-card" to={`/menu/${product.product_id}`} key={product.product_id}>
                <ProductArtwork product={product} />
                <div><h3>{product.product_name}</h3><strong>{formatPrice(product.product_price)}</strong></div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function MenuPage() {
  const { products, productsLoading, productsError, addToCart } = useShop();
  const [addedProduct, setAddedProduct] = useState<string | null>(null);
  function quickAdd(product: Product) {
    addToCart(product);
    setAddedProduct(product.product_id);
    window.setTimeout(() => setAddedProduct(null), 1200);
  }
  return (
    <main className="page"><div className="shell shell--narrow">
      <header className="page-header"><span className="eyebrow">Fried Chunks</span><h1>Menú</h1><p>Elegí tus favoritos y armá el pedido a tu manera.</p></header>
      <div className="category-pills" aria-label="Categorías">
        <button className="pill pill--active" type="button">Todo</button>
        <button className="pill" type="button" disabled>Combos</button>
        <button className="pill" type="button" disabled>Bebidas</button>
      </div>
      {productsLoading && <p className="loading">Cargando menú…</p>}
      {productsError && <div className="notice notice--error">{productsError}</div>}
      <section className="menu-list" aria-label="Productos">
        {products.map((product) => (
          <article className="menu-card" key={product.product_id}>
            <Link to={`/menu/${product.product_id}`} className="menu-card__art"><ProductArtwork product={product} /></Link>
            <div className="menu-card__body">
              <Link to={`/menu/${product.product_id}`}><h2>{product.product_name}</h2></Link>
              <p>{product.product_description}</p>
              <div className="menu-card__footer">
                <strong>{formatPrice(product.product_price)}</strong>
                <button className="icon-button" type="button" onClick={() => quickAdd(product)} aria-label={`Agregar ${product.product_name}`}>
                  {addedProduct === product.product_id ? "✓" : "+"}
                </button>
              </div>
            </div>
          </article>
        ))}
        {!productsLoading && !products.length && !productsError && <p>No hay productos disponibles.</p>}
      </section>
    </div></main>
  );
}

function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { products, productsLoading, addToCart } = useShop();
  const [quantity, setQuantity] = useState(1);
  const product = products.find((item) => item.product_id === productId);
  if (productsLoading) return <main className="page"><p className="loading">Cargando producto…</p></main>;
  if (!product) return <main className="page"><div className="empty-state"><span>?</span><h1>No encontramos el producto</h1><Link className="button-link" to="/menu">Volver al menú</Link></div></main>;
  function addAndContinue() {
    addToCart(product!, quantity);
    navigate("/cart");
  }
  return (
    <main className="page product-detail-page"><div className="shell shell--detail">
      <Link className="back-link" to="/menu">← Menú</Link>
      <ProductArtwork product={product} large />
      <section className="product-detail">
        <span className="eyebrow">Hecho para vos</span><h1>{product.product_name}</h1><p>{product.product_description}</p>
        <strong className="detail-price">{formatPrice(product.product_price)}</strong>
        <div className="detail-actions">
          <div className="quantity-control" aria-label="Cantidad">
            <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
            <strong>{quantity}</strong>
            <button type="button" onClick={() => setQuantity((current) => Math.min(99, current + 1))}>+</button>
          </div>
          <button type="button" onClick={addAndContinue}>Agregar · {formatPrice(Number(product.product_price) * quantity)}</button>
        </div>
      </section>
    </div></main>
  );
}

function CartPage() {
  const { cart, cartReady, cartCount, cartTotal, setQuantity, removeFromCart, clearCart } = useShop();
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [error, setError] = useState("");
  async function checkout() {
    setIsCheckingOut(true); setError("");
    try {
      const result = await createCartCheckout(cart);
      await rememberOrder(result.order_id);
      localStorage.setItem(storedOrderKey, result.order_id);
      await clearCart({ preserveView: true });
      window.location.assign(result.checkout_url);
    } catch {
      setError("No pudimos iniciar el pago. Revisá el pedido e intentá nuevamente.");
      setIsCheckingOut(false);
    }
  }
  if (!cartReady) return <main className="page"><p className="loading">Cargando carrito…</p></main>;
  return (
    <main className="page"><div className="shell shell--narrow">
      <header className="page-header page-header--compact"><span className="eyebrow">Tu selección</span><h1>Carrito</h1>{cartCount > 0 && <p>{cartCount} {cartCount === 1 ? "producto" : "productos"}</p>}</header>
      {!cart.length ? (
        <div className="empty-state"><span>＋</span><h2>Tu carrito está vacío</h2><p>Elegí algo rico del menú para empezar.</p><Link className="button-link" to="/menu">Ver menú</Link></div>
      ) : <>
        <section className="cart-list">
          {cart.map((item) => (
            <article className="cart-item" key={item.product_id}>
              <ProductArtwork product={item} />
              <div className="cart-item__content">
                <div><h2>{item.product_name}</h2><button className="remove-button" type="button" onClick={() => removeFromCart(item.product_id)}>Eliminar</button></div>
                <div className="cart-item__footer">
                  <div className="quantity-control quantity-control--small">
                    <button type="button" onClick={() => setQuantity(item.product_id, item.quantity - 1)}>−</button><strong>{item.quantity}</strong><button type="button" onClick={() => setQuantity(item.product_id, item.quantity + 1)}>+</button>
                  </div>
                  <strong>{formatPrice(Number(item.product_price) * item.quantity)}</strong>
                </div>
              </div>
            </article>
          ))}
        </section>
        <section className="cart-summary">
          <div><span>Subtotal</span><strong>{formatPrice(cartTotal)}</strong></div>
          <div className="cart-summary__total"><span>Total</span><strong>{formatPrice(cartTotal)}</strong></div>
          <small>El precio y la disponibilidad se confirman antes de abrir Mercado Pago.</small>
          {error && <p className="retry-error" role="alert">{error}</p>}
          <button type="button" onClick={() => void checkout()} disabled={isCheckingOut}>{isCheckingOut ? "Abriendo Mercado Pago…" : "Continuar al pago"}</button>
        </section>
      </>}
    </div></main>
  );
}

function orderStatusLabel(status: OrderStatus) {
  if (status.status === "paid") return "Pagado";
  if (status.status === "failed") return "Rechazado";
  if (status.status === "cancelled" || status.status === "expired") return "No completado";
  if (status.status === "refunded" || status.status === "partially_refunded") return "Reembolsado";
  if (status.status === "payment_processing") return "Procesando";
  if (status.checkout_state === "abandoned") return "No completado";
  return "Pendiente";
}

function OrdersPage() {
  const [orders, setOrders] = useState<KnownOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const loadOrders = useCallback(async () => {
    const legacyOrderId = localStorage.getItem(storedOrderKey);
    if (legacyOrderId) await rememberOrder(legacyOrderId);
    const known = await loadKnownOrders();
    const refreshed = await Promise.all(known.map(async (order) => {
      try {
        const status = await fetchOrderStatus(order.order_id);
        await saveOrderStatus(status);
        return { ...order, last_status: status };
      } catch { return order; }
    }));
    setOrders(refreshed); setLoading(false);
  }, []);
  useEffect(() => { void loadOrders(); }, [loadOrders]);
  return (
    <main className="page"><div className="shell shell--narrow">
      <header className="page-header page-header--compact"><span className="eyebrow">Este dispositivo</span><h1>Mis pedidos</h1><p>Consultamos el estado real en la tienda cada vez que entrás.</p></header>
      {loading && <p className="loading">Buscando pedidos…</p>}
      {!loading && !orders.length && <div className="empty-state"><span>▤</span><h2>Todavía no hay pedidos</h2><p>Los pedidos que hagas desde este dispositivo aparecerán acá.</p><Link className="button-link" to="/menu">Ver menú</Link></div>}
      <section className="orders-list">
        {orders.map((order) => (
          <Link className="order-card" to={`/orders/${order.order_id}`} key={order.order_id}>
            <div><span>Pedido {shortOrderId(order.order_id)}</span><small>{new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(order.created_at)}</small></div>
            {order.last_status ? <div className="order-card__status"><b>{orderStatusLabel(order.last_status)}</b><strong>{formatPrice(order.last_status.total_amount, order.last_status.currency)}</strong></div> : <span>Sin conexión</span>}
          </Link>
        ))}
      </section>
    </div></main>
  );
}

function OrderDetailPage() {
  const { orderId } = useParams();
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState("");
  const loadStatus = useCallback(async () => {
    if (!orderId) return;
    try {
      const current = await fetchOrderStatus(orderId);
      await saveOrderStatus(current); setStatus(current); setError("");
    } catch { setError("No pudimos actualizar este pedido."); }
  }, [orderId]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!status || terminalStatuses.has(status.status) || status.checkout_state === "abandoned") return;
    const timer = window.setInterval(() => void loadStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [loadStatus, status]);
  const content = status ? statusContent(status) : null;
  return (
    <main className="page"><div className="shell shell--narrow">
      <Link className="back-link" to="/orders">← Mis pedidos</Link>
      <section className="result-card result-card--embedded" aria-live="polite">
        {!content && !error && <p className="loading">Actualizando pedido…</p>}
        {error && <div className="notice notice--error">{error}</div>}
        {content && status && <><div className={`result-icon result-icon--${content.tone}`}>{content.icon}</div><span className="eyebrow">Pedido {shortOrderId(status.order_id)}</span><h1>{content.title}</h1><p>{content.text}</p><strong className="result-amount">{formatPrice(status.total_amount, status.currency)}</strong></>}
      </section>
    </div></main>
  );
}

function PaymentResultPage() {
  const { returnKind = "pending" } = useParams();
  const [query] = useSearchParams();
  const orderId = query.get("order_id") ?? query.get("external_reference") ?? localStorage.getItem(storedOrderKey);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState("");
  const [retryError, setRetryError] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);
  const loadStatus = useCallback(async () => {
    if (!orderId) { setError("No encontramos el identificador del pedido."); return; }
    try {
      await rememberOrder(orderId);
      let current = await fetchOrderStatus(orderId);
      if (returnedWithoutPayment(current, returnKind) && current.checkout_state !== "abandoned") current = await abandonOrder(orderId);
      await saveOrderStatus(current); setError(""); setStatus(current);
      if (terminalStatuses.has(current.status) || current.checkout_state === "abandoned") localStorage.removeItem(storedOrderKey);
    } catch { setError("No pudimos consultar el estado del pago. Intentá nuevamente."); }
  }, [orderId, returnKind]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!status || terminalStatuses.has(status.status) || status.checkout_state === "abandoned") return;
    const timer = window.setInterval(() => void loadStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [loadStatus, status]);
  async function retryPayment() {
    if (!orderId) return;
    setIsRetrying(true); setRetryError("");
    try {
      const checkout = await retryOrder(orderId);
      await rememberOrder(checkout.order_id);
      localStorage.setItem(storedOrderKey, checkout.order_id);
      window.location.assign(checkout.checkout_url);
    } catch { setRetryError("No pudimos iniciar un nuevo intento. Volvé a probar en unos segundos."); setIsRetrying(false); }
  }
  const content = status ? statusContent(status, returnKind) : null;
  return (
    <main className="payment-page"><section className="result-card" aria-live="polite">
      {!content && !error && <p className="loading">Verificando el pago…</p>}
      {error && <><div className="result-icon result-icon--error">!</div><h1>No pudimos verificarlo</h1><p>{error}</p><button type="button" onClick={() => void loadStatus()}>Reintentar</button></>}
      {!error && content && status && <><div className={`result-icon result-icon--${content.tone}`}>{content.icon}</div><span className="eyebrow">Estado del pedido</span><h1>{content.title}</h1><p>{content.text}</p><strong className="result-amount">{formatPrice(status.total_amount, status.currency)}</strong><small>Pedido {shortOrderId(status.order_id)}</small>{retryError && <p className="retry-error" role="alert">{retryError}</p>}<div className="result-actions">{status.can_retry && <button type="button" onClick={() => void retryPayment()} disabled={isRetrying}>{isRetrying ? "Abriendo Mercado Pago…" : "Pagar con otra tarjeta"}</button>}<Link className="button-link button-link--secondary" to="/orders">Ver mis pedidos</Link><Link className="text-link" to="/menu">Volver al menú</Link></div></>}
    </section></main>
  );
}

function NotFoundPage() {
  return <main className="page"><div className="empty-state"><span>404</span><h1>Esta página no existe</h1><Link className="button-link" to="/">Volver al inicio</Link></div></main>;
}

export default function App() {
  return (
    <BrowserRouter><ShopProvider><Routes>
      <Route element={<ShopLayout />}>
        <Route index element={<HomePage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="menu/:productId" element={<ProductDetailPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:orderId" element={<OrderDetailPage />} />
      </Route>
      <Route path="payment/:returnKind" element={<PaymentResultPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes></ShopProvider></BrowserRouter>
  );
}
