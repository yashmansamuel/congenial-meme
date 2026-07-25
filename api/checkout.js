import { getAuthenticatedUser } from "../lib/auth.js";
import { setJsonHeaders, isAllowedOrigin } from "../lib/http.js";

function clean(value) {
  return typeof value === "string"
    ? value.trim().replace(/^['"]|['"]$/g, "")
    : "";
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

    return url.protocol === "https:" && trustedHost
      ? url.toString()
      : "";
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
  } catch {
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

  const hostedCheckoutUrl = safeLemonCheckoutUrl(
    process.env.LEMON_SQUEEZY_CHECKOUT_URL
  );

  const apiKey = clean(process.env.LEMON_SQUEEZY_API_KEY);
  const storeId = clean(process.env.LEMON_SQUEEZY_STORE_ID);
  const variantId = clean(process.env.LEMON_SQUEEZY_VARIANT_ID);

  if (!apiKey || !storeId || !variantId) {
    if (hostedCheckoutUrl) {
      return res.status(200).json({
        success: true,
        url: hostedCheckoutUrl
      });
    }

    return res.status(503).json({
      error:
        "Checkout is not configured. Add LEMON_SQUEEZY_CHECKOUT_URL or the Lemon API settings."
    });
  }

  const redirectUrl = clean(
    process.env.LEMON_SQUEEZY_SUCCESS_URL ||
    process.env.APP_ORIGIN
  );

  const attributes = {
    checkout_data: {
      custom: {
        user_id: String(user.userId),
        username: String(user.username || "")
      }
    }
  };

  if (redirectUrl) {
    attributes.product_options = {
      redirect_url: redirectUrl
    };
  }

  try {
    const response = await fetch(
      "https://api.lemonsqueezy.com/v1/checkouts",
      {
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
                  id: storeId
                }
              },
              variant: {
                data: {
                  type: "variants",
                  id: variantId
                }
              }
            }
          }
        })
      }
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data?.errors?.[0]?.detail ||
        "Checkout provider request failed."
      );
    }

    const checkoutUrl = safeLemonCheckoutUrl(
      data?.data?.attributes?.url
    );

    if (!checkoutUrl) {
      throw new Error(
        "Checkout URL was not returned by Lemon Squeezy."
      );
    }

    return res.status(200).json({
      success: true,
      url: checkoutUrl
    });
  } catch (error) {
    console.error(
      "Lemon Squeezy checkout failed:",
      error?.message
    );

    if (hostedCheckoutUrl) {
      return res.status(200).json({
        success: true,
        url: hostedCheckoutUrl,
        fallback: true
      });
    }

    return res.status(502).json({
      error:
        "Unable to start checkout. Please try again."
    });
  }
}
