import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import { abandonOrder, cancelOrder, createCartCheckout, fetchOrderStatus, fetchOrderStatuses, retryOrder } from "./api";
import { ShopProvider, useShop } from "./ShopContext";
import { loadKnownOrders, rememberOrder, saveOrderStatus } from "./storage";
import type { FulfillmentStatus, KnownOrder, OrderStatus, Product, ProductCategory } from "./types";

const storedOrderKey = "fried_chunks_order_id";
const revealIncompleteOrderKey = "fried_chunks_reveal_incomplete_order";
const menuScrollKey = "fried_chunks_menu_scroll";
const menuExitEvent = "fried-chunks:menu-exit";
const menuTransitionMs = 220;
const terminalStatuses = new Set([
  "paid", "failed", "cancelled", "expired", "refunded", "partially_refunded", "disputed",
]);
const completedFulfillmentStatuses = new Set<FulfillmentStatus>(["delivered", "picked_up"]);

function usePageReturn(onReturn: () => void) {
  const onReturnRef = useRef(onReturn);
  useEffect(() => { onReturnRef.current = onReturn; }, [onReturn]);
  useEffect(() => {
    let lastHandledAt = 0;
    const handleReturn = () => {
      const now = Date.now();
      if (now - lastHandledAt < 500) return;
      lastHandledAt = now;
      onReturnRef.current();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") handleReturn();
    };
    window.addEventListener("pageshow", handleReturn);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", handleReturn);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
const fulfillmentLabels: Record<FulfillmentStatus, string> = {
  received: "Recibido",
  preparing: "En preparación",
  ready_to_ship: "Listo para enviar",
  on_the_way: "En camino",
  delivered: "Entregado",
  delayed_kitchen: "Demorado en cocina",
  delayed_delivery: "Demorado en camino",
  picked_up: "Retirado",
};
const menuCategories: { id: ProductCategory; label: string }[] = [
  { id: "chunks", label: "Chunks" },
  { id: "fries", label: "Papas" },
  { id: "beverages", label: "Bebidas" },
  { id: "combos", label: "Combos" },
];

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
  if (status.status === "cancelled") {
    return { icon: "×", title: "Pedido cancelado", text: "Cancelaste este pedido.", tone: "error" };
  }
  if (status.status === "expired") {
    return { icon: "×", title: "Pago no completado", text: "La operación venció.", tone: "error" };
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
  const { cartCount, cartNotice } = useShop();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current);
  }, []);

  function changeTab(event: MouseEvent<HTMLAnchorElement>, destination: "/" | "/orders") {
    if (
      location.pathname !== "/menu"
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return;
    event.preventDefault();
    window.dispatchEvent(new Event(menuExitEvent));
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : menuTransitionMs;
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current);
    navigationTimer.current = window.setTimeout(() => {
      navigationTimer.current = null;
      navigate(destination);
    }, delay);
  }

  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      <NavLink to="/" end onClick={(event) => changeTab(event, "/")}><span aria-hidden="true">⌂</span>Inicio</NavLink>
      <NavLink to="/menu"><span aria-hidden="true">☰</span>Menú</NavLink>
      <NavLink to="/orders" onClick={(event) => changeTab(event, "/orders")} className={`orders-nav-link${cartNotice ? " orders-nav-link--attention" : ""}`}>
        <span aria-hidden="true">▤</span>Pedidos{cartCount > 0 && <b>{cartCount}</b>}
      </NavLink>
    </nav>
  );
}

function ShopLayout() {
  const { cartNotice, dismissCartNotice } = useShop();
  return (
    <div className="app-frame">
      <Outlet />
      {cartNotice && <button className="order-toast" type="button" onClick={dismissCartNotice} aria-live="polite">{cartNotice}</button>}
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
  const [activeCategory, setActiveCategory] = useState<ProductCategory>("chunks");
  const [subnavLeaving, setSubnavLeaving] = useState(false);
  const scrollRestored = useRef(false);

  useEffect(() => {
    function beginSubnavExit() {
      setSubnavLeaving(true);
    }
    window.addEventListener(menuExitEvent, beginSubnavExit);
    return () => window.removeEventListener(menuExitEvent, beginSubnavExit);
  }, []);

  useLayoutEffect(() => {
    if (productsLoading) return;
    const storedPosition = Number(sessionStorage.getItem(menuScrollKey) ?? 0);
    window.scrollTo({ top: Number.isFinite(storedPosition) ? storedPosition : 0, behavior: "auto" });
    scrollRestored.current = true;
    return () => {
      if (scrollRestored.current) sessionStorage.setItem(menuScrollKey, String(window.scrollY));
    };
  }, [productsLoading]);

  useEffect(() => {
    if (productsLoading) return;
    function rememberMenuPosition() {
      if (scrollRestored.current) sessionStorage.setItem(menuScrollKey, String(window.scrollY));
    }
    window.addEventListener("scroll", rememberMenuPosition, { passive: true });
    return () => {
      window.removeEventListener("scroll", rememberMenuPosition);
    };
  }, [productsLoading]);

  useEffect(() => {
    if (productsLoading) return;
    function updateActiveCategory() {
      const atPageBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (atPageBottom) {
        setActiveCategory(menuCategories[menuCategories.length - 1].id);
        return;
      }
      const activationLine = Math.min(window.innerHeight * .3, 180);
      let current = menuCategories[0].id;
      for (const category of menuCategories) {
        const section = document.getElementById(`category-${category.id}`);
        if (section && section.getBoundingClientRect().top <= activationLine) current = category.id;
      }
      setActiveCategory(current);
    }
    updateActiveCategory();
    window.addEventListener("scroll", updateActiveCategory, { passive: true });
    window.addEventListener("resize", updateActiveCategory);
    return () => {
      window.removeEventListener("scroll", updateActiveCategory);
      window.removeEventListener("resize", updateActiveCategory);
    };
  }, [productsLoading, products.length]);
  function selectCategory(category: ProductCategory) {
    setActiveCategory(category);
    document.getElementById(`category-${category}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function quickAdd(product: Product) {
    addToCart(product);
    setAddedProduct(product.product_id);
    window.setTimeout(() => setAddedProduct(null), 1200);
  }
  return (
    <main className="page page--menu"><div className="shell shell--narrow">
      <nav className={`category-subnav${subnavLeaving ? " category-subnav--leaving" : ""}`} aria-label="Categorías">
        {menuCategories.map((category) => <button
          className={`category-tab${activeCategory === category.id ? " category-tab--active" : ""}`}
          type="button"
          aria-pressed={activeCategory === category.id}
          onClick={() => selectCategory(category.id)}
          key={category.id}
        >{category.label}</button>)}
      </nav>
      {productsLoading && <p className="loading">Cargando menú…</p>}
      {productsError && <div className="notice notice--error">{productsError}</div>}
      <div className="menu-categories" aria-label="Productos">
        {menuCategories.map((category) => {
          const categoryProducts = products.filter((product) => (product.category ?? "chunks") === category.id);
          return <section className="menu-category" id={`category-${category.id}`} key={category.id}>
            <h2>{category.label}</h2>
            <div className="menu-list">
              {categoryProducts.map((product) => (
                <article className="menu-card" key={product.product_id}>
                  <Link to={`/menu/${product.product_id}`} className="menu-card__art"><ProductArtwork product={product} /></Link>
                  <div className="menu-card__body">
                    <Link to={`/menu/${product.product_id}`}><h3>{product.product_name}</h3></Link>
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
              {!productsLoading && !categoryProducts.length && <p className="category-empty">Próximamente.</p>}
            </div>
          </section>;
        })}
        {!productsLoading && !products.length && !productsError && <p>No hay productos disponibles.</p>}
      </div>
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
  function addAndGo(destination: "/menu" | "/orders#current") {
    addToCart(product!, quantity);
    navigate(destination);
  }
  return (
    <main className="page product-detail-page"><div className="shell shell--detail">
      <Link className="back-link" to="/menu">← Menú</Link>
      <ProductArtwork product={product} large />
      <section className="product-detail">
        <h1>{product.product_name}</h1><p>{product.product_description}</p>
        <strong className="detail-price">{formatPrice(product.product_price)}</strong>
        <div className="detail-actions">
          <div className="quantity-control" aria-label="Cantidad">
            <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
            <strong>{quantity}</strong>
            <button type="button" onClick={() => setQuantity((current) => Math.min(99, current + 1))}>+</button>
          </div>
          <div className="detail-submit-actions">
            <button className="button-link--secondary" type="button" onClick={() => addAndGo("/menu")}>Agregar y seguir</button>
            <button type="button" onClick={() => addAndGo("/orders#current")}>Agregar y terminar</button>
          </div>
        </div>
      </section>
    </div></main>
  );
}

function CurrentOrderSection({
  activeOrder,
  hasIncompleteOrders,
}: {
  activeOrder?: KnownOrder;
  hasIncompleteOrders: boolean;
}) {
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
  if (!cartReady) return null;
  return (
    <section className="orders-section" id="current">
      <div className="orders-section__heading"><h2>Pedido actual</h2>{cartCount > 0 && <span>{cartCount} {cartCount === 1 ? "producto" : "productos"}</span>}</div>
      {!cart.length && activeOrder ? (
        <section className="orders-list"><OrderCard order={activeOrder} /></section>
      ) : !cart.length ? (
        <div className={`current-order-empty${hasIncompleteOrders ? " current-order-empty--with-incomplete" : ""}`}>
          <p>{hasIncompleteOrders
            ? "Podés continuar con un pedido incompleto o comenzar un nuevo pedido."
            : "No agregaste productos."}</p>
          <Link className="button-link button-link--secondary" to="/menu">
            Agregar productos
          </Link>
        </div>
      ) : <>
        <section className="cart-summary">
          <div className="cart-summary__total"><span>Total</span><strong>{formatPrice(cartTotal)}</strong></div>
          {error && <p className="retry-error" role="alert">{error}</p>}
          <div className="cart-summary-actions">
            <Link className="button-link button-link--secondary" to="/menu">Agregar más productos</Link>
            <button type="button" onClick={() => void checkout()} disabled={isCheckingOut}>{isCheckingOut ? "Abriendo Mercado Pago…" : "Terminar y pagar"}</button>
          </div>
        </section>
        <section className="cart-list">
          {cart.map((item) => (
            <article className="cart-item" key={item.product_id}>
              <ProductArtwork product={item} />
              <div className="cart-item__content">
                <div className="cart-item__header">
                  <h2>{item.product_name}</h2>
                  <button className="remove-button" type="button" onClick={() => removeFromCart(item.product_id)} aria-label={`Eliminar ${item.product_name}`} title="Eliminar producto">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                    </svg>
                  </button>
                </div>
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
      </>}
    </section>
  );
}

function orderStatusLabel(status: OrderStatus) {
  if (status.status === "paid") return "Pagado";
  if (status.status === "failed") return "Rechazado";
  if (status.status === "cancelled") return "Cancelado";
  if (status.status === "expired") return "No completado";
  if (status.status === "refunded" || status.status === "partially_refunded") return "Reembolsado";
  if (status.status === "payment_processing") return "Procesando";
  if (status.checkout_state === "abandoned") return "No completado";
  return "Pendiente";
}

function fulfillmentStatusLabel(status: OrderStatus) {
  if (status.status === "cancelled") return "Cancelado";
  if (status.fulfillment_status) return fulfillmentLabels[status.fulfillment_status];
  return status.status === "paid" ? "Recibido" : "Esperando confirmación del pago";
}

function isIncompleteOrderStatus(status?: OrderStatus) {
  return Boolean(
    status?.can_retry
    && !["cancelled", "expired"].includes(status.status),
  );
}

function OrderCard({ order }: { order: KnownOrder }) {
  return (
    <Link className="order-card" to={`/orders/${order.order_id}`}>
      <div><span>Pedido {shortOrderId(order.order_id)}</span><small>{new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(order.created_at)}</small></div>
      {order.last_status ? <div className="order-card__status"><b>{order.last_status.status === "paid" ? fulfillmentStatusLabel(order.last_status) : orderStatusLabel(order.last_status)}</b><strong>{formatPrice(order.last_status.total_amount, order.last_status.currency)}</strong></div> : <span>Sin conexión</span>}
    </Link>
  );
}

function OrdersPage() {
  const { cart, cartReady } = useShop();
  const [orders, setOrders] = useState<KnownOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOrdersOpen, setActiveOrdersOpen] = useState(false);
  const [incompleteOrdersOpen, setIncompleteOrdersOpen] = useState(false);
  const [previousOrdersOpen, setPreviousOrdersOpen] = useState(false);
  const loadSequence = useRef(0);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);
  const loadOrders = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    const checkoutOrderId = localStorage.getItem(storedOrderKey);
    const revealIncompleteOrderId = localStorage.getItem(revealIncompleteOrderKey);
    try {
      if (checkoutOrderId) await rememberOrder(checkoutOrderId);
      let statuses = await fetchOrderStatuses();
      const checkoutStatusIndex = statuses.findIndex((status) => status.order_id === checkoutOrderId);
      const checkoutStatus = statuses[checkoutStatusIndex];
      const returnedFromCheckoutWithoutPayment = Boolean(
        checkoutStatus
        && checkoutStatus.payment_attempt_status === null
        && checkoutStatus.status === "awaiting_payment"
        && checkoutStatus.payment_status === "created"
        && checkoutStatus.checkout_state !== "abandoned"
      );
      if (returnedFromCheckoutWithoutPayment && checkoutStatus) {
        const abandoned = await abandonOrder(checkoutStatus.order_id);
        statuses = statuses.map((status, index) => index === checkoutStatusIndex ? abandoned : status);
      }
      await Promise.all(statuses.map(saveOrderStatus));
      const refreshed = statuses
        .map((status) => ({
          order_id: status.order_id,
          created_at: Date.parse(status.created_at),
          last_status: status,
        }))
        .sort((left, right) => right.created_at - left.created_at);
      if (sequence !== loadSequence.current) return;
      const checkoutOrder = refreshed.find((order) => order.order_id === checkoutOrderId);
      const revealIncompleteOrder = refreshed.find(
        (order) => order.order_id === revealIncompleteOrderId,
      );
      if (
        isIncompleteOrderStatus(checkoutOrder?.last_status)
        || isIncompleteOrderStatus(revealIncompleteOrder?.last_status)
      ) setIncompleteOrdersOpen(true);
      if (revealIncompleteOrder) localStorage.removeItem(revealIncompleteOrderKey);
      if (
        checkoutOrder?.last_status
        && (terminalStatuses.has(checkoutOrder.last_status.status) || checkoutOrder.last_status.checkout_state === "abandoned")
      ) localStorage.removeItem(storedOrderKey);
      setOrders(refreshed);
    } catch {
      if (sequence === loadSequence.current) setOrders(await loadKnownOrders());
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    function refreshOrders() {
      void loadOrders();
    }
    function refreshVisibleOrders() {
      if (document.visibilityState === "visible") refreshOrders();
    }
    refreshOrders();
    window.addEventListener("pageshow", refreshOrders);
    document.addEventListener("visibilitychange", refreshVisibleOrders);
    return () => {
      window.removeEventListener("pageshow", refreshOrders);
      document.removeEventListener("visibilitychange", refreshVisibleOrders);
    };
  }, [loadOrders]);
  const activeOrders = orders.filter(({ last_status: status }) => (
    status?.status === "paid"
    && (!status.fulfillment_status || !completedFulfillmentStatuses.has(status.fulfillment_status))
  ));
  const incompleteOrders = orders.filter(({ last_status: status }) => (
    isIncompleteOrderStatus(status)
  ));
  const previousOrders = orders.filter((order) => (
    !activeOrders.includes(order)
    && !incompleteOrders.includes(order)
  ));
  const currentActiveOrder = cartReady && !cart.length ? activeOrders[0] : undefined;
  const groupedActiveOrders = currentActiveOrder ? activeOrders.slice(1) : activeOrders;
  const shouldOpenIncompleteOrders = Boolean(
    cartReady
    && !cart.length
    && !currentActiveOrder
    && incompleteOrders.length,
  );
  useEffect(() => {
    if (shouldOpenIncompleteOrders) setIncompleteOrdersOpen(true);
  }, [shouldOpenIncompleteOrders]);
  function orderCards(items: KnownOrder[]) {
    return <section className="orders-list">
      {items.map((order) => <OrderCard order={order} key={order.order_id} />)}
    </section>;
  }
  if (loading || !cartReady) {
    return (
      <main className="page"><div className="shell shell--narrow">
        <p className="loading orders-page-loading" role="status">Cargando pedidos…</p>
      </div></main>
    );
  }
  return (
    <main className="page"><div className="shell shell--narrow">
      <CurrentOrderSection
        activeOrder={currentActiveOrder}
        hasIncompleteOrders={incompleteOrders.length > 0}
      />
      {groupedActiveOrders.length > 0 && <section className="orders-section order-group">
        <button
          className="order-group-toggle"
          type="button"
          aria-expanded={activeOrdersOpen}
          aria-controls="active-orders-list"
          onClick={() => setActiveOrdersOpen((open) => !open)}
        >
          <span>Pedidos en curso</span>
          <span className="order-group-toggle__meta">
            <small>{groupedActiveOrders.length}</small>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
          </span>
        </button>
        <div
          className={`order-group-panel${activeOrdersOpen ? " order-group-panel--open" : ""}`}
          id="active-orders-list"
          aria-hidden={!activeOrdersOpen}
          inert={!activeOrdersOpen}
        >
          <div className="order-group-panel__content">{orderCards(groupedActiveOrders)}</div>
        </div>
      </section>}
      {incompleteOrders.length > 0 && <section className="orders-section order-group">
        <button
          className="order-group-toggle"
          type="button"
          aria-expanded={incompleteOrdersOpen}
          aria-controls="incomplete-orders-list"
          onClick={() => setIncompleteOrdersOpen((open) => !open)}
        >
          <span>Pedidos incompletos</span>
          <span className="order-group-toggle__meta">
            <small>{incompleteOrders.length}</small>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
          </span>
        </button>
        <div
          className={`order-group-panel${incompleteOrdersOpen ? " order-group-panel--open" : ""}`}
          id="incomplete-orders-list"
          aria-hidden={!incompleteOrdersOpen}
          inert={!incompleteOrdersOpen}
        >
          <div className="order-group-panel__content">
            {orderCards(incompleteOrders)}
          </div>
        </div>
      </section>}
      {previousOrders.length > 0 && <section className="orders-section order-group">
        <button
          className="order-group-toggle"
          type="button"
          aria-expanded={previousOrdersOpen}
          aria-controls="previous-orders-list"
          onClick={() => setPreviousOrdersOpen((open) => !open)}
        >
          <span>Pedidos anteriores</span>
          <span className="order-group-toggle__meta">
            <small>{previousOrders.length}</small>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
          </span>
        </button>
        <div
          className={`order-group-panel${previousOrdersOpen ? " order-group-panel--open" : ""}`}
          id="previous-orders-list"
          aria-hidden={!previousOrdersOpen}
          inert={!previousOrdersOpen}
        >
          <div className="order-group-panel__content">
            {orderCards(previousOrders)}
          </div>
        </div>
      </section>}
    </div></main>
  );
}

function OrderDetailPage() {
  const { orderId } = useParams();
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState("");
  const [retryError, setRetryError] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  useEffect(() => {
    if (!cancelModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCancelling && !isRetrying) {
        setCancelModalOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [cancelModalOpen, isCancelling, isRetrying]);
  const loadStatus = useCallback(async () => {
    if (!orderId) return;
    try {
      const current = await fetchOrderStatus(orderId);
      await saveOrderStatus(current); setStatus(current); setError("");
    } catch { setError("No pudimos actualizar este pedido."); }
  }, [orderId]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!status || status.checkout_state === "abandoned") return;
    if (terminalStatuses.has(status.status) && status.status !== "paid") return;
    if (status.fulfillment_status && completedFulfillmentStatuses.has(status.fulfillment_status)) return;
    const timer = window.setInterval(() => void loadStatus(), 10000);
    return () => window.clearInterval(timer);
  }, [loadStatus, status]);
  usePageReturn(() => {
    setIsRetrying(false);
    setCancelModalOpen(false);
    void loadStatus();
  });
  const content = status ? statusContent(status) : null;
  const isIncompletePayment = status ? returnedWithoutPayment(status, "") : false;
  const isCancelledOrder = status?.status === "cancelled";
  async function finishPayment() {
    if (!status) return;
    setIsRetrying(true); setRetryError("");
    try {
      const checkout = await retryOrder(status.order_id);
      await rememberOrder(checkout.order_id);
      localStorage.setItem(storedOrderKey, checkout.order_id);
      window.location.assign(checkout.checkout_url);
    } catch {
      setRetryError("No pudimos abrir Mercado Pago. Intentá nuevamente.");
      setIsRetrying(false);
    }
  }
  async function confirmCancellation() {
    if (!status) return;
    setIsCancelling(true); setCancelError("");
    try {
      const cancelled = await cancelOrder(status.order_id);
      await saveOrderStatus(cancelled);
      localStorage.removeItem(storedOrderKey);
      localStorage.removeItem(revealIncompleteOrderKey);
      setStatus(cancelled);
      setCancelModalOpen(false);
    } catch {
      setCancelError("No pudimos cancelar el pedido. Intentá nuevamente.");
    } finally {
      setIsCancelling(false);
    }
  }
  return (
    <main className="page order-detail-page"><div className="shell shell--narrow">
      <Link className="back-link" to="/orders">← Mis pedidos</Link>
      <section className="result-card result-card--embedded result-card--order-detail" aria-live="polite">
        {!content && !error && <p className="loading">Actualizando pedido…</p>}
        {error && <div className="notice notice--error">{error}</div>}
        {content && status && <>
          <span className="eyebrow">Pedido {shortOrderId(status.order_id)}</span>
          <h1 className={isIncompletePayment ? "result-title--compact" : undefined}>{content.title}</h1>
          {!status.can_retry && !isCancelledOrder && <p>{content.text}</p>}
          {!isIncompletePayment && !isCancelledOrder && <div className="order-state-list">
            {!status.can_retry && <div><span>Estado del pago</span><strong>{orderStatusLabel(status)}</strong></div>}
            <div><span>Estado del pedido</span><strong>{fulfillmentStatusLabel(status)}</strong></div>
          </div>}
          {status.can_retry && <div className="order-detail-actions">
            {retryError && <p className="retry-error" role="alert">{retryError}</p>}
            <button type="button" onClick={() => void finishPayment()} disabled={isRetrying}>{isRetrying ? "Abriendo Mercado Pago…" : "Terminar pago"}</button>
          </div>}
          <div className="order-detail-items">
            <h2>Tu pedido</h2>
            {status.items.map((item, index) => <div className="order-detail-item" key={item.product_id ?? `${item.product_name}-${index}`}>
              <div><strong>{item.quantity} × {item.product_name}</strong><small>{formatPrice(item.unit_price, status.currency)} c/u</small></div>
              <strong>{formatPrice(item.subtotal, status.currency)}</strong>
            </div>)}
            <div className="order-detail-total"><span>Total</span><strong>{formatPrice(status.total_amount, status.currency)}</strong></div>
            {status.can_retry && <button
              className="cancel-order-trigger"
              type="button"
              onClick={() => { setCancelError(""); setCancelModalOpen(true); }}
            >Cancelar pedido</button>}
          </div>
        </>}
      </section>
      {cancelModalOpen && status?.can_retry && <div
        className="confirmation-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isCancelling && !isRetrying) {
            setCancelModalOpen(false);
          }
        }}
      >
        <section
          className="confirmation-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-order-title"
        >
          <h2 id="cancel-order-title">¿Querés cancelar este pedido?</h2>
          <p>Si lo cancelás, no vas a poder retomarlo.</p>
          {cancelError && <p className="retry-error" role="alert">{cancelError}</p>}
          <div className="confirmation-modal__actions">
            <button
              className="danger-button"
              type="button"
              onClick={() => void confirmCancellation()}
              disabled={isCancelling || isRetrying}
            >{isCancelling ? "Cancelando…" : "Cancelar pedido"}</button>
            <button
              type="button"
              onClick={() => void finishPayment()}
              disabled={isCancelling || isRetrying}
              autoFocus
            >{isRetrying ? "Abriendo Mercado Pago…" : "Terminar pago"}</button>
          </div>
        </section>
      </div>}
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
      if (isIncompleteOrderStatus(current)) {
        localStorage.setItem(revealIncompleteOrderKey, current.order_id);
      }
      if (terminalStatuses.has(current.status) || current.checkout_state === "abandoned") {
        localStorage.removeItem(storedOrderKey);
      }
    } catch { setError("No pudimos consultar el estado del pago. Intentá nuevamente."); }
  }, [orderId, returnKind]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!status || terminalStatuses.has(status.status) || status.checkout_state === "abandoned") return;
    const timer = window.setInterval(() => void loadStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [loadStatus, status]);
  usePageReturn(() => {
    setIsRetrying(false);
    void loadStatus();
  });
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
  const isIncompletePayment = status ? returnedWithoutPayment(status, returnKind) : false;
  return (
    <main className="payment-page"><section className="result-card" aria-live="polite">
      {!content && !error && <p className="loading">Verificando el pago…</p>}
      {error && <><div className="result-icon result-icon--error">!</div><h1>No pudimos verificarlo</h1><p>{error}</p><button type="button" onClick={() => void loadStatus()}>Reintentar</button></>}
      {!error && content && status && <>{!isIncompletePayment && <div className={`result-icon result-icon--${content.tone}`}>{content.icon}</div>}<span className="eyebrow">Estado del pedido</span><h1 className={isIncompletePayment ? "result-title--compact" : undefined}>{content.title}</h1>{!isIncompletePayment && <p>{content.text}</p>}<strong className="result-amount">{formatPrice(status.total_amount, status.currency)}</strong><small>Pedido {shortOrderId(status.order_id)}</small>{retryError && <p className="retry-error" role="alert">{retryError}</p>}<div className="result-actions">{status.can_retry && <button type="button" onClick={() => void retryPayment()} disabled={isRetrying}>{isRetrying ? "Abriendo Mercado Pago…" : isIncompletePayment ? "Completar el pago" : "Pagar con otra tarjeta"}</button>}<Link className="button-link button-link--secondary" to="/orders">Ver mis pedidos</Link><Link className="text-link" to="/menu">Volver al menú</Link></div></>}
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
        <Route path="cart" element={<Navigate to="/orders#current" replace />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:orderId" element={<OrderDetailPage />} />
      </Route>
      <Route path="payment/:returnKind" element={<PaymentResultPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes></ShopProvider></BrowserRouter>
  );
}
