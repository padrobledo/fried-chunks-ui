import { useCallback, useEffect, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const storedOrderKey = "fried_chunks_order_id";

type Product = {
  product_id: string;
  product_name: string;
  product_description: string;
  product_price: string;
  available: boolean;
  picture: string | null;
};

type Checkout = {
  checkout_url: string;
  order_id: string;
  provider_order_id: string;
};

type OrderStatus = {
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

const terminalStatuses = new Set([
  "paid",
  "failed",
  "cancelled",
  "expired",
  "refunded",
  "partially_refunded",
  "disputed",
]);

function formatPrice(value: string, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(Number(value));
}

function returnedWithoutPayment(status: OrderStatus, returnKind: string) {
  return returnKind === "failure"
    && status.payment_attempt_status === null
    && (
      status.checkout_state === "abandoned"
      || (status.status === "awaiting_payment" && status.payment_status === "created")
    );
}

async function fetchOrderStatus(orderId: string): Promise<OrderStatus> {
  const response = await fetch(`${apiUrl}/orders/${orderId}/status`);
  if (!response.ok) throw new Error("status unavailable");
  return response.json();
}

function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [redirectingProduct, setRedirectingProduct] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [returnMessage, setReturnMessage] = useState("");

  useEffect(() => {
    fetch(`${apiUrl}/products`)
      .then((response) => {
        if (!response.ok) throw new Error("products unavailable");
        return response.json() as Promise<Product[]>;
      })
      .then(setProducts)
      .catch(() => setError("No pudimos cargar los productos. Intentá nuevamente."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const orderId = localStorage.getItem(storedOrderKey);
    if (!orderId) return;

    fetchOrderStatus(orderId)
      .then(async (status) => {
        if (status.status === "paid") {
          setReturnMessage("Tu último pago fue acreditado.");
        } else if (status.status === "failed") {
          setReturnMessage("Tu último pago fue rechazado. Podés intentarlo nuevamente.");
        } else if (["awaiting_payment", "payment_processing"].includes(status.status)) {
          const response = await fetch(`${apiUrl}/orders/${orderId}/abandoned`, {
            method: "POST",
          });
          if (response.ok) {
            setReturnMessage("Volviste sin completar el pago. Podés iniciar uno nuevo.");
            localStorage.removeItem(storedOrderKey);
          }
        }
        if (terminalStatuses.has(status.status) || status.status === "awaiting_payment") {
          localStorage.removeItem(storedOrderKey);
        }
      })
      .catch(() => localStorage.removeItem(storedOrderKey));
  }, []);

  async function startCheckout(productId: string) {
    setRedirectingProduct(productId);
    setError("");

    try {
      const response = await fetch(`${apiUrl}/products/${productId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("checkout unavailable");

      const checkout: Checkout = await response.json();
      localStorage.setItem(storedOrderKey, checkout.order_id);
      window.location.assign(checkout.checkout_url);
    } catch {
      setError("No pudimos iniciar el pago. Revisá la configuración e intentá nuevamente.");
      setRedirectingProduct(null);
    }
  }

  return (
    <main>
      <div className="shell">
        <header className="hero">
          <span className="eyebrow">Fried Chunks</span>
          <h1>Elegí. Pagá. Disfrutá.</h1>
          <p>Compra segura con Mercado Pago.</p>
        </header>

        {returnMessage && <div className="notice">{returnMessage}</div>}
        {error && <div className="notice notice--error" role="alert">{error}</div>}

        {loading ? (
          <p className="loading">Cargando productos…</p>
        ) : (
          <section className="product-grid" aria-label="Productos disponibles">
            {products.map((product) => (
              <article className="product-card" key={product.product_id}>
                {product.picture ? (
                  <img src={product.picture} alt="" className="product-picture" />
                ) : (
                  <div className="product-placeholder" aria-hidden="true">FC</div>
                )}
                <div className="product-content">
                  <h2>{product.product_name}</h2>
                  <p>{product.product_description}</p>
                  <strong className="price">{formatPrice(product.product_price)}</strong>
                  <button
                    type="button"
                    onClick={() => startCheckout(product.product_id)}
                    disabled={redirectingProduct !== null}
                  >
                    {redirectingProduct === product.product_id
                      ? "Abriendo Mercado Pago…"
                      : "Pagar con Mercado Pago"}
                  </button>
                </div>
              </article>
            ))}
            {!products.length && !error && <p>No hay productos disponibles.</p>}
          </section>
        )}
      </div>
    </main>
  );
}

function statusContent(status: OrderStatus, returnKind: string) {
  if (status.status === "paid") {
    return { icon: "✓", title: "Pago exitoso", text: "Recibimos tu pago correctamente.", tone: "success" };
  }
  if (returnedWithoutPayment(status, returnKind)) {
    return {
      icon: "↩",
      title: "No completaste el pago",
      text: "Volviste a la tienda antes de finalizar. No se registró ningún cobro.",
      tone: "pending",
    };
  }
  if ([
    "insufficient_amount",
    "card_insufficient_amount",
    "cc_rejected_insufficient_amount",
  ].includes(status.payment_attempt_status_detail ?? status.payment_status_detail ?? "")) {
    return {
      icon: "×",
      title: "Fondos insuficientes",
      text: "La tarjeta no tiene saldo o límite disponible para completar el pago. Probá con otra tarjeta.",
      tone: "error",
    };
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

function PaymentResult({ returnKind }: { returnKind: string }) {
  const query = new URLSearchParams(window.location.search);
  const orderId = query.get("order_id") ?? query.get("external_reference") ?? localStorage.getItem(storedOrderKey);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState("");
  const [retryError, setRetryError] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!orderId) {
      setError("No encontramos el identificador del pedido.");
      return;
    }
    try {
      let current = await fetchOrderStatus(orderId);

      if (returnedWithoutPayment(current, returnKind) && current.checkout_state !== "abandoned") {
        const response = await fetch(`${apiUrl}/orders/${orderId}/abandoned`, {
          method: "POST",
        });
        if (response.ok) current = await response.json() as OrderStatus;
      }

      setError("");
      setStatus(current);
      if (terminalStatuses.has(current.status) || current.checkout_state === "abandoned") {
        localStorage.removeItem(storedOrderKey);
      }
    } catch {
      setError("No pudimos consultar el estado del pago. Intentá nuevamente.");
    }
  }, [orderId, returnKind]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status || terminalStatuses.has(status.status) || status.checkout_state === "abandoned") return;
    const timer = window.setInterval(() => void loadStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [loadStatus, status]);

  async function retryPayment() {
    if (!orderId) return;
    setIsRetrying(true);
    setRetryError("");
    try {
      const response = await fetch(`${apiUrl}/orders/${orderId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("retry unavailable");
      const checkout: Checkout = await response.json();
      localStorage.setItem(storedOrderKey, checkout.order_id);
      window.location.assign(checkout.checkout_url);
    } catch {
      setRetryError("No pudimos iniciar un nuevo intento. Volvé a probar en unos segundos.");
      setIsRetrying(false);
    }
  }

  const content = status ? statusContent(status, returnKind) : null;

  return (
    <main>
      <section className="result-card" aria-live="polite">
        {!content && !error && <p className="loading">Verificando el pago…</p>}
        {error && (
          <>
            <div className="result-icon result-icon--error">!</div>
            <h1>No pudimos verificarlo</h1>
            <p>{error}</p>
            <button type="button" onClick={() => void loadStatus()}>Reintentar</button>
          </>
        )}
        {!error && content && status && (
          <>
            <div className={`result-icon result-icon--${content.tone}`}>{content.icon}</div>
            <span className="eyebrow">Estado del pedido</span>
            <h1>{content.title}</h1>
            <p>{content.text}</p>
            <strong className="result-amount">{formatPrice(status.total_amount, status.currency)}</strong>
            <small>Pedido {status.order_id.slice(0, 8).toUpperCase()}</small>
            {retryError && <p className="retry-error" role="alert">{retryError}</p>}
            <div className="result-actions">
              {status.can_retry && (
                <button type="button" onClick={() => void retryPayment()} disabled={isRetrying}>
                  {isRetrying ? "Abriendo Mercado Pago…" : "Pagar con otra tarjeta"}
                </button>
              )}
              <a className="button-link button-link--secondary" href="/">Volver a la tienda</a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default function App() {
  const match = window.location.pathname.match(/^\/payment\/(success|failure|pending)\/?$/);
  return match ? <PaymentResult returnKind={match[1]} /> : <Catalog />;
}
