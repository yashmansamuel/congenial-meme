import { getAuthenticatedUser } from "../lib/auth.js";
import { setJsonHeaders, isAllowedOrigin } from "../lib/http.js";

function clean(value) {
  return typeof value === "string"
    ? value.trim().replace(/^['"]|['"]$/g, "")
    : "";
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function safeLemonCheckoutUrl(value) {
  const raw = clean(value);

  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);

    const trustedHost =
      url.hostname === "lemonsqueezy.com" ||
      url.hostname.endsWith(".lemonsqueezy.com");

    if (url.protocol !== "https:" || !trustedHost) {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}

function getSuccessUrl(req) {
  const configured =
    clean(process.env.LEMON_SQUEEZY_SUCCESS_URL) ||
    clean(process.env.CHECKOUT_SUCCESS_URL) ||
    clean(process.env.APP_ORIGIN);

  if (configured) {
    try {
      return new URL(configured).toString();
    } catch {
      return "";
    }
  }

  const proto =
    req.headers["x-forwarded-proto"] ||
    (req.connection?.encrypted ? "https" : "http");

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  if (!host) {
    return "";
  }

  try {
    return new URL("/neo?checkout=success", `${proto}://${host}`).toString();
  } catch {
    return "";
  }
}

function getCancelUrl(req) {
  const configured =
    clean(process.env.LEMON_SQUEEZY_CANCEL_URL) ||
    clean(process.env.APP_ORIGIN);

  if (configured) {
    try {
      return new URL(configured).toString();
    } catch {
      return "";
    }
  }

  const proto =
    req.headers["x-forwarded-proto"] ||
    (req.connection?.encrypted ? "https" : "http");

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  if (!host) {
    return "";
  }

  try {
    return new URL("/neo?checkout=cancelled", `${proto}://${host}`).toString();
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  setJsonHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  try {
    if (!isAllowedOrigin(req)) {
      return res.status(403).json({
        error: "Request origin is not allowed."
      });
    }
  } catch (error) {
    console.error("Checkout origin check failed:", error);

    return res.status(500).json({
      error: "Checkout is not configured safely."
    });
  }

  const user = getAuthenticatedUser(req);

  if (!user?.userId) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  if (!isNumericId(user.userId)) {
    return res.status(401).json({
      error: "Invalid user session. Please login again."
    });
  }

  const apiKey = clean(process.env.LEMON_SQUEEZY_API_KEY);
  const storeId = clean(process.env.LEMON_SQUEEZY_STORE_ID);
  const variantId =
    clean(process.env.LEMON_SQUEEZY_VARIANT_ID) ||
    clean(process.env.LEMON_SQUEEZY_NEO_PRO_VARIANT_ID);

  if (!apiKey || !storeId || !variantId) {
    console.error("Checkout config missing:", {
      hasApiKey: Boolean(apiKey),
      hasStoreId: Boolean(storeId),
      hasVariantId: Boolean(variantId)
    });

    return res.status(503).json({
      error: "Checkout is not configured. Please check Lemon Squeezy environment variables."
    });
  }

  const successUrl = getSuccessUrl(req);
  const cancelUrl = getCancelUrl(req);

  const attributes = {
    checkout_data: {
      custom: {
        user_id: String(user.userId),
        username: String(user.username || "")
      }
    },
    product_options: {}
  };

  if (successUrl) {
    attributes.product_options.redirect_url = successUrl;
  }

  if (cancelUrl) {
    attributes.product_options.cancel_url = cancelUrl;
  }

  try {
    const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes,
          relationships: {
            store: {
              data: {
                type: "stores",
                id: String(storeId)
              }
            },
            variant: {
              data: {
                type: "variants",
                id: String(variantId)
              }
            }
          }
        }
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Lemon checkout API error:", {
        status: response.status,
        errors: data?.errors || data
      });

      return res.status(502).json({
        error: "Unable to start checkout. Please try again."
      });
    }

    const checkoutUrl = safeLemonCheckoutUrl(data?.data?.attributes?.url);

    if (!checkoutUrl) {
      console.error("Lemon checkout URL missing:", data);

      return res.status(502).json({
        error: "Checkout URL was not returned. Please try again."
      });
    }

    return res.status(200).json({
      success: true,
      url: checkoutUrl
    });
  } catch (error) {
    console.error("Lemon Squeezy checkout failed:", error);

    return res.status(502).json({
      error: "Unable to start checkout. Please try again."
    });
  }
}
