import { fetchDiscounts } from "@siggistore/services/storefront";

export const CART_KEY = "appCartItems";
export const FAVORITES_KEY = "appFavorites";
export const CART_UPDATE_EVENT = "cart:update";
export const FAVORITES_UPDATE_EVENT = "favorites:update";
export const APPLIED_DISCOUNT_KEY = "appAppliedDiscount";
export const DISCOUNT_UPDATE_EVENT = "discount:update";
export const STOREFRONT_PROMOTION_STORAGE_KEY = "siggistore-storefront-promo-discount";

let storefrontPromotionPromise = null;
let storefrontPromotionCache = null;
let storefrontPromotionFetchedAt = 0;
const STOREFRONT_PROMOTION_TTL_MS = 60 * 1000;

function safeReadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.warn("Unable to read storage key.", key, error);
    return fallback;
  }
}

function safeWriteJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function safeRemoveStorageItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn("Unable to remove storage key.", key, error);
  }
}

function dispatchStoreEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function getLabelText(element) {
  return (element.textContent || "").trim();
}

function isDiscountWithinSchedule(discount, now = new Date()) {
  const start = discount?.starts_at ? new Date(discount.starts_at) : null;
  const end = discount?.ends_at ? new Date(discount.ends_at) : null;

  if (start && !Number.isNaN(start.getTime()) && start > now) return false;
  if (end && !Number.isNaN(end.getTime()) && end < now) return false;
  return true;
}

function isGlobalDiscount(discount) {
  const scope = String(discount?.scope ?? discount?.applies_to ?? "").toLowerCase().trim();
  if (!scope) return true;
  return ["global", "all", "all products", "sitewide", "storewide"].includes(scope);
}

function isDiscountUsageAvailable(discount) {
  const usageLimit = Number(discount?.usage_limit ?? 0);
  if (!Number.isFinite(usageLimit) || usageLimit <= 0) return true;
  return (Number(discount?.usage_count ?? 0) || 0) < usageLimit;
}

function normalizeAppliedDiscount(discount) {
  if (!discount) return null;

  return {
    ...discount,
    code: String(discount.code ?? "").trim().toUpperCase(),
    status: String(discount.status ?? "draft").trim().toLowerCase(),
    type: String(discount.type ?? "percent").trim().toLowerCase(),
    value: Number(discount.value ?? discount.amount ?? 0) || 0,
    amount: Number(discount.amount ?? discount.value ?? 0) || 0,
    usage_limit:
      discount.usage_limit == null || discount.usage_limit === ""
        ? null
        : Number(discount.usage_limit) || null,
    usage_count: Number(discount.usage_count ?? 0) || 0,
  };
}

function formatPromoValue(discount) {
  const rawValue = Number(discount?.value ?? discount?.amount ?? 0);
  const safeValue = Number.isFinite(rawValue) ? rawValue : 0;
  const type = String(discount?.type ?? "").toLowerCase();

  if (type.includes("percent")) return `${safeValue}% off`;
  return `${safeValue} FCFA off`;
}

function formatPromoEndDate(discount) {
  if (!discount?.ends_at) return "";
  const date = new Date(discount.ends_at);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function buildStorefrontPromotion(discount) {
  if (!discount) return null;

  const name = String(discount.name ?? discount.title ?? "Seasonal Sale").trim();
  const code = String(discount.code ?? "").trim().toUpperCase();
  const promoValue = formatPromoValue(discount);
  const endDate = formatPromoEndDate(discount);

  const defaultHeroHeadline = String(discount?.type ?? "").toLowerCase().includes("percent")
    ? `Up to ${promoValue.replace(/\s+off$/i, "")}`
    : `Save ${promoValue.replace(/\s+off$/i, "")}`;

  return {
    badge: discount.promo_badge || promoValue,
    title: discount.promo_title || name,
    href: discount.promo_href || "./Product Listing.html",
    ctaLabel: discount.promo_cta_label || "Shop now",
    slides: [
      discount.headline_1 || `${promoValue} on selected items`,
      discount.headline_2 || (code ? `Use code ${code} at checkout` : `${name} is live now`),
      discount.headline_3 || (endDate ? `${name} ends ${endDate}` : `${name} is live now`),
    ],
    heroEyebrow: discount.hero_eyebrow || name,
    heroHeadline: discount.hero_headline || defaultHeroHeadline,
    shippingHeadline: discount.shipping_headline || `${name} is live now`,
    giftHeadline: discount.gift_headline || (code ? `Use code ${code}` : name),
    giftBody:
      discount.gift_body ||
      (code
        ? `Save ${promoValue.toLowerCase()} with code ${code}.`
        : `Save ${promoValue.toLowerCase()} while this offer lasts.`),
  };
}

function isActiveGlobalDiscount(discount, now = new Date()) {
  return (
    discount &&
    String(discount?.status ?? "").toLowerCase() === "active" &&
    isGlobalDiscount(discount) &&
    isDiscountWithinSchedule(discount, now)
  );
}

function readPersistedPromotionDiscount() {
  const snapshot = safeReadJson(STOREFRONT_PROMOTION_STORAGE_KEY, null);
  return snapshot?.discount ?? snapshot ?? null;
}

export function persistStorefrontPromotionDiscount(discount) {
  if (!discount) {
    storefrontPromotionCache = null;
    storefrontPromotionFetchedAt = Date.now();
    safeRemoveStorageItem(STOREFRONT_PROMOTION_STORAGE_KEY);
    return null;
  }

  safeWriteJson(STOREFRONT_PROMOTION_STORAGE_KEY, {
    savedAt: new Date().toISOString(),
    discount,
  });

  storefrontPromotionCache = buildStorefrontPromotion(discount);
  storefrontPromotionFetchedAt = Date.now();
  return storefrontPromotionCache;
}

export async function getStorefrontPromotion(options = {}) {
  const now = Date.now();
  const canReuseCache =
    !options.forceRefresh &&
    storefrontPromotionCache !== null &&
    now - storefrontPromotionFetchedAt < STOREFRONT_PROMOTION_TTL_MS;

  if (canReuseCache) {
    return storefrontPromotionCache;
  }

  if (!options.forceRefresh && storefrontPromotionPromise) {
    return storefrontPromotionPromise;
  }

  const persistedDiscount = readPersistedPromotionDiscount();
  if (!options.ignorePersisted && isActiveGlobalDiscount(persistedDiscount)) {
    storefrontPromotionCache = buildStorefrontPromotion(persistedDiscount);
    storefrontPromotionFetchedAt = now;
    return storefrontPromotionCache;
  }

  storefrontPromotionPromise = fetchDiscounts({ limit: 100, status: "active" })
    .then((discounts) => {
      const currentTime = new Date();
      const activeGlobalDiscount = (discounts || []).find(
        (discount) => isActiveGlobalDiscount(discount, currentTime),
      );

      if (activeGlobalDiscount) {
        persistStorefrontPromotionDiscount(activeGlobalDiscount);
      } else {
        persistStorefrontPromotionDiscount(null);
      }

      storefrontPromotionFetchedAt = Date.now();
      return storefrontPromotionCache;
    })
    .catch((error) => {
      console.warn("Unable to fetch storefront promotion.", error);
      storefrontPromotionCache = null;
      storefrontPromotionFetchedAt = Date.now();
      return null;
    })
    .finally(() => {
      storefrontPromotionPromise = null;
    });

  return storefrontPromotionPromise;
}

export async function applyStorefrontDiscountPromos(root = document, options = {}) {
  const scope = root || document;
  const promotion = await getStorefrontPromotion(options);
  if (!promotion) return null;

  scope.querySelectorAll("[data-storefront-promo-slide]").forEach((node, index) => {
    node.textContent = promotion.slides[index] || promotion.slides[promotion.slides.length - 1] || "";
  });

  scope.querySelectorAll("[data-storefront-promo-card-badge]").forEach((node) => {
    node.textContent = promotion.badge;
  });

  scope.querySelectorAll("[data-storefront-promo-card-title]").forEach((node) => {
    node.textContent = promotion.title;
  });

  scope.querySelectorAll("[data-storefront-promo-card-cta]").forEach((node) => {
    const firstChild = node.firstChild;
    if (firstChild && firstChild.nodeType === Node.TEXT_NODE) {
      firstChild.nodeValue = `${promotion.ctaLabel} `;
      return;
    }
    node.textContent = promotion.ctaLabel;
  });

  scope.querySelectorAll("[data-storefront-promo-card-link]").forEach((node) => {
    if (node.tagName === "A") {
      node.setAttribute("href", promotion.href);
    }
  });

  scope.querySelectorAll("[data-storefront-hero-eyebrow]").forEach((node) => {
    node.textContent = promotion.heroEyebrow;
  });

  scope.querySelectorAll("[data-storefront-hero-headline]").forEach((node) => {
    node.textContent = promotion.heroHeadline;
  });

  scope.querySelectorAll("[data-storefront-shipping-headline]").forEach((node) => {
    node.textContent = promotion.shippingHeadline;
  });

  scope.querySelectorAll("[data-storefront-gift-headline]").forEach((node) => {
    node.textContent = promotion.giftHeadline;
  });

  scope.querySelectorAll("[data-storefront-gift-body]").forEach((node) => {
    node.textContent = promotion.giftBody;
  });

  return promotion;
}

export function parsePrice(value) {
  if (typeof value === "number") return value;
  const numeric = String(value || "").replace(/[^0-9.-]+/g, "");
  return numeric ? Number(numeric) : 0;
}

export function formatPrice(value) {
  const amount = Math.round(Number(value || 0));
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}

export function getAppliedDiscount() {
  return normalizeAppliedDiscount(safeReadJson(APPLIED_DISCOUNT_KEY, null));
}

export function setAppliedDiscount(discount) {
  const normalized = normalizeAppliedDiscount(discount);
  if (!normalized) {
    clearAppliedDiscount();
    return null;
  }

  safeWriteJson(APPLIED_DISCOUNT_KEY, normalized);
  dispatchStoreEvent(DISCOUNT_UPDATE_EVENT, { discount: normalized });
  dispatchStoreEvent("storefront:discount-updated", { discount: normalized });
  return normalized;
}

export function clearAppliedDiscount() {
  safeRemoveStorageItem(APPLIED_DISCOUNT_KEY);
  dispatchStoreEvent(DISCOUNT_UPDATE_EVENT, { discount: null });
  dispatchStoreEvent("storefront:discount-updated", { discount: null });
}

export function getDiscountAmount(subtotal, discount = getAppliedDiscount()) {
  const normalizedSubtotal = Math.max(0, Number(subtotal || 0));
  const normalizedDiscount = normalizeAppliedDiscount(discount);

  if (!normalizedSubtotal || !normalizedDiscount) return 0;
  if (normalizedDiscount.status !== "active") return 0;
  if (!isGlobalDiscount(normalizedDiscount)) return 0;
  if (!isDiscountWithinSchedule(normalizedDiscount)) return 0;
  if (!isDiscountUsageAvailable(normalizedDiscount)) return 0;

  if (normalizedDiscount.type.includes("percent")) {
    return Math.min(
      normalizedSubtotal,
      Number(((normalizedSubtotal * normalizedDiscount.value) / 100).toFixed(2)),
    );
  }

  return Math.min(normalizedSubtotal, Math.max(0, normalizedDiscount.value));
}

export function normalizeCartItem(item, index = 0) {
  return {
    id: item.id || "cart-item-" + index + "-" + Date.now(),
    product_id: item.product_id || item.id || "product-" + index,
    title: item.title || "Cart item",
    price: Number(item.price || 0),
    originalPrice: item.originalPrice ? Number(item.originalPrice) : null,
    image: item.image || "",
    color: item.color || "Default",
    size: item.size || "One size",
    quantity: Math.max(1, Number(item.quantity || 1)),
    href: item.href || "./Product Detail.html",
  };
}

export function normalizeFavoriteItem(item, index = 0) {
  return {
    id: item.id || item.product_id || "favorite-item-" + index,
    title: item.title || "Favorite item",
    href: item.href || "./Product Detail.html",
    image: item.image || "",
    price: Number(item.price || 0),
    category: item.category || "",
  };
}

export function getCart() {
  return safeReadJson(CART_KEY, []).map((item, index) => normalizeCartItem(item, index));
}

export function getFavorites() {
  return safeReadJson(FAVORITES_KEY, []).map((item, index) => normalizeFavoriteItem(item, index));
}

export function getCartCount(cart = getCart()) {
  return cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

export function getCartSubtotal(cart = getCart()) {
  return cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
}

export function setCart(cart) {
  const normalized = cart.map((item, index) => normalizeCartItem(item, index));
  safeWriteJson(CART_KEY, normalized);
  dispatchStoreEvent(CART_UPDATE_EVENT, { cart: normalized, count: getCartCount(normalized) });
  dispatchStoreEvent("storefront:cart-updated", { cart: normalized, count: getCartCount(normalized) });
  return normalized;
}

export function setFavorites(favorites) {
  const normalized = favorites.map((item, index) => normalizeFavoriteItem(item, index));
  safeWriteJson(FAVORITES_KEY, normalized);
  dispatchStoreEvent(FAVORITES_UPDATE_EVENT, { favorites: normalized, count: normalized.length });
  dispatchStoreEvent("storefront:favorites-updated", { favorites: normalized, count: normalized.length });
  return normalized;
}

export function addToCart(item) {
  const normalizedItem = normalizeCartItem(item, 0);
  const currentCart = getCart();
  const existing = currentCart.find(
    (entry) =>
      entry.product_id === normalizedItem.product_id &&
      entry.color === normalizedItem.color &&
      entry.size === normalizedItem.size,
  );

  const nextCart = existing
    ? currentCart.map((entry) =>
        entry === existing
          ? normalizeCartItem(
              { ...entry, quantity: Number(entry.quantity || 0) + Number(normalizedItem.quantity || 1) },
              0,
            )
          : entry,
      )
    : currentCart.concat([normalizedItem]);

  return setCart(nextCart);
}

export function removeFromCart(id) {
  return setCart(getCart().filter((item) => item.id !== id));
}

export function clearCart() {
  return setCart([]);
}

export function toggleFavorite(item) {
  const normalizedItem = normalizeFavoriteItem(item, 0);
  const currentFavorites = getFavorites();
  const exists = currentFavorites.some((entry) => entry.id === normalizedItem.id);
  const nextFavorites = exists
    ? currentFavorites.filter((entry) => entry.id !== normalizedItem.id)
    : currentFavorites.concat([normalizedItem]);

  return {
    favorites: setFavorites(nextFavorites),
    saved: !exists,
  };
}

export function isFavorite(id) {
  return getFavorites().some((item) => item.id === id);
}

function readDatasetProduct(trigger) {
  if (!trigger || !trigger.dataset) return null;

  const productId = trigger.dataset.productId;
  const title = trigger.dataset.productTitle;
  const href = trigger.dataset.productHref;
  const image = trigger.dataset.productImage;
  const price = trigger.dataset.productPrice;
  const color = trigger.dataset.productColor;
  const size = trigger.dataset.productSize || trigger.dataset.productCategory;
  const quantity = trigger.dataset.productQuantity;

  if (!productId && !title && !href) return null;

  return normalizeCartItem(
    {
      id: productId || href || title,
      product_id: productId || href || title,
      title: title || "Product",
      href: href || "./Product Detail.html",
      image: image || "",
      color: color || "Default",
      size: size || "One size",
      quantity: Number(quantity || 1),
      price: parsePrice(price || 0),
    },
    0,
  );
}

export function extractProductContext(trigger) {
  // Find the closest element with data-product-id
  const container = trigger.closest('[data-product-id]');
  if (!container) return null;
  return readDatasetProduct(container);
}

export function hydrateProductDataAttributes(root = document) {
  const scope = root || document;
  const actionElements = Array.from(scope.querySelectorAll("button, a, [data-favorite-toggle]"));

  actionElements.forEach((element) => {
    const text = getLabelText(element);
    const favoriteLabel = element.querySelector(".rfrdb");
    const favoriteText = favoriteLabel ? getLabelText(favoriteLabel) : "";
    const isAddToCart = text === "Add to cart";
    const isFavoriteTrigger =
      element.matches("[data-favorite-toggle]") ||
      favoriteText === "Add to favorites" ||
      favoriteText === "Saved to favorites" ||
      favoriteText === "Favorite" ||
      favoriteText === "Saved to favorite";

    if (!isAddToCart && !isFavoriteTrigger) return;

    const product = extractProductContext(element);
    if (!product) return;

    element.dataset.productId = product.product_id;
    element.dataset.productTitle = product.title;
    element.dataset.productHref = product.href;
    element.dataset.productImage = product.image || "";
    element.dataset.productPrice = String(product.price || 0);
    element.dataset.productColor = product.color || "Default";
    element.dataset.productSize = product.size || "One size";
    element.dataset.productQuantity = String(product.quantity || 1);

    if (isAddToCart) {
      element.dataset.commerceAction = "add-to-cart";
    }
  });
}

export function updateFavoritesSummaryUI(root = document) {
  const scope = root || document;
  const count = getFavorites().length;

  scope.querySelectorAll("[data-storefront-view-favorites]").forEach((element) => {
    element.textContent = count > 0 ? "View favorites (" + count + ")" : "View favorites";
    if (element.tagName === "A") {
      element.setAttribute("href", "./favorite.html");
    }
  });

  scope.querySelectorAll("a, button, span").forEach((element) => {
    if (element.hasAttribute("data-storefront-view-favorites")) return;
    const text = getLabelText(element);
    if (text === "View favorites" || /^View favorites \(\d+\)$/.test(text)) {
      element.textContent = count > 0 ? "View favorites (" + count + ")" : "View favorites";
      if (element.tagName === "A") {
        element.setAttribute("href", "./favorite.html");
      }
    }
  });

  const favoritesButton = scope.getElementById ? scope.getElementById("hs-pro-dnnd") : document.getElementById("hs-pro-dnnd");
  const badge = favoritesButton ? favoritesButton.querySelector(".preze") : null;
  if (badge) {
    badge.childNodes[0].nodeValue = String(count);
    badge.removeAttribute("data-storefront-hidden");
  }
}

export function renderFavoritesDropdown(root = document) {
  const scope = root || document;
  const container = scope.querySelector(
    '[aria-labelledby="hs-pro-dnnd"] .pf6kx.afsci .space-y-5',
  );
  if (!container) return;

  const favorites = getFavorites();
  if (!favorites.length) {
    container.innerHTML = '<p class="m859b f1ztf">No favorites saved yet.</p>';
    return;
  }

  container.innerHTML = favorites
    .map((item, index) => {
      const price = Number(item.price || 0);
      const priceMarkup = price
        ? '<span class="j9itz yymkp c4t4j">' + formatPrice(price) + "</span>"
        : "";

      return [
        '<div class="hs-removing:opacity-0 d5ksw flex haw2c" data-favorite-dropdown-row="' +
          item.id +
          '" id="hs-pro-shfdi-live-' +
          index +
          '">',
        '<div class="relative">',
        '<img alt="' +
          (item.title || "Favorite item") +
          '" class="y6rh0 cr96u aruvj fy2yn edpyz" src="' +
          (item.image || "data:,") +
          '">',
        "</div>",
        '<div class="t6ue9 flex flex-col">',
        '<h4 class="yymkp c4t4j">' + (item.title || "Favorite item") + "</h4>",
        priceMarkup,
        '<div class=""><button class="inline-flex items-center i220p text-[13px] c4t4j carpj a8v2i bz0ic focus:outline-hidden ti70c" data-favorite-remove="' +
          item.id +
          '" type="button">Remove</button></div>',
        "</div>",
        "</div>",
      ].join("");
    })
    .join("");

  container.querySelectorAll("[data-favorite-remove]").forEach((button) => {
    if (button.dataset.favoriteRemoveBound === "true") return;
    button.dataset.favoriteRemoveBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.getAttribute("data-favorite-remove");
      if (!id) return;
      setFavorites(getFavorites().filter((item) => item.id !== id));
    });
  });
}

export function updateCartSummaryUI(root = document) {
  const scope = root || document;
  const items = getCart();
  const itemCount = getCartCount(items);
  const subtotal = getCartSubtotal(items);
  const formattedSubtotal = formatPrice(subtotal);

  scope.querySelectorAll('a[href="./Cart.html"], a[href="./Cart.html#"]').forEach((link) => {
    if (/View cart/.test(link.textContent || "")) {
      link.textContent = "View cart (" + itemCount + ")";
    }
  });

  const cartHeading = scope.getElementById ? scope.getElementById("hs-pro-shco-label") : document.getElementById("hs-pro-shco-label");
  if (cartHeading) {
    cartHeading.textContent = "Cart (" + itemCount + " item" + (itemCount === 1 ? "" : "s") + ")";
  }

  const cartButton = scope.querySelector('[data-hs-overlay="#hs-pro-shco"]');
  const cartBadge = cartButton ? cartButton.querySelector(".preze") : null;
  if (cartBadge) {
    cartBadge.childNodes[0].nodeValue = String(itemCount);
    const srText = cartBadge.querySelector(".rfrdb");
    if (srText) srText.textContent = "Articles du panier";
    cartBadge.removeAttribute("data-storefront-hidden");
  }

  scope.querySelectorAll(".tex4h.hfud4.osjzw, .p3x4c.tex4h.hfud4.osjzw").forEach((row) => {
    const label = row.firstElementChild;
    if (!label) return;

    const labelText = (label.textContent || "").trim();
    const valueNode =
      row.querySelector("[data-order-summary-value]") ||
      row.querySelector(".qk13w > .ctc9x, .qk13w > span:last-child, .r49qf > .ctc9x, .r49qf > span:last-child");
    if (!valueNode) return;

    if (/Subtotal/i.test(labelText) || /^Total$/i.test(labelText)) {
      valueNode.textContent = formattedSubtotal;
      return;
    }

    if (/Shipping/i.test(labelText) || /Estimated Tax/i.test(labelText) || /^Tax$/i.test(labelText) || /Promo code/i.test(labelText) || /^Promo$/i.test(labelText) || /Sale/i.test(labelText) || /Discount/i.test(labelText)) {
      valueNode.textContent = "0 FCFA";
    }
  });

  scope.querySelectorAll(".d8kj8, .a3olr.d8kj8").forEach((node) => {
    if (/Shipping, taxes and discounts are calculated at checkout\./.test(node.textContent || "")) {
      node.textContent = "Livraison, taxes et remises calculees a l'etape du paiement.";
    }
  });
}

export function bindAddToCartButtons(root = document, options = {}) {
  const scope = root || document;
  hydrateProductDataAttributes(scope);

  scope.querySelectorAll('button, a, [data-commerce-action="add-to-cart"]').forEach((element) => {
    if (element.dataset.cartBound === "true") return;
    const text = getLabelText(element);
    if (text !== "Add to cart" && element.dataset.commerceAction !== "add-to-cart") return;

    element.dataset.cartBound = "true";
    element.addEventListener("click", (event) => {
      event.preventDefault();
      const item = extractProductContext(element);
      if (!item) return;

      const nextCart = addToCart(item);
      element.dataset.cartAdded = "true";
      const originalText = text || "Add to cart";
      element.textContent = "Added to cart";

      if (typeof options.onAfterAdd === "function") {
        options.onAfterAdd(item, nextCart, element);
      }

      window.setTimeout(() => {
        element.textContent = originalText;
        element.dataset.cartAdded = "false";
      }, 1500);
    });
  });
}

export function bindFavoriteToggles(root = document, options = {}) {
  const scope = root || document;
  hydrateProductDataAttributes(scope);

  scope.querySelectorAll("[data-favorite-toggle], button, a").forEach((element) => {
    if (element.dataset.favoriteBound === "true") return;

    const label = element.querySelector(".rfrdb");
    if (!label) return;

    const text = getLabelText(label);
    if (
      text !== "Add to favorites" &&
      text !== "Saved to favorites" &&
      text !== "Favorite" &&
      text !== "Saved to favorite"
    ) {
      return;
    }

    const product = extractProductContext(element);
    if (!product) return;

    const baseLabel = text === "Favorite" ? "Favorite" : "Add to favorites";
    const renderState = () => {
      const saved = isFavorite(product.product_id);
      label.textContent = saved ? "Saved to favorites" : baseLabel;
      element.setAttribute("aria-pressed", String(saved));
      if (typeof options.onRenderState === "function") {
        options.onRenderState(product, saved, element);
      }
    };

    element.dataset.favoriteBound = "true";
    element.style.cursor = "pointer";
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const result = toggleFavorite({
        id: product.product_id,
        title: product.title,
        href: product.href,
        image: product.image,
        price: product.price,
        category: product.size && product.color ? product.color + " / " + product.size : "",
      });
      renderState();
      if (typeof options.onAfterToggle === "function") {
        options.onAfterToggle(product, result, element);
      }
    });

    renderState();
  });
}

