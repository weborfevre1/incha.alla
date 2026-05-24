(function () {
  if (window.__storefrontHeaderStandardizerLoaded) {
    return;
  }
  window.__storefrontHeaderStandardizerLoaded = true;

  const authKey = "appLoggedIn";
  const authEmailKey = "appUserEmail";
  const authNameKey = "appUserName";
  const authAvatarKey = "appUserAvatar";
  const cartItemsKey = "appCartItems";
  const favoritesKey = "appFavorites";
  const newsletterKey = "appNewsletterSubscribers";
  const checkoutDraftKey = "appCheckoutDraft";
  const lastCheckoutDetailsKey = "appLastCheckoutDetails";
  const reviewSnapshotKey = "appReviewOrderSnapshot";
  const ordersKey = "appOrders";
  const latestOrderKey = "appLatestOrder";
  const lookupOrderKey = "appLookupOrder";
  const productRuntimeTable = "products_runtime";
  const displayVariantsChannelPrefix = "__display_variants:";
  const displayMetaChannelPrefix = "__display_meta:";
  const decodedPathname = decodeURIComponent(window.location.pathname);
  let servicesPromise = null;
  let supabasePromise = null;
  let commerceStore = null;
  let commerceStorePromise = null;
  let initialized = false;
  let authSyncStarted = false;

  function isPage(name) {
    return decodedPathname.endsWith("/" + name) || decodedPathname.endsWith(name);
  }

  function readJsonStorage(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn("Unable to read storage key.", key, error);
      return fallback;
    }
  }

  function writeJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clearStoredAuth() {
    sessionStorage.clear();
    localStorage.removeItem(authKey);
    localStorage.removeItem(authEmailKey);
    localStorage.removeItem(authNameKey);
    localStorage.removeItem(authAvatarKey);
  }

  function getServices() {
    if (!servicesPromise) {
      servicesPromise = import("/src/services/supabase-service.ts")
        .then(function (module) {
          return module;
        })
        .catch(function (error) {
          console.warn("Unable to load storefront services.", error);
          return null;
        });
    }

    return servicesPromise;
  }

  function getSupabaseClient() {
    if (!supabasePromise) {
      supabasePromise = import("/src/lib/supabase.ts")
        .then(function (module) {
          return module.supabase;
        })
        .catch(function (error) {
          console.warn("Unable to load Supabase client.", error);
          return null;
        });
    }

    return supabasePromise;
  }

  async function getCurrentUser() {
    const services = await getServices();
    if (!services || !services.supabaseAuthService) return null;

    try {
      return await services.supabaseAuthService.getCurrentUser();
    } catch (error) {
      console.warn("Unable to resolve current user.", error);
      return null;
    }
  }

  function getFallbackCartCount(items) {
    return items.reduce(function (sum, item) {
      return sum + Number(item.quantity || 0);
    }, 0);
  }

  function getFallbackCartSubtotal(items) {
    return items.reduce(function (sum, item) {
      return sum + Number(item.price || 0) * Number(item.quantity || 0);
    }, 0);
  }

  function getCommerceStore() {
    if (commerceStore) {
      return Promise.resolve(commerceStore);
    }

    if (!commerceStorePromise) {
      commerceStorePromise = import("/src/lib/store.js")
        .then(function (module) {
          commerceStore = module;
          return module;
        })
        .catch(function (error) {
          console.warn("Unable to load storefront commerce store.", error);
          return null;
        });
    }

    return commerceStorePromise;
  }

  function createMessageNode(container, attributeName) {
    if (!container) return null;

    let node = container.querySelector("[" + attributeName + "]");
    if (node) return node;

    node = document.createElement("p");
    node.setAttribute(attributeName, "true");
    node.style.marginTop = "0.5rem";
    node.style.fontSize = "0.875rem";
    container.appendChild(node);
    return node;
  }

  function showMessage(container, attributeName, message, tone) {
    const node = createMessageNode(container, attributeName);
    if (!node) return;
    node.textContent = message;
    node.style.color = tone === "error" ? "#b91c1c" : "#166534";
  }

  function findActionLink(href, labelPattern) {
    return Array.from(document.querySelectorAll('a[href="' + href + '"]'))
      .reverse()
      .find(function (link) {
        return labelPattern.test((link.textContent || "").trim());
      }) || null;
  }

  function parsePrice(value) {
    if (commerceStore && commerceStore.parsePrice) {
      return commerceStore.parsePrice(value);
    }
    if (typeof value === "number") return value;
    const numeric = String(value || "").replace(/[^0-9.-]+/g, "");
    return numeric ? Number(numeric) : 0;
  }

  function formatPrice(value) {
    if (commerceStore && commerceStore.formatPrice) {
      return commerceStore.formatPrice(value);
    }
    return "$" + Number(value || 0).toFixed(2).replace(/\.00$/, "");
  }

  function getProductSlugFromHref(href) {
    if (!href) return "";

    try {
      const url = new URL(href, window.location.origin);
      return url.searchParams.get("slug") || "";
    } catch (error) {
      return "";
    }
  }

  function buildWriteReviewHref(item) {
    const normalized = normalizeCartItem(item || {}, 0);
    const params = new URLSearchParams();
    const slug = getProductSlugFromHref(normalized.href);

    if (slug) params.set("slug", slug);
    if (normalized.title) params.set("title", normalized.title);
    if (normalized.image) params.set("image", normalized.image);

    const query = params.toString();
    return "./write-a-product-review.html" + (query ? "?" + query : "");
  }

  async function getReviewService() {
    const services = await getServices();
    return services && services.supabaseReviewService ? services.supabaseReviewService : null;
  }

  function formatReviewRelativeTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Just now";

    const diffMs = date.getTime() - Date.now();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

    if (Math.abs(diffMs) < hour) {
      return rtf.format(Math.round(diffMs / minute), "minute");
    }

    if (Math.abs(diffMs) < day) {
      return rtf.format(Math.round(diffMs / hour), "hour");
    }

    return rtf.format(Math.round(diffMs / day), "day");
  }

  function getRecommendationLabel(value) {
    return value === "yes" ? "Highly recommended" : "Not recommended";
  }

  function renderProductReviewStars(rating) {
    const total = 5;
    const filledCount = Math.max(0, Math.min(total, Number(rating || 0)));
    return Array.from({ length: total }, function (_, index) {
      return [
        '<svg class="y6rh0 xqxx6 s7mjk" fill="currentColor" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">',
        index < filledCount
          ? '<path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"></path>'
          : '<path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.461 0z"></path>',
        "</svg>",
      ].join("");
    }).join("");
  }

  function buildStoredReviewMarkup(review) {
    const headline = escapeHtml(review.headline || "Customer review");
    const body = escapeHtml(review.body || "");
    const nickname = escapeHtml(review.customer_name || review.nickname || "Guest");
    const recommendation = escapeHtml(getRecommendationLabel(review.recommendation));
    const relativeTime = escapeHtml(formatReviewRelativeTime(review.created_at || review.createdAt));
    const helpfulYes = Number(review.helpful_yes ?? review.helpfulYes ?? 0);
    const helpfulNo = Number(review.helpful_no ?? review.helpfulNo ?? 0);
    const replyMarkup =
      review.latest_reply && review.latest_reply.body
        ? [
            '<div class="ljp3z flex my9gz">',
            '<svg class="y6rh0 x215h c4t4j" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><polyline points="15 10 20 15 15 20"></polyline><path d="M4 4v7a4 4 0 0 0 4 4h12"></path></svg>',
            '<div class="t6ue9">',
            '<p class="at2zb yymkp c4t4j">You replied with</p>',
            '<blockquote class="aimp4 z65oy fsj2t yymkp f1ztf">' +
              escapeHtml(review.latest_reply.body) +
              "</blockquote>",
            "</div>",
            "</div>",
          ].join("")
        : "";

    return [
      '<div class="ggktd f3bmb e1azp apc4n y8a3d v77h5 u7zb2" data-generated-review="true">',
      '<div class="flex items-center azl7k">',
      renderProductReviewStars(review.rating),
      '<span class="s5kuw m859b f1ztf">' + recommendation + "</span>",
      "</div>",
      '<div class="ljp3z flex flex-wrap g86xu items-center oskez">',
      '<h3 class="ctc9x c4t4j">' + headline + "</h3>",
      '<p class="text-[13px] f1ztf">' + relativeTime + "</p>",
      "</div>",
      '<p class="ljp3z yymkp c4t4j">' + body + "</p>",
      '<div class="ylbo0 flex flex-wrap flex-col sm:flex-row etcpj sm:items-center osjzw">',
      '<div class="flex items-center g26qa">',
      '<h6 class="ctc9x yymkp c4t4j">' + nickname + "</h6>",
      '<span class="m859b f1ztf">•</span>',
      '<div class="inline-flex items-center jdzig">',
      '<svg class="y6rh0 x215h f1ztf" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"></path><path d="m9 12 2 2 4-4"></path></svg>',
      '<p class="m859b f1ztf">Verified customer</p>',
      "</div>",
      "</div>",
      '<div class="flex flex-wrap items-center oskez">',
      '<span class="text-[13px] f1ztf">Helpful?</span>',
      '<button class="flex items-center i220p text-[13px] f1ztf cihbd focus:outline-hidden" type="button"><svg class="y6rh0 xqxx6" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10v12"></path><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path></svg>(' + helpfulYes + ")</button>",
      '<button class="flex items-center i220p text-[13px] f1ztf cihbd focus:outline-hidden" type="button"><svg class="y6rh0 xqxx6" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M17 14V2"></path><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"></path></svg>(' + helpfulNo + ")</button>",
      '<button class="text-[13px] f1ztf carpj a8v2i cihbd focus:outline-hidden hj22m" type="button">Report</button>',
      "</div>",
      "</div>",
      replyMarkup,
      "</div>",
    ].join("");
  }

  function normalizeCartItem(item, index) {
    if (commerceStore && commerceStore.normalizeCartItem) {
      return commerceStore.normalizeCartItem(item, index);
    }
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

  function getCartItems() {
    if (commerceStore && commerceStore.getCart) {
      return commerceStore.getCart();
    }
    return readJsonStorage(cartItemsKey, []).map(function (item, index) {
      return normalizeCartItem(item, index);
    });
  }

  async function syncCartWithSupabase(items) {
    const user = await getCurrentUser();
    if (!user || !user.id) return;

    const services = await getServices();
    if (!services || !services.supabaseCartService) return;

    try {
      await services.supabaseCartService.saveCart(user.id, items);
    } catch (error) {
      console.warn("Supabase cart sync failed.", error);
    }
  }

  async function clearCartInSupabase() {
    const user = await getCurrentUser();
    if (!user || !user.id) return;

    const services = await getServices();
    if (!services || !services.supabaseCartService) return;

    try {
      await services.supabaseCartService.clearCart(user.id);
    } catch (error) {
      console.warn("Supabase cart clear failed.", error);
    }
  }

  function saveCartItems(items) {
    const normalized = commerceStore && commerceStore.setCart
      ? commerceStore.setCart(items)
      : items.map(function (item, index) {
          return normalizeCartItem(item, index);
        });

    if (!commerceStore) {
      writeJsonStorage(cartItemsKey, normalized);
      updateCartSummaries();
    }
    syncCartWithSupabase(normalized);
  }

  function getFavoriteItems() {
    if (commerceStore && commerceStore.getFavorites) {
      return commerceStore.getFavorites();
    }
    return readJsonStorage(favoritesKey, []);
  }

  function saveFavoriteItems(items) {
    if (commerceStore && commerceStore.setFavorites) {
      commerceStore.setFavorites(items);
      return;
    }

    writeJsonStorage(favoritesKey, items);
    updateFavoritesSummary();
    renderFavoritePage();
    window.dispatchEvent(new CustomEvent("storefront:favorites-updated"));
  }

  function getStoredOrders() {
    return readJsonStorage(ordersKey, []);
  }

  function sortOrdersByNewest(orders) {
    return (Array.isArray(orders) ? orders : []).slice().sort(function (left, right) {
      var leftTime = new Date(left && left.created_at || 0).getTime() || 0;
      var rightTime = new Date(right && right.created_at || 0).getTime() || 0;
      return rightTime - leftTime;
    });
  }

  function saveStoredOrders(orders) {
    writeJsonStorage(ordersKey, sortOrdersByNewest(orders));
  }

  function mergeOrdersById(existingOrders, incomingOrders) {
    var merged = new Map();

    (Array.isArray(existingOrders) ? existingOrders : []).forEach(function (order) {
      if (order && order.id) merged.set(order.id, order);
    });

    (Array.isArray(incomingOrders) ? incomingOrders : []).forEach(function (order) {
      if (!order || !order.id) return;
      var current = merged.get(order.id) || {};
      merged.set(order.id, {
        ...current,
        ...order,
      });
    });

    return sortOrdersByNewest(Array.from(merged.values()));
  }

  function buildDisplayOrderNumber() {
    return "ORD-" + Date.now().toString().slice(-8);
  }

  function ensureHeaderStyles() {
    if (document.getElementById("codex-standardized-header-styles")) return;

    const style = document.createElement("style");
    style.id = "codex-standardized-header-styles";
    style.textContent = [
      ".auth-logged-in.hidden, .auth-logged-out.hidden, .auth-avatar-image.hidden, .auth-avatar-fallback.hidden { display: none !important; }",
      "[data-storefront-hidden] { display: none !important; }",
    ].join("\n");
    document.head.appendChild(style);
  }

  function updateFavoritesSummary() {
    if (commerceStore && commerceStore.updateFavoritesSummaryUI) {
      commerceStore.updateFavoritesSummaryUI(document);
      return;
    }

    const count = getFavoriteItems().length;

    document.querySelectorAll("[data-storefront-view-favorites]").forEach(function (element) {
      element.textContent = count > 0 ? "View favorites (" + count + ")" : "View favorites";
      if (element.tagName === "A") {
        element.setAttribute("href", "./favorite.html");
      }
    });

    document.querySelectorAll("a, button, span").forEach(function (element) {
      if (element.hasAttribute("data-storefront-view-favorites")) return;
      const text = (element.textContent || "").trim();
      if (text === "View favorites" || /^View favorites \(\d+\)$/.test(text)) {
        element.textContent = count > 0 ? "View favorites (" + count + ")" : "View favorites";
        if (element.tagName === "A") {
          element.setAttribute("href", "./favorite.html");
        }
      }
    });

    const favoritesButton = document.getElementById("hs-pro-dnnd");
    const badge = favoritesButton ? favoritesButton.querySelector(".preze") : null;
    if (badge) {
      badge.childNodes[0].nodeValue = String(count);
      badge.removeAttribute("data-storefront-hidden");
    }
  }

  function normalizeCartButton() {
    const cartButton = document.querySelector('[data-hs-overlay="#hs-pro-shco"]');
    if (!cartButton) return;

    if (!cartButton.id) {
      cartButton.id = "hs-pro-cart-button";
    }

    cartButton.setAttribute("aria-haspopup", "dialog");
    cartButton.setAttribute("aria-controls", "hs-pro-shco");
    cartButton.setAttribute("aria-label", "Shopping bag");

    const badge = cartButton.querySelector(".preze");
    if (!badge) return;

    let srText = badge.querySelector(".rfrdb");
    if (!srText) {
      srText = document.createElement("span");
      srText.className = "rfrdb";
      badge.appendChild(srText);
    }
    srText.textContent = "Cart items";
  }

  function updateCartSummaries() {
    if (commerceStore && commerceStore.updateCartSummaryUI) {
      commerceStore.updateCartSummaryUI(document);
      return;
    }

    const items = getCartItems();
    const itemCount = getFallbackCartCount(items);
    const subtotal = getFallbackCartSubtotal(items);

    document.querySelectorAll('a[href="./Cart.html"], a[href="./Cart.html#"]').forEach(function (link) {
      if (/View cart/.test(link.textContent || "")) {
        link.textContent = "View cart (" + itemCount + ")";
      }
    });

    const cartHeading = document.getElementById("hs-pro-shco-label");
    if (cartHeading) {
      cartHeading.textContent = "Cart (" + itemCount + " item" + (itemCount === 1 ? "" : "s") + ")";
    }

    const cartButton = document.querySelector('[data-hs-overlay="#hs-pro-shco"]');
    const cartBadge = cartButton ? cartButton.querySelector(".preze") : null;
    if (cartBadge) {
      cartBadge.childNodes[0].nodeValue = String(itemCount);
      const srText = cartBadge.querySelector(".rfrdb");
      if (srText) srText.textContent = "Cart items";
      cartBadge.removeAttribute("data-storefront-hidden");
    }

    document.querySelectorAll(".tex4h.hfud4.osjzw").forEach(function (row) {
      const label = row.firstElementChild;
      if (!label || !/Subtotal/i.test(label.textContent || "")) return;
      const valueNode = row.querySelector(".ctc9x, .qk13w span, span");
      if (valueNode) valueNode.textContent = formatPrice(subtotal);
    });

    document.querySelectorAll(".d8kj8, .a3olr.d8kj8").forEach(function (node) {
      if (/Shipping, taxes and discounts are calculated at checkout\./.test(node.textContent || "")) {
        node.textContent = "Shipping, taxes and discounts are calculated at checkout.";
      }
    });
  }

  function seedCartFromMarkup() {
    if (getCartItems().length) return;

    const rows = Array.from(document.querySelectorAll('[id^="hs-pro-shbi"]'));
    if (!rows.length) return;

    const items = rows.map(function (row, index) {
      const title = row.querySelector("h4") ? row.querySelector("h4").textContent.trim() : "Cart item";
      const priceBlocks = Array.from(row.querySelectorAll("p, span")).map(function (node) {
        return node.textContent.trim();
      });
      const priceText = priceBlocks.find(function (text) {
        return /\$\d/.test(text);
      }) || "$0";
      const buttons = row.querySelectorAll(".d8sjl");
      const select = row.querySelector("select");
      const image = row.querySelector("img");

      return normalizeCartItem({
        id: row.id || "seed-cart-item-" + index,
        product_id: row.id || "seed-product-" + index,
        title: title,
        price: parsePrice(priceText),
        originalPrice: row.querySelector("s") ? parsePrice(row.querySelector("s").textContent) : null,
        image: image ? image.getAttribute("src") : "",
        color: buttons[0] ? buttons[0].textContent.trim() : "Default",
        size: buttons[1] ? buttons[1].textContent.trim() : "One size",
        quantity: select ? Number(select.value || 1) : 1,
        href: "./Product Detail.html",
      }, index);
    });

    saveCartItems(items);
  }

  function renderCartPage() {
    if (!isPage("Cart.html")) return;

    seedCartFromMarkup();

    const firstRow = document.querySelector('[id^="hs-pro-shbi"]');
    if (!firstRow || !firstRow.parentElement) return;

    const container = firstRow.parentElement;
    const items = getCartItems();

    if (!items.length) {
      window.location.href = "./Empty Cart.html";
      return;
    }

    container.innerHTML = items
      .map(function (item, index) {
        const quantityOptions = Array.from({ length: 10 }, function (_, index) {
          const quantity = index + 1;
          return '<option ' + (quantity === item.quantity ? 'selected=""' : "") + ">" + quantity + "</option>";
        }).join("");

        const priceMarkup = item.originalPrice
          ? '<span class="liwkv block"><span class="yymkp f1ztf"><s>' + formatPrice(item.originalPrice) + "</s></span><span class=\"yymkp gwcbr\">" + formatPrice(item.price) + "</span></span>"
          : '<p class="liwkv yymkp c4t4j">' + formatPrice(item.price) + "</p>";
        const stockMarkup = item.originalPrice
          ? '<p><span class="inline-flex items-center jdzig yymkp vd4s8"><svg class="y6rh0 xqxx6" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Low in stock</span></p>'
          : "";

        return [
          '<div class="hs-removing:opacity-0 d5ksw relative flex flex-row q3gap b2fns v60qq e1azp mjfwa y8a3d v77h5 u7zb2" data-cart-row-id="' + item.id + '" id="hs-pro-shbi' + (index + 1) + '">',
          '<div class="relative y6rh0 mvv53 kds15">',
          '<img alt="' + item.title + '" class="y6rh0 w-full fyct5 fy2yn ictpa" src="' + item.image + '"/>',
          '<div class="absolute bq7k1 m8htk nnhrf qqy1w wjvr4">',
          '<button class="ckw1y flex lp3ls items-center jdzig nj29a m859b s6i1l mak94 ijai8 k0ser disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden" data-favorite-toggle="true" data-product-id="' + item.product_id + '" data-product-title="' + item.title + '" data-product-href="' + (item.href || "./Product Detail.html") + '" data-product-image="' + item.image + '" data-product-price="' + Number(item.price || 0) + '" data-product-color="' + item.color + '" data-product-size="' + item.size + '" type="button">',
          '<svg class="y6rh0 xqxx6" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>',
          '<span class="rfrdb">Add to favorites</span>',
          "</button>",
          "</div>",
          "</div>",
          '<div class="t6ue9">',
          '<div class="a3olr sm:flex ocxlb"><div class="t6ue9"><h4 class="c4t4j">' + item.title + "</h4>" + priceMarkup + stockMarkup + "</div></div>",
          '<div class="flex flex-wrap zml5i nt9ka oskez">',
          '<div><h4 class="mpw84 yymkp f1ztf">Color</h4><button class="k85d4 o8oua d8sjl inline-flex lp3ls items-center i220p m859b edpyz s6i1l mak94 x3ljb k0ser dduyg disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden usqtq" type="button">' + item.color + "</button></div>",
          '<div><h4 class="mpw84 yymkp f1ztf">Size</h4><button class="k85d4 o8oua d8sjl inline-flex lp3ls items-center i220p m859b edpyz s6i1l mak94 x3ljb k0ser dduyg disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden usqtq" type="button">' + item.size + "</button></div>",
          '<div><h4 class="mpw84 yymkp f1ztf">Quantity</h4><select class="k85d4 b3k2r u65z8 inline-block s6i1l x3ljb edpyz m859b k0ser cursor-pointer dduyg ajd3x ajd3x jobdj usqtq disabled:opacity-50 disabled:pointer-events-none" data-cart-quantity="' + item.id + '">' + quantityOptions + "</select></div>",
          "</div>",
          '<div class="ljp3z"><button class="inline-flex items-center i220p yymkp c4t4j carpj a8v2i bz0ic focus:outline-hidden ti70c" data-cart-remove="' + item.id + '" data-hs-remove-element="#hs-pro-shbi' + (index + 1) + '" type="button">Remove</button></div>',
          "</div>",
          "</div>",
        ].join("");
      })
      .join("");

    container.querySelectorAll("[data-cart-quantity]").forEach(function (select) {
      if (select.dataset.cartQuantityBound === "true") return;
      select.dataset.cartQuantityBound = "true";
      select.addEventListener("change", function () {
        const id = select.getAttribute("data-cart-quantity");
        const items = getCartItems().map(function (item) {
          return item.id === id
            ? normalizeCartItem({ ...item, quantity: Number(select.value || 1) }, 0)
            : item;
        });
        saveCartItems(items);
        renderCartPage();
      });
    });

    container.querySelectorAll("[data-cart-remove]").forEach(function (button) {
      if (button.dataset.cartRemoveBound === "true") return;
      button.dataset.cartRemoveBound = "true";
      button.addEventListener("click", function () {
        const id = button.getAttribute("data-cart-remove");
        const nextItems = getCartItems().filter(function (item) {
          return item.id !== id;
        });
        saveCartItems(nextItems);
        if (!nextItems.length) {
          window.location.href = "./Empty Cart.html";
          return;
        }
        renderCartPage();
      });
    });

    bindFavoriteToggles(container);
    updateCartSummaries();
  }

  function extractProductContext(trigger) {
    if (commerceStore && commerceStore.extractProductContext) {
      return commerceStore.extractProductContext(trigger);
    }

    const explicitProductId = trigger.getAttribute("data-product-id");
    const explicitTitle = trigger.getAttribute("data-product-title");
    const explicitHref = trigger.getAttribute("data-product-href");
    const explicitImage = trigger.getAttribute("data-product-image");
    const explicitPrice = trigger.getAttribute("data-product-price");
    const explicitCategory = trigger.getAttribute("data-product-category");
    let root =
      trigger.closest("[data-cart-row-id]") ||
      trigger.closest("article") ||
      trigger.closest(".group") ||
      trigger.closest("section");

    let current = trigger.closest("div");
    while (!root && current && current !== document.body) {
      if (current.querySelector("h1, h2, h3, h4, h5")) {
        root = current;
        break;
      }
      current = current.parentElement;
    }

    if (!root) return null;

    const titleNode = root.querySelector("h1, h2, h3, h4, h5");
    const imageNode = root.querySelector("img");
    const select = root.querySelector("select");
    const buttons = root.querySelectorAll(".d8sjl");
    const fallbackPriceNode = Array.from(root.querySelectorAll("span, p")).find(function (node) {
      return /\$\d/.test(node.textContent || "");
    });

    const title = explicitTitle || (titleNode ? titleNode.textContent.trim() : "Product");
    const hrefNode = root.querySelector('a[href*="Product"]') || document.querySelector('link[rel="canonical"]');
    const href = explicitHref || (hrefNode ? (hrefNode.getAttribute("href") || "./Product Detail.html") : "./Product Detail.html");
    const color = buttons[0] ? buttons[0].textContent.trim() : "Default";
    const size = explicitCategory || (buttons[1] ? buttons[1].textContent.trim() : "One size");
    const quantity = select ? Number(select.value || 1) : 1;
    const price = explicitPrice ? parsePrice(explicitPrice) : (fallbackPriceNode ? parsePrice(fallbackPriceNode.textContent) : 0);
    const image = explicitImage || (imageNode ? imageNode.getAttribute("src") : "");
    const productId = explicitProductId || (href || title).replace(/\s+/g, "-").toLowerCase();

    return normalizeCartItem({
      id: productId,
      product_id: productId,
      title: title,
      href: href,
      color: color,
      size: size,
      quantity: quantity,
      price: price,
      image: image,
    }, 0);
  }

  function bindAddToCartButtons(root) {
    if (commerceStore && commerceStore.hydrateProductDataAttributes) {
      commerceStore.hydrateProductDataAttributes(root || document);
    }

    if (commerceStore && commerceStore.bindAddToCartButtons) {
      commerceStore.bindAddToCartButtons(root || document, {
        onAfterAdd: function (_, nextCart) {
          syncCartWithSupabase(nextCart);
        },
      });
      return;
    }
  }

  function bindFavoriteToggles(root) {
    if (commerceStore && commerceStore.hydrateProductDataAttributes) {
      commerceStore.hydrateProductDataAttributes(root || document);
    }

    if (commerceStore && commerceStore.bindFavoriteToggles) {
      commerceStore.bindFavoriteToggles(root || document);
      return;
    }
  }

  async function submitNewsletter(email) {
    const subscribers = readJsonStorage(newsletterKey, []);
    if (!subscribers.includes(email)) {
      subscribers.push(email);
      writeJsonStorage(newsletterKey, subscribers);
    }

    const supabase = await getSupabaseClient();
    if (!supabase) return;

    try {
      await supabase.from("newsletter_subscribers").upsert([{ email: email }], {
        onConflict: "email",
      });
    } catch (error) {
      console.warn("Newsletter Supabase save failed; local storage kept.", error);
    }
  }

  function bindNewsletterForm(root) {
    const scope = root || document;
    const input = scope.querySelector("#hs-pro-shfsei");
    const button = input ? input.parentElement.querySelector('button[type="button"]') : null;
    if (!input || !button || button.dataset.newsletterBound === "true") return;

    button.dataset.newsletterBound = "true";
    button.addEventListener("click", async function () {
      const email = (input.value || "").trim().toLowerCase();
      const container = input.closest(".b70oy");

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMessage(container, "data-newsletter-message", "Enter a valid email address.", "error");
        return;
      }

      await submitNewsletter(email);
      input.value = "";
      showMessage(container, "data-newsletter-message", "You are subscribed for updates.", "success");
    });
  }

  function seedFavoritesFromMarkup() {
    if (!isPage("favorite.html") || getFavoriteItems().length) return;

    const cards = Array.from(document.querySelectorAll('[id^="hs-pro-shpcr"]'));
    if (!cards.length) return;

    const favorites = cards.map(function (card, index) {
      const titleNode = card.querySelector(".z3wmw .block, h3, h4");
      const hrefNode = card.querySelector('a[href*="Product"], a[href*="product"]');
      const imageNode = card.querySelector("img");
      const priceNode = Array.from(card.querySelectorAll("span, p")).find(function (node) {
        return /\$\d/.test(node.textContent || "");
      });
      const categoryNode = card.querySelector(".vbvcb");
      const title = titleNode ? titleNode.textContent.trim() : "Favorite item";
      const href = hrefNode ? (hrefNode.getAttribute("href") || "./Product Detail.html") : "./Product Detail.html";
      const image = imageNode ? imageNode.getAttribute("src") || "" : "";

      return {
        id: "favorite-seed-" + index,
        title: title,
        href: href,
        image: image,
        price: priceNode ? parsePrice(priceNode.textContent) : 0,
        category: categoryNode ? categoryNode.textContent.trim() : "",
      };
    });

    writeJsonStorage(favoritesKey, favorites);
  }

  function renderFavoritesDropdown() {
    const container = document.querySelector('[aria-labelledby="hs-pro-dnnd"] .pf6kx.afsci .space-y-5');
    if (!container) return;

    const favorites = getFavoriteItems();
    if (!favorites.length) {
      container.innerHTML = '<p class="m859b f1ztf">No favorites saved yet.</p>';
      return;
    }

    container.innerHTML = favorites
      .map(function (item, index) {
        const price = Number(item.price || 0);
        const priceMarkup = price
          ? '<span class="j9itz yymkp c4t4j">' + formatPrice(price) + "</span>"
          : "";

        return [
          '<div class="hs-removing:opacity-0 d5ksw flex haw2c" data-favorite-dropdown-row="' + item.id + '" id="hs-pro-shfdi-live-' + index + '">',
          '<div class="relative">',
          '<img alt="' + item.title + '" class="y6rh0 cr96u aruvj fy2yn edpyz" src="' + (item.image || "") + '"/>',
          "</div>",
          '<div class="t6ue9 flex flex-col">',
          '<h4 class="yymkp c4t4j">' + item.title + "</h4>",
          priceMarkup,
          '<div class=""><button class="inline-flex items-center i220p text-[13px] c4t4j carpj a8v2i bz0ic focus:outline-hidden ti70c" data-favorite-remove="' + item.id + '" type="button">Remove</button></div>',
          "</div>",
          "</div>",
        ].join("");
      })
      .join("");

    container.querySelectorAll("[data-favorite-remove]").forEach(function (button) {
      if (button.dataset.favoriteRemoveBound === "true") return;
      button.dataset.favoriteRemoveBound = "true";
      button.addEventListener("click", function () {
        const id = button.getAttribute("data-favorite-remove");
        const nextFavorites = getFavoriteItems().filter(function (item) {
          return item.id !== id;
        });
        saveFavoriteItems(nextFavorites);
      });
    });
  }

  function renderCartOverlayItems() {
    const container = document.querySelector("#hs-pro-shco .uilco.space-y-7");
    if (!container) return;

    const items = getCartItems();
    if (!items.length) {
      container.innerHTML = '<p class="m859b f1ztf">Your cart is empty.</p>';
      return;
    }

    container.innerHTML = items
      .map(function (item, index) {
        const priceMarkup = item.originalPrice
          ? '<span class="j9itz"><span class="yymkp f1ztf"><s>' + formatPrice(item.originalPrice) + '</s></span><span class="yymkp pnjtm">' + formatPrice(item.price) + "</span></span>"
          : '<span class="j9itz yymkp c4t4j">' + formatPrice(item.price) + "</span>";

        return [
          '<div class="hs-removing:opacity-0 d5ksw flex haw2c" data-cart-overlay-row="' + item.id + '" id="hs-pro-shcopci-live-' + index + '">',
          '<div class="relative">',
          '<img alt="' + item.title + '" class="y6rh0 cr96u aruvj fy2yn edpyz" src="' + (item.image || "") + '"/>',
          '<div class="absolute bq7k1 m8htk nnhrf o3j93 rai17">',
          '<button type="button" class="optiv flex lp3ls items-center jdzig nj29a m859b s6i1l mak94 ijai8 k0ser jtgqa disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden iv6j9" data-favorite-toggle="true" data-product-id="' + item.product_id + '" data-product-title="' + item.title + '" data-product-href="' + (item.href || "./Product Detail.html") + '" data-product-image="' + (item.image || "") + '" data-product-price="' + Number(item.price || 0) + '" data-product-color="' + (item.color || "Default") + '" data-product-size="' + (item.size || "One size") + '">',
          '<svg class="y6rh0 qpvtc" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>',
          '<span class="rfrdb">Add to favorites</span>',
          "</button>",
          "</div>",
          "</div>",
          '<div class="t6ue9 flex flex-col">',
          '<h4 class="yymkp c4t4j">' + item.title + "</h4>",
          '<ul class="j9itz space-y-1"><li class="m859b f1ztf">Color: ' + (item.color || "Default") + '</li><li class="m859b f1ztf">Size: ' + (item.size || "One size") + "</li></ul>",
          '<p class="j9itz m859b f1ztf"><span>Qty:</span><span>' + Number(item.quantity || 1) + "</span></p>",
          priceMarkup,
          '<div class=""><button type="button" class="inline-flex items-center i220p text-[13px] c4t4j carpj a8v2i bz0ic focus:outline-hidden ti70c" data-cart-overlay-remove="' + item.id + '">Remove</button></div>',
          "</div>",
          "</div>",
        ].join("");
      })
      .join("");

    container.querySelectorAll("[data-cart-overlay-remove]").forEach(function (button) {
      if (button.dataset.cartOverlayRemoveBound === "true") return;
      button.dataset.cartOverlayRemoveBound = "true";
      button.addEventListener("click", function () {
        const id = button.getAttribute("data-cart-overlay-remove");
        const nextItems = getCartItems().filter(function (item) {
          return item.id !== id;
        });
        saveCartItems(nextItems);
      });
    });

    bindFavoriteToggles(container);
  }

  function renderCheckoutCartItems() {
    if (!isPage("Checkout.html") && !isPage("Review and Pay.html") && !isPage("review-pay.html")) return;

    const container = document.querySelector("[data-checkout-cart-items]");
    if (!container) return;

    const items = getCartItems();
    if (!items.length) {
      container.innerHTML = '<p class="m859b f1ztf">Your cart is empty.</p>';
      return;
    }

    container.innerHTML = items
      .map(function (item) {
        const priceMarkup = item.originalPrice
          ? '<span class="j9itz"><span class="yymkp f1ztf"><s>' + formatPrice(item.originalPrice) + '</s></span><span class="yymkp pnjtm">' + formatPrice(item.price) + "</span></span>"
          : '<span class="j9itz yymkp c4t4j">' + formatPrice(item.price) + "</span>";

        return [
          '<div class="flex haw2c" data-checkout-cart-row="' + item.id + '">',
          '<div class="relative">',
          '<img alt="' + item.title + '" class="y6rh0 cr96u aruvj fy2yn edpyz" src="' + (item.image || "") + '"/>',
          "</div>",
          '<div class="t6ue9 flex flex-col">',
          '<h4 class="yymkp c4t4j">' + item.title + "</h4>",
          '<ul class="j9itz space-y-1"><li class="m859b f1ztf">Color: ' + (item.color || "Default") + '</li><li class="m859b f1ztf">Size: ' + (item.size || "One size") + "</li></ul>",
          '<p class="j9itz m859b f1ztf"><span>Qty:</span><span>' + Number(item.quantity || 1) + "</span></p>",
          priceMarkup,
          "</div>",
          "</div>",
        ].join("");
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderRecommendationReview(reviewCount) {
    const count = Number(reviewCount || 0);
    const stars = Array.from({ length: 5 }, function (_, index) {
      const filled = index < (count > 0 ? 4 : 0);
      const path = filled
        ? '<path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"></path>'
        : '<path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.461 0z"></path>';

      return [
        '<svg class="y6rh0 qpvtc c4t4j" fill="currentColor" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">',
        path,
        "</svg>",
      ].join("");
    }).join("");

    return '<div class="ljp3z flex items-center azl7k">' + stars + '<span class="duiq5 m859b c4t4j">(' + count + ")</span></div>";
  }

  function buildSanityRecommendationCard(product, index) {
    const title = escapeHtml(product && product.title ? product.title : "Product");
    const slug = product && product.slug && product.slug.current ? product.slug.current : "";
    const href = slug ? "./Product Detail.html?slug=" + encodeURIComponent(slug) : "./Product Detail.html";
    const image = escapeHtml(
      product && product.image && product.image.asset && product.image.asset.url
        ? product.image.asset.url
        : product && product.images && product.images[0] && product.images[0].asset && product.images[0].asset.url
          ? product.images[0].asset.url
          : "",
    );
    const categoryTitle = escapeHtml(
      product && product.category && product.category.title
        ? product.category.title
        : "Product",
    );
    const price = typeof (product && product.price) === "number"
      ? formatPrice(product.price)
      : "$0";
    const originalPrice = typeof (product && product.originalPrice) === "number"
      ? formatPrice(product.originalPrice)
      : "";
    const hasBadge = index < 2;
    const priceMarkup = originalPrice
      ? '<p class="liwkv yymkp"><span class="yymkp f1ztf"><s>' + originalPrice + '</s></span><span class="yymkp gwcbr">' + price + "</span></p>"
      : '<p class="liwkv at2zb yymkp c4t4j">' + price + "</p>";

    return [
      '<div class="group relative" data-product-id="' + escapeHtml(product && product._id ? product._id : "product-" + index) + '" data-product-title="' + title + '" data-product-href="' + escapeHtml(href) + '" data-product-image="' + image + '" data-product-price="' + Number(product && product.price ? product.price : 0) + '" data-product-category="' + categoryTitle + '">',
      '<div class="relative">',
      '<a class="block ictpa focus:outline-hidden" href="' + escapeHtml(href) + '">',
      '<img alt="' + title + '" class="ictpa" src="' + image + '"/>',
      "</a>",
      '<div class="absolute bq7k1 m8htk nnhrf qqy1w wjvr4">',
      '<button class="ckw1y flex lp3ls items-center jdzig nj29a m859b s6i1l k0ser disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden" data-favorite-toggle="true" type="button">',
      '<svg class="y6rh0 xqxx6" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>',
      '<span class="rfrdb">Add to favorites</span>',
      "</button>",
      "</div>",
      hasBadge
        ? '<div class="absolute bq7k1 i1rbz qqy1w b3k2r rlfos"><div class="flex flex-col tuxfz"><p><span class="dg39k u5noc wjvr4 s6i1l at2zb m859b k0ser nj29a cirj5">Trending</span></p></div></div>'
        : "",
      "</div>",
      '<a class="after:z-1 after:absolute after:inset-0" href="' + escapeHtml(href) + '"></a>',
      '<div class="z3wmw">',
      '<span class="block yymkp k80uv c4t4j">' + title + "</span>",
      '<p class="vbvcb yymkp f1ztf">' + categoryTitle + "</p>",
      priceMarkup,
      renderRecommendationReview(0),
      "</div>",
      "</div>",
    ].join("");
  }

  function getSlugValue(slug) {
    if (!slug) return "";
    return typeof slug === "string" ? slug : slug.current || "";
  }

  function getCategoryTitle(category) {
    if (!category) return "";
    return typeof category === "string" ? category : category.title || "";
  }

  function getProductImageUrl(product) {
    if (!product) return "";
    if (product.image && product.image.asset && product.image.asset.url) return product.image.asset.url;
    if (Array.isArray(product.images) && product.images[0] && product.images[0].asset && product.images[0].asset.url) {
      return product.images[0].asset.url;
    }
    const imageNode = document.querySelector("[data-product-image] img, main img");
    return imageNode ? imageNode.getAttribute("src") || "" : "";
  }

  function sanitizeDomId(value) {
    return String(value || "option").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "option";
  }

  function decodeDisplayVariantsChannel(channel) {
    if (!String(channel || "").startsWith(displayVariantsChannelPrefix)) return null;

    try {
      const value = String(channel).slice(displayVariantsChannelPrefix.length);
      const parsed = JSON.parse(decodeURIComponent(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function decodeDisplayMetaChannel(channel) {
    if (!String(channel || "").startsWith(displayMetaChannelPrefix)) return null;

    try {
      const value = String(channel).slice(displayMetaChannelPrefix.length);
      const parsed = JSON.parse(decodeURIComponent(value));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function normalizeRuntimeDisplayEdit(row) {
    if (!row) return null;

    const channels = Array.isArray(row.channels) ? row.channels : [];
    const tags = [];
    let meta = null;
    let variants = Array.isArray(row.display_variants)
      ? row.display_variants
      : Array.isArray(row.variants)
        ? row.variants
        : [];

    channels.forEach(function (channel) {
      const decodedMeta = decodeDisplayMetaChannel(channel);
      if (decodedMeta) {
        meta = decodedMeta;
        return;
      }
      const decoded = decodeDisplayVariantsChannel(channel);
      if (decoded) {
        variants = decoded;
        return;
      }
      if (channel) tags.push(String(channel));
    });
    variants = normalizeDetailVariantRows(variants);
    const variantStock = getDetailVariantStock(variants);
    const stock = variants.length ? variantStock : Math.max(0, Number(row.stock ?? row.inventory ?? 0) || 0);

    return {
      category: row.display_category || (meta && meta.category) || "",
      isAvailable:
        variants.length
          ? variantStock > 0
          : row.is_available === undefined || row.is_available === null
            ? row.status !== "unpublish"
            : Boolean(row.is_available),
      tags: tags,
      variants: variants,
      stock: stock,
    };
  }

  function normalizeDetailVariantRows(variants) {
    return (Array.isArray(variants) ? variants : []).map(function (variant) {
      const options = variant.options || {};
      return {
        size: String(variant.size || options.size || variant.title || "").trim(),
        color: String(variant.color || options.color || "").trim(),
        quantity: Math.max(0, Number(variant.quantity ?? variant.stock ?? variant.inventory ?? 0) || 0),
      };
    }).filter(function (variant) {
      return variant.size && variant.color;
    });
  }

  function getDetailVariantStock(variants) {
    return normalizeDetailVariantRows(variants).reduce(function (sum, variant) {
      return sum + Number(variant.quantity || 0);
    }, 0);
  }

  async function fetchProductDisplayEdit(product, slug) {
    const supabase = await getSupabaseClient();
    if (!supabase) return null;

    const keys = [
      slug,
      product && product._id,
      product && getSlugValue(product.slug),
      product && product.sku,
    ].filter(Boolean).map(String).filter(function (value, index, array) {
      return array.indexOf(value) === index;
    });

    const columns = ["slug", "sanity_product_id", "product_id", "sku"];
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const column = columns[columnIndex];
        try {
          const result = await supabase
            .from(productRuntimeTable)
            .select("*")
            .eq(column, key)
            .limit(1);
          const row = result && Array.isArray(result.data) ? result.data[0] : null;
          if (row) return normalizeRuntimeDisplayEdit(row);
        } catch (error) {
          console.warn("Unable to load product runtime display controls.", error);
          return null;
        }
      }
    }

    return null;
  }

  function normalizeDetailVariants(product, edit) {
    const editVariants = edit && Array.isArray(edit.variants) ? edit.variants : [];
    if (editVariants.length) {
      return normalizeDetailVariantRows(editVariants);
    }

    const productVariants = product && Array.isArray(product.variants) ? product.variants : [];
    if (productVariants.length) {
      return normalizeDetailVariantRows(productVariants);
    }

    return [];
  }

  function findProductDetailSection(root, label) {
    return Array.from(root.querySelectorAll("h2")).find(function (heading) {
      return heading.textContent.trim().toLowerCase() === label.toLowerCase();
    })?.closest(".fkl1d, .lxjcs") || null;
  }

  function uniqueValues(values) {
    return values.filter(Boolean).filter(function (value, index, array) {
      return array.indexOf(value) === index;
    });
  }

  function getStockLabel(stock, isAvailable) {
    if (!isAvailable || stock <= 0) return "Out of stock";
    if (stock <= 5) return "Low in stock";
    return "In stock";
  }

  function renderDetailColorOptions(root, variants) {
    const colorSection = findProductDetailSection(root, "Color");
    if (!colorSection) return;

    const colors = uniqueValues(variants.map(function (variant) {
      return variant.color || "Default";
    }));
    const grid = colorSection.querySelector(".vbvcb.flex.flex-wrap.oskez");
    const label = colorSection.querySelector("p.vbvcb");
    if (!grid || !colors.length) return;

    grid.innerHTML = colors.map(function (color, index) {
      const id = "hs-pro-shgctn-" + sanitizeDomId(color);
      return [
        '<label class="mxukx y9dku flex flex-col lp3ls items-center rm4xc bax7d bo7jm pfp05 tnfy3 wtype cursor-pointer" for="' + id + '">',
        '<input class="hidden" id="' + id + '" name="hs-pro-shgctn" type="radio" value="' + escapeHtml(color) + '"' + (index === 0 ? " checked" : "") + '>',
        '<span class="mxukx kyzhn y9dku" style="background-color: ' + escapeHtml(color) + ';"></span>',
        "</label>",
      ].join("");
    }).join("");

    if (label) label.textContent = colors[0];
  }

  function renderDetailSizeOptions(root, variants, selectedColor, selectedSize) {
    const sizeSection = findProductDetailSection(root, "Size");
    if (!sizeSection) return;

    const grid = sizeSection.querySelector(".vbvcb.tex4h");
    if (!grid) return;

    const sizes = uniqueValues(variants
      .filter(function (variant) {
        return !selectedColor || variant.color === selectedColor;
      })
      .map(function (variant) {
        return variant.size || "One size";
      }));

    if (!sizes.length) {
      sizeSection.style.display = "none";
      return;
    }

    sizeSection.style.display = "";
    const checkedSize = sizes.includes(selectedSize) ? selectedSize : sizes[0];
    grid.innerHTML = sizes.map(function (size) {
      const matchingQuantity = variants
        .filter(function (variant) {
          return variant.size === size && (!selectedColor || variant.color === selectedColor);
        })
        .reduce(function (sum, variant) {
          return sum + Number(variant.quantity || 0);
        }, 0);
      const id = "hs-pro-shfdsr-" + sanitizeDomId(size);
      return [
        '<label class="n0kov group relative flex lp3ls items-center h7z6o rm4xc m859b mak94 x3ljb k0ser cursor-pointer edpyz h8ubl bax7d vo967 wtype has-disabled:pointer-events-none has-disabled:opacity-70 has-disabled:text-line-2 has-disabled:after:absolute has-disabled:after:inset-0 has-disabled:after:bg-[linear-gradient(to_right_bottom,transparent_calc(50%-1px),var(--color-line-2)_calc(50%-1px),var(--color-line-2)_50%,transparent_50%)]" for="' + id + '">',
        '<input class="hidden" id="' + id + '" name="hs-pro-shfdsr" type="radio" value="' + escapeHtml(size) + '"' + (size === checkedSize ? " checked" : "") + (matchingQuantity <= 0 ? " disabled" : "") + '>',
        '<span class="block">' + escapeHtml(size) + "</span>",
        "</label>",
      ].join("");
    }).join("");
  }

  function updateDetailPurchaseState(root, variants, isAvailable) {
    const selectedColor = root.querySelector('input[name="hs-pro-shgctn"]:checked')?.value || "";
    const previousSize = root.querySelector('input[name="hs-pro-shfdsr"]:checked')?.value || "";
    const colorLabel = findProductDetailSection(root, "Color")?.querySelector("p.vbvcb");
    if (colorLabel && selectedColor) colorLabel.textContent = selectedColor;

    renderDetailSizeOptions(root, variants, selectedColor, previousSize);

    const selectedSize = root.querySelector('input[name="hs-pro-shfdsr"]:checked')?.value || "";
    const stock = variants
      .filter(function (variant) {
        return (!selectedColor || variant.color === selectedColor) && (!selectedSize || variant.size === selectedSize);
      })
      .reduce(function (sum, variant) {
        return sum + Number(variant.quantity || 0);
      }, 0);
    const visibleStock = variants.length ? stock : Number(root.dataset.productStock || 0);
    const canBuy = Boolean(isAvailable) && visibleStock > 0;
    const stockLabel = getStockLabel(visibleStock, canBuy);
    const stockNode = Array.from(root.querySelectorAll(".vbvcb span.inline-flex")).find(function (node) {
      return /stock/i.test(node.textContent || "");
    });
    const addToCart = document.getElementById("product-detail-add-to-cart");
    const quantitySelect = addToCart?.closest(".ycllq")?.querySelector("select") || null;

    if (stockNode) {
      stockNode.innerHTML = '<svg class="y6rh0 qpvtc" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' + stockLabel + (visibleStock > 0 ? " (" + visibleStock + ")" : "");
    }

    if (quantitySelect) {
      const maxQuantity = Math.min(Math.max(visibleStock, 0), 10);
      quantitySelect.innerHTML = Array.from({ length: Math.max(maxQuantity, 1) }, function (_, index) {
        const value = index + 1;
        return '<option' + (value === 1 ? " selected" : "") + ">" + value + "</option>";
      }).join("");
      quantitySelect.disabled = !canBuy;
    }

    if (addToCart) {
      addToCart.disabled = !canBuy;
      addToCart.textContent = canBuy ? "Add to cart" : "Unavailable";
      addToCart.dataset.productColor = selectedColor || "Default";
      addToCart.dataset.productSize = selectedSize || "One size";
      addToCart.dataset.productQuantity = quantitySelect ? String(quantitySelect.value || 1) : "1";
    }
  }

  async function renderProductDetailDisplayControls() {
    if (!isPage("Product Detail.html")) return;

    const root = document.querySelector(".sx5qw");
    if (!root) return;

    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug") || params.get("product") || "";
    let product = null;

    try {
      const sanityModule = await import("@siggistore/services/storefront/sanity-service");
      if (slug && sanityModule.default && typeof sanityModule.default.getProductBySlug === "function") {
        product = await sanityModule.default.getProductBySlug(slug);
      }
    } catch (error) {
      console.warn("Unable to load product detail from Sanity.", error);
    }

    const edit = await fetchProductDisplayEdit(product, slug);
    const title = (edit && edit.title) || (product && product.title) || document.getElementById("product-detail-title")?.textContent.trim() || "Product";
    const category = (edit && edit.category) || getCategoryTitle(product && product.category) || document.getElementById("product-detail-category")?.textContent.trim() || "Product";
    const price = product && typeof product.price === "number" ? product.price : parsePrice(document.getElementById("product-detail-price")?.textContent || 0);
    const variants = normalizeDetailVariants(product, edit);
    const stock = variants.length
      ? getDetailVariantStock(variants)
      : edit && typeof edit.stock === "number"
        ? edit.stock
        : Math.max(0, Number(product && product.stock ? product.stock : 0) || 0);
    const isAvailable = stock > 0 && (edit && typeof edit.isAvailable === "boolean"
      ? edit.isAvailable
      : product
        ? product.isAvailable !== false && product.status !== "unpublish"
        : true);
    const href = slug ? "./Product Detail.html?slug=" + encodeURIComponent(slug) : "./Product Detail.html";
    const image = getProductImageUrl(product);

    const titleNode = document.getElementById("product-detail-title");
    const categoryNode = document.getElementById("product-detail-category");
    const priceNode = document.getElementById("product-detail-price");
    const addToCart = document.getElementById("product-detail-add-to-cart");
    const favorite = document.getElementById("product-detail-favorite");

    if (titleNode) titleNode.textContent = title;
    if (categoryNode) categoryNode.textContent = category;
    if (priceNode) priceNode.textContent = formatPrice(price);

    root.dataset.productId = (product && product._id) || slug || title;
    root.dataset.productTitle = title;
    root.dataset.productHref = href;
    root.dataset.productImage = image;
    root.dataset.productPrice = String(price || 0);
    root.dataset.productCategory = category;
    root.dataset.productStock = String(stock || 0);

    if (addToCart) {
      addToCart.dataset.productId = root.dataset.productId;
      addToCart.dataset.productTitle = title;
      addToCart.dataset.productHref = href;
      addToCart.dataset.productImage = image;
      addToCart.dataset.productPrice = String(price || 0);
      addToCart.dataset.productCategory = category;
    }

    if (favorite) {
      favorite.dataset.favoriteToggle = "true";
      favorite.dataset.productId = root.dataset.productId;
      favorite.dataset.productTitle = title;
      favorite.dataset.productHref = href;
      favorite.dataset.productImage = image;
      favorite.dataset.productPrice = String(price || 0);
      favorite.dataset.productCategory = category;
    }

    if (variants.length) {
      renderDetailColorOptions(root, variants);
      renderDetailSizeOptions(root, variants, root.querySelector('input[name="hs-pro-shgctn"]:checked')?.value || "");
    }

    if (root.dataset.displayControlsListenerBound !== "true") {
      root.dataset.displayControlsListenerBound = "true";
      root.addEventListener("change", function (event) {
        const currentVariants = root.__productDetailVariants || [];
        const currentIsAvailable = root.__productDetailIsAvailable !== false;
        const currentAddToCart = document.getElementById("product-detail-add-to-cart");

        if (event.target.matches('input[name="hs-pro-shgctn"], input[name="hs-pro-shfdsr"]')) {
          updateDetailPurchaseState(root, currentVariants, currentIsAvailable);
          bindAddToCartButtons(root);
        }
        if (event.target.tagName === "SELECT" && currentAddToCart) {
          currentAddToCart.dataset.productQuantity = String(event.target.value || 1);
        }
      });
    }

    root.__productDetailVariants = variants;
    root.__productDetailIsAvailable = isAvailable;
    updateDetailPurchaseState(root, variants, isAvailable);
    bindFavoriteToggles(root);
    bindAddToCartButtons(root);
    root.dataset.displayControlsRendered = "true";
  }

  async function renderSanityProductCarousel() {
    if (!isPage("Cart.html")) return;

    const carousel = document.querySelector('[data-sanity-product-carousel="cart-recommendations"]');
    if (!carousel || carousel.dataset.sanityRendered === "true") return;

    const slides = Array.from(carousel.querySelectorAll(".hs-carousel-slide"));
    if (!slides.length) return;

    try {
      const sanityModule = await import("@siggistore/services/storefront/sanity-service");
      const sanityProducts = await sanityModule.default.getProducts(slides.length, 0);
      if (!Array.isArray(sanityProducts) || !sanityProducts.length) return;

      slides.forEach(function (slide, index) {
        const product = sanityProducts[index];
        if (!product) {
          slide.setAttribute("data-storefront-hidden", "true");
          return;
        }

        slide.removeAttribute("data-storefront-hidden");
        slide.innerHTML = buildSanityRecommendationCard(product, index);
      });

      carousel.dataset.sanityRendered = "true";
      bindFavoriteToggles(carousel);
      bindAddToCartButtons(carousel);
      window.HSStaticMethods && typeof window.HSStaticMethods.autoInit === "function" && window.HSStaticMethods.autoInit();
    } catch (error) {
      console.warn("Unable to load cart recommendations from Sanity.", error);
    }
  }

  function renderFavoritePage() {
    if (!isPage("favorite.html")) return;

    seedFavoritesFromMarkup();

    const grid = document.querySelector(".tex4h.hfud4.rn6hf.h7z6o.w0vti");
    if (!grid) return;

    const favorites = getFavoriteItems();
    const intro = grid.previousElementSibling && grid.previousElementSibling.querySelector("p")
      ? grid.previousElementSibling.querySelector("p")
      : document.querySelector("main p.ljp3z.yymkp.f1ztf");

    if (intro) {
      intro.style.display = favorites.length ? "none" : "";
    }

    if (!favorites.length) {
      grid.innerHTML = [
        '<div class="col-span-full rounded-2xl border border-slate-200 p-8 text-center">',
        '<h2 class="at2zb taweu nhzx2 c4t4j">No favorites saved yet</h2>',
        '<p class="ljp3z yymkp f1ztf">Browse products and tap the heart icon to save items here.</p>',
        '<a class="dvh79 cti9j inline-flex lp3ls items-center my9gz yymkp at2zb edpyz pm6ks mak94 ve4ck bni17 pucrg focus:outline-hidden soa63" href="./Product Listing.html" data-storefront-browse-products="true">Browse products</a>',
        "</div>",
      ].join("");

      const browseProductsLink = grid.querySelector("[data-storefront-browse-products]");
      if (browseProductsLink && browseProductsLink.dataset.browseBound !== "true") {
        browseProductsLink.dataset.browseBound = "true";
        browseProductsLink.addEventListener("click", function (event) {
          event.preventDefault();
          window.location.href = "./Product Listing.html";
        });
      }
      return;
    }

    grid.innerHTML = favorites.map(function (item, index) {
      const category = item.category || "Saved item";
      const price = Number(item.price || 0);
      const priceMarkup = price
        ? '<p class="liwkv yymkp"><span class="yymkp gwcbr">' + formatPrice(price) + "</span></p>"
        : "";

      return [
        '<div id="favorite-item-' + index + '" class="hs-removing:opacity-0 d5ksw group relative">',
        '<div class="relative">',
        '<a class="block ictpa focus:outline-hidden" href="' + (item.href || "./Product Detail.html") + '">',
        '<img class="ictpa" src="' + (item.image || "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=560&h=780&auto=format&fit=crop&ixlib=rb-4.0.3") + '" alt="' + item.title + '">',
        "</a>",
        '<div class="absolute bq7k1 m8htk nnhrf qqy1w wjvr4">',
        '<button type="button" class="ckw1y flex lp3ls items-center jdzig nj29a m859b s6i1l k0ser disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden" data-favorite-toggle="true" data-product-id="' + item.id + '" data-product-title="' + item.title + '" data-product-href="' + (item.href || "./Product Detail.html") + '" data-product-image="' + (item.image || "") + '" data-product-price="' + price + '" data-product-category="' + category + '">',
        '<svg class="y6rh0 xqxx6" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>',
        "</svg>",
        '<span class="rfrdb">Add to favorites</span>',
        "</button>",
        "</div>",
        "</div>",
        '<div class="z3wmw relative z-10">',
        '<span class="block yymkp k80uv c4t4j">' + item.title + "</span>",
        '<p class="vbvcb yymkp f1ztf">' + category + "</p>",
        priceMarkup,
        '<div class="ljp3z flex items-center azl7k">',
        '<button type="button" class="dvh79 cti9j relative z-20 inline-flex lp3ls items-center my9gz yymkp at2zb edpyz pm6ks mak94 ve4ck bni17 pucrg disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden soa63" data-product-id="' + item.id + '" data-product-title="' + item.title + '" data-product-href="' + (item.href || "./Product Detail.html") + '" data-product-image="' + (item.image || "") + '" data-product-price="' + price + '" data-product-category="' + category + '">Add to cart</button>',
        "</div>",
        "</div>",
        "</div>",
      ].join("");
    }).join("");

    bindFavoriteToggles(grid);
    bindAddToCartButtons(grid);
  }

  function hydrateCheckoutForm() {
    const draft = readJsonStorage(checkoutDraftKey, null);
    if (!draft) return;

    const mappings = {
      hs_pro_shchfem: draft.email,
      hs_pro_shchfn: draft.fullName,
      hs_pro_shchfad1: draft.address1,
      hs_pro_shchfad2: draft.address2,
      hs_pro_shchfct: draft.city,
      hs_pro_shchfzc: draft.zipCode,
      hs_pro_shchfph: draft.phone,
    };

    Object.keys(mappings).forEach(function (key) {
      const input = document.getElementById(key.replace(/_/g, "-"));
      if (input && mappings[key]) input.value = mappings[key];
    });

    const newsCheckbox = document.getElementById("hs-pro-shchfen");
    if (newsCheckbox) newsCheckbox.checked = Boolean(draft.marketingOptIn);

    const shippingMethodInput = document.getElementById(draft.shippingMethod || "hs-pro-esdo1");
    if (shippingMethodInput) shippingMethodInput.checked = true;
  }

  function collectCheckoutDraft() {
    const countrySelect = document.querySelector('[data-hs-select] select');
    const shippingMethod = document.querySelector('input[name="hs-pro-esdo"]:checked');
    const selectedShippingMethodId = shippingMethod ? shippingMethod.id : "";
    const email = document.getElementById("hs-pro-shchfem");
    const fullName = document.getElementById("hs-pro-shchfn");
    const address1 = document.getElementById("hs-pro-shchfad1");
    const address2 = document.getElementById("hs-pro-shchfad2");
    const city = document.getElementById("hs-pro-shchfct");
    const state = document.getElementById("hs-pro-shchfst");
    const zipCode = document.getElementById("hs-pro-shchfzc");
    const phone = document.getElementById("hs-pro-shchfph");
    const marketingOptIn = document.getElementById("hs-pro-shchfen");
    const saveAddress = document.getElementById("hs-pro-shchstach");
    const promoCode = document.getElementById("hs-pro-shchsetcpc");
    const cartItems = getCartItems();
    const subtotal = cartItems.reduce(function (sum, item) {
      return sum + Number(item.price || 0) * Number(item.quantity || 0);
    }, 0);
    const shippingAmount = getShippingAmount(selectedShippingMethodId || "hs-pro-esdo1");
    const estimatedTax = 0;
    const saleDiscount = getSaleDiscount(cartItems);
    const promoCodeValue = promoCode ? promoCode.value.trim() : "";
    const promoDiscount = calculatePromoDiscount(promoCodeValue, subtotal);
    const total = Math.max(0, subtotal + shippingAmount + estimatedTax - promoDiscount);

    return {
      email: email ? email.value.trim() : "",
      fullName: fullName ? fullName.value.trim() : "",
      country: countrySelect ? countrySelect.options[countrySelect.selectedIndex].textContent.trim() : "",
      address1: address1 ? address1.value.trim() : "",
      address2: address2 ? address2.value.trim() : "",
      city: city ? city.value.trim() : "",
      state: state ? state.value.trim() : "",
      zipCode: zipCode ? zipCode.value.trim() : "",
      phone: phone ? phone.value.trim() : "",
      marketingOptIn: Boolean(marketingOptIn && marketingOptIn.checked),
      saveAddress: Boolean(saveAddress && saveAddress.checked),
      shippingMethod: selectedShippingMethodId,
      promoCode: promoCodeValue,
      shippingAmount: shippingAmount,
      estimatedTax: estimatedTax,
      saleDiscount: saleDiscount,
      promoDiscount: promoDiscount,
      items: cartItems,
      subtotal: subtotal,
      total: total,
      currency: "USD",
    };
  }

  function validateCheckoutDraft(draft) {
    return "";
  }

  function mergeCheckoutDraft(baseDraft, currentDraft) {
    const merged = { ...(baseDraft || {}) };
    const nextDraft = currentDraft || {};
    const checkoutFieldKeys = new Set([
      "email",
      "fullName",
      "country",
      "address1",
      "address2",
      "city",
      "state",
      "zipCode",
      "phone",
      "shippingMethod",
      "promoCode",
    ]);

    Object.keys(nextDraft).forEach(function (key) {
      const value = nextDraft[key];

      if (Array.isArray(value)) {
        if (value.length) merged[key] = value;
        return;
      }

      if (typeof value === "string") {
        if (checkoutFieldKeys.has(key)) {
          const trimmedValue = value.trim();
          if (trimmedValue) merged[key] = trimmedValue;
          return;
        }
        if (value.trim()) merged[key] = value;
        return;
      }

      if (typeof value === "number") {
        if (!Number.isNaN(value) && value !== 0) merged[key] = value;
        return;
      }

      if (typeof value === "boolean") {
        merged[key] = value;
        return;
      }

      if (value) merged[key] = value;
    });

    return merged;
  }

  function getShippingMethodSummary(methodId) {
    if (methodId === "hs-pro-esdo2") return "Relay point, 1500 XOF";
    if (methodId === "hs-pro-esdo3") return "Customized, Negotiated";
    return "Pickup, Free";
  }

  function getShippingAmount(methodId) {
    if (methodId === "hs-pro-esdo2") return 9;
    if (methodId === "hs-pro-esdo3") return 10;
    return 0;
  }

  function buildShippingAddressFromCheckoutDraft(draft) {
    if (!draft) return null;

    const fullName = String(draft.fullName || "").trim();

    return {
      first_name: fullName.split(" ")[0] || fullName || "",
      last_name: fullName.split(" ").slice(1).join(" "),
      email: draft.email || "",
      phone: draft.phone || "",
      address_line_1: draft.address1 || draft.city || "",
      address_line_2: draft.address2 || "",
      city: draft.city || "",
      state: draft.state || "",
      postal_code: draft.zipCode || "",
      country: draft.country || "",
    };
  }

  function buildReviewSnapshot(draft, paymentMethod) {
    const nextDraft = draft || {};
    const pricing = buildOrderSummaryPricing(nextDraft);
    const shippingAddress = buildShippingAddressFromCheckoutDraft(nextDraft);

    return {
      email: nextDraft.email || "",
      fullName: nextDraft.fullName || "",
      phone: nextDraft.phone || "",
      country: nextDraft.country || "",
      address1: nextDraft.address1 || "",
      address2: nextDraft.address2 || "",
      city: nextDraft.city || "",
      state: nextDraft.state || "",
      zipCode: nextDraft.zipCode || "",
      shippingMethod: nextDraft.shippingMethod || "hs-pro-esdo1",
      shippingMethodLabel: getShippingMethodSummary(nextDraft.shippingMethod),
      paymentMethod: paymentMethod || nextDraft.paymentMethod || "Card",
      promoCode: nextDraft.promoCode || "",
      currency: nextDraft.currency || "USD",
      items: Array.isArray(nextDraft.items)
        ? nextDraft.items.map(function (item) {
            return {
              product_id: item.product_id || item.id,
              quantity: Number(item.quantity || 1),
              price: Number(item.price || 0),
              title: item.title,
              image: item.image || "",
              href: item.href || "./Product Detail.html",
              color: item.color || "",
              size: item.size || "",
              sku: item.sku || "",
            };
          })
        : [],
      subtotal: pricing.subtotal,
      shippingAmount: pricing.shippingAmount,
      estimatedTax: pricing.estimatedTax,
      saleDiscount: pricing.saleDiscount,
      promoDiscount: pricing.promoDiscount,
      total: pricing.total,
      shippingAddress: shippingAddress,
      billingAddress: shippingAddress ? { ...shippingAddress } : null,
      confirmedAt: new Date().toISOString(),
    };
  }

  function persistReviewSnapshot(snapshot) {
    if (!snapshot) return;
    writeJsonStorage(reviewSnapshotKey, snapshot);
  }

  function getPersistedReviewSnapshot() {
    return readJsonStorage(reviewSnapshotKey, null);
  }

  function buildOrderPayloadFromReviewSnapshot(snapshot, user) {
    return {
      user_id: user && user.id ? user.id : null,
      status: "pending",
      payment_method: snapshot.paymentMethod || "Card",
      subtotal: snapshot.subtotal,
      shipping_amount: snapshot.shippingAmount,
      tax_amount: snapshot.estimatedTax,
      sale_discount: snapshot.saleDiscount,
      promo_code: snapshot.promoCode,
      promo_discount: snapshot.promoDiscount,
      total: snapshot.total,
      total_amount: snapshot.total,
      currency: snapshot.currency || "USD",
      items: Array.isArray(snapshot.items) ? snapshot.items : [],
      shipping_address: snapshot.shippingAddress,
      billing_address: snapshot.billingAddress,
    };
  }

  function hydrateOrderFromSnapshot(order, snapshot) {
    if (!order) return order;

    const nextSnapshot =
      snapshot && (!snapshot.linkedOrderId || !order.id || snapshot.linkedOrderId === order.id)
        ? snapshot
        : null;
    const shippingAddress =
      order.shipping_address ||
      (nextSnapshot ? nextSnapshot.shippingAddress : null) ||
      null;
    const billingAddress =
      order.billing_address ||
      (nextSnapshot ? nextSnapshot.billingAddress : null) ||
      shippingAddress;

    return {
      ...order,
      payment_method:
        order.payment_method ||
        (nextSnapshot ? nextSnapshot.paymentMethod : null) ||
        "Card",
      shipping_address: shippingAddress,
      billing_address: billingAddress,
      email:
        order.email ||
        shippingAddress && shippingAddress.email ||
        nextSnapshot && nextSnapshot.email ||
        "",
      items:
        Array.isArray(order.items) && order.items.length
          ? order.items
          : nextSnapshot && Array.isArray(nextSnapshot.items)
            ? nextSnapshot.items
            : [],
    };
  }

  function getSaleDiscount(items) {
    return (items || []).reduce(function (sum, item) {
      const quantity = Number(item.quantity || 1);
      const price = Number(item.price || 0);
      const originalPrice = Number(item.originalPrice || 0);
      const itemDiscount = originalPrice > price ? (originalPrice - price) * quantity : 0;
      return sum + itemDiscount;
    }, 0);
  }

  function calculatePromoDiscount(promoCode, subtotal) {
    const normalizedCode = String(promoCode || "").trim().toUpperCase();
    const numericSubtotal = Number(subtotal || 0);

    if (!normalizedCode) return 0;

    const explicitAmount = normalizedCode.match(/(\d+)/);
    if (explicitAmount) {
      return Math.min(Number(explicitAmount[1] || 0), numericSubtotal);
    }

    return Math.min(10, numericSubtotal);
  }

  function buildOrderSummaryPricing(source) {
    const items = source && Array.isArray(source.items) ? source.items : [];
    const subtotal = Number(
      source && source.subtotal != null
        ? source.subtotal
        : items.reduce(function (sum, item) {
            return sum + Number(item.price || 0) * Number(item.quantity || 1);
          }, 0),
    );
    const shippingAmount = Number(
      source && source.shippingAmount != null
        ? source.shippingAmount
        : source && source.shipping_amount != null
          ? source.shipping_amount
          : getShippingAmount(source && source.shippingMethod ? source.shippingMethod : source && source.shipping_method),
    );
    const estimatedTax = Number(
      source && source.estimatedTax != null
        ? source.estimatedTax
        : source && source.tax_amount != null
          ? source.tax_amount
          : 0,
    );
    const saleDiscount = Number(
      source && source.saleDiscount != null
        ? source.saleDiscount
        : source && source.sale_discount != null
          ? source.sale_discount
          : getSaleDiscount(items),
    );
    const promoDiscount = Number(
      source && source.promoDiscount != null
        ? source.promoDiscount
        : source && source.promo_discount != null
          ? source.promo_discount
          : calculatePromoDiscount(source && source.promoCode ? source.promoCode : source && source.promo_code, subtotal),
    );
    const total = Number(
      source && source.total != null
        ? source.total
        : Math.max(0, subtotal + shippingAmount + estimatedTax - promoDiscount),
    );

    return {
      subtotal: subtotal,
      shippingAmount: shippingAmount,
      estimatedTax: estimatedTax,
      saleDiscount: saleDiscount,
      promoDiscount: promoDiscount,
      total: total,
    };
  }

  function renderOrderSummaryValues(pricing) {
    if (!pricing) return;

    const valueMap = {
      subtotal: formatPrice(pricing.subtotal || 0),
      shipping: formatPrice(pricing.shippingAmount || 0),
      "estimated-tax": formatPrice(pricing.estimatedTax || 0),
      "promo-code": pricing.promoDiscount ? "-" + formatPrice(pricing.promoDiscount) : formatPrice(0),
      "promo-discount": pricing.promoDiscount ? "-" + formatPrice(pricing.promoDiscount) : formatPrice(0),
      sale: pricing.saleDiscount ? "-" + formatPrice(pricing.saleDiscount) : formatPrice(0),
      total: formatPrice(pricing.total || 0),
    };

    Object.keys(valueMap).forEach(function (key) {
      document.querySelectorAll('[data-order-summary-value="' + key + '"]').forEach(function (node) {
        node.textContent = valueMap[key];
      });
    });
  }

  function getSelectedReviewPaymentMethod() {
    const paymentMethod = document.querySelector('input[name="hs-pro-shpfpm"]:checked');
    return paymentMethod ? paymentMethod.value : "Card";
  }

  function getPaymentMethodLabel(method) {
    if (method === "PayPal") return "A la livraison";
    if (method === "Klarna") return "A la boutique";
    if (method === "Card") return "Par Chario";
    return method ? String(method).trim() : "Par Chario";
  }

  function getPaymentStatusLabel(method) {
    if (method === "PayPal") return "A la livraison";
    if (method === "Klarna") return "A la boutique";
    return "Paid";
  }

  function getPaymentMethodDisplayLabel(method) {
    return getPaymentMethodLabel(method);
  }

  function renderReviewSummaryFromDraft(draft) {
    if ((!isPage("Review and Pay.html") && !isPage("review-pay.html")) || !draft) return;

    const emailNode = document.querySelector("[data-review-email]");
    const fullNameNode = document.querySelector("[data-review-full-name]");
    const addressLineNode = document.querySelector("[data-review-address-line]");
    const locationLineNode = document.querySelector("[data-review-location-line]") || document.querySelector("[data-review-city-phone]");
    const shippingMethodNode = document.querySelector("[data-review-shipping-method]");
    const addressLine = [draft.address1, draft.address2].filter(Boolean).join(", ");
    const locationLine = [
      draft.city,
      draft.zipCode,
      draft.country,
    ].filter(Boolean).join(", ");
    const fallbackAddressLine = addressLine || draft.city || "";
    const fallbackLocationLine = locationLine || draft.phone || "";

    if (emailNode) {
      emailNode.textContent = draft.email || "No email provided";
    }

    if (fullNameNode) {
      fullNameNode.textContent = draft.fullName || "";
    }

    if (addressLineNode) {
      addressLineNode.textContent = fallbackAddressLine;
    }

    if (locationLineNode) {
      locationLineNode.textContent = fallbackLocationLine;
    }

    if (shippingMethodNode) {
      shippingMethodNode.textContent = getShippingMethodSummary(draft.shippingMethod);
    }
  }

  function bindReviewSummarySync() {
    if (!isPage("Review and Pay.html") && !isPage("review-pay.html")) return;

    const sync = function () {
      renderReviewSummaryFromDraft(collectCheckoutDraft());
    };

    [
      "hs-pro-shchfem",
      "hs-pro-shchfn",
      "hs-pro-shchfct",
      "hs-pro-shchfph",
      "hs-pro-esdo1",
      "hs-pro-esdo2",
      "hs-pro-esdo3",
    ].forEach(function (id) {
      const field = document.getElementById(id);
      if (!field || field.dataset.reviewSummaryBound === "true") return;
      field.dataset.reviewSummaryBound = "true";
      field.addEventListener("input", sync);
      field.addEventListener("change", sync);
    });
  }

  function renderCheckoutSummaryFromDraft(draft) {
    renderOrderSummaryValues(buildOrderSummaryPricing(draft || collectCheckoutDraft()));
  }

  function bindCheckoutSummarySync() {
    if (!isPage("Checkout.html") && !isPage("Review and Pay.html") && !isPage("review-pay.html")) return;

    const sync = function () {
      renderCheckoutSummaryFromDraft(collectCheckoutDraft());
    };

    [
      "hs-pro-esdo1",
      "hs-pro-esdo2",
      "hs-pro-esdo3",
      "hs-pro-shchsetcpc",
    ].forEach(function (id) {
      const field = document.getElementById(id);
      if (!field || field.dataset.checkoutSummaryBound === "true") return;
      field.dataset.checkoutSummaryBound = "true";
      field.addEventListener("input", sync);
      field.addEventListener("change", sync);
    });
  }

  function bindReviewShippingMethodEditor() {
    if (!isPage("Review and Pay.html") && !isPage("review-pay.html")) return;

    const editTriggers = Array.from(document.querySelectorAll("[data-review-go-checkout]"));
    const saveButton = document.querySelector("[data-review-shipping-save]");

    editTriggers.forEach(function (editTrigger) {
      if (editTrigger.dataset.reviewShippingBound === "true") return;
      editTrigger.dataset.reviewShippingBound = "true";
      editTrigger.addEventListener("click", function () {
        window.location.href = "./Checkout.html";
      });
    });

    if (!saveButton || saveButton.dataset.reviewShippingSaveBound === "true") return;

    saveButton.dataset.reviewShippingSaveBound = "true";
    saveButton.addEventListener("click", function () {
      const baseDraft = readJsonStorage(checkoutDraftKey, {}) || {};
      const nextDraft = mergeCheckoutDraft(baseDraft, collectCheckoutDraft());
      writeJsonStorage(checkoutDraftKey, nextDraft);
      persistLastCheckoutDetails(nextDraft);
      persistReviewSnapshot(buildReviewSnapshot(nextDraft, getSelectedReviewPaymentMethod()));
      renderReviewSummaryFromDraft(nextDraft);
      renderCheckoutSummaryFromDraft(nextDraft);
    });
  }

  function bindCheckoutPage() {
    if (!isPage("Checkout.html")) return;

    hydrateCheckoutForm();
    renderCheckoutSummaryFromDraft(readJsonStorage(checkoutDraftKey, null) || collectCheckoutDraft());
    bindCheckoutSummarySync();
    const continueLink = findActionLink("./review-pay.html", /continue|review/i);
    if (!continueLink || continueLink.dataset.checkoutBound === "true") return;

    continueLink.dataset.checkoutBound = "true";
    continueLink.addEventListener("click", function (event) {
      event.preventDefault();

      const draft = collectCheckoutDraft();
      const validationError = validateCheckoutDraft(draft);
      const footer = continueLink.closest(".qyrcd") || continueLink.parentElement;

      if (validationError) {
        showMessage(footer, "data-checkout-message", validationError, "error");
        return;
      }

      writeJsonStorage(checkoutDraftKey, draft);
      persistLastCheckoutDetails(draft);
      persistReviewSnapshot(buildReviewSnapshot(draft));
      showMessage(footer, "data-checkout-message", "Checkout details saved.", "success");
      window.location.href = "./review-pay.html";
    });
  }

  function renderConfirmationFromOrder(order) {
    if (!order) return;

    document.querySelectorAll("p, span, h2").forEach(function (node) {
      const text = node.textContent || "";
      if (/Your order/.test(text) && /number/.test(text)) {
        const valueNode = node.querySelector("span");
        if (valueNode) valueNode.textContent = order.displayOrderNumber || order.id;
      }
      if (/An order confirmation has been sent to/.test(text)) {
        const valueNode = node.querySelector("span");
        if (valueNode) valueNode.textContent = order.email || localStorage.getItem(authEmailKey) || "";
      }
    });

    const statusBadge = Array.from(document.querySelectorAll("span")).find(function (node) {
      return /\bPaid\b/i.test(node.textContent || "") && node.querySelector("svg");
    });
    if (statusBadge) {
      statusBadge.childNodes[statusBadge.childNodes.length - 1].textContent = " " + getPaymentStatusLabel(order.payment_method);
    }

    const orderSummaryHeading = Array.from(document.querySelectorAll("h2, h3, h4, h5")).find(function (node) {
      return /Your order/i.test(node.textContent || "");
    });
    const orderSummaryRoot = orderSummaryHeading ? orderSummaryHeading.closest("div") : null;
    const listRoot = orderSummaryRoot ? orderSummaryRoot.querySelector(".space-y-5, .uilco, .space-y-7") : null;
    const orderItemsRoot = document.querySelector("[data-confirmation-order-items]");

    if (listRoot) {
      listRoot.innerHTML = order.items
        .map(function (item) {
          return [
            '<div class="flex haw2c">',
            '<div class="relative"><img alt="' + item.title + '" class="y6rh0 cr96u aruvj fy2yn edpyz" src="' + (item.image || "") + '"/></div>',
            '<div class="t6ue9 flex flex-col">',
            '<h4 class="yymkp c4t4j">' + item.title + "</h4>",
            '<p class="j9itz m859b f1ztf"><span>Qty:</span> <span>' + Number(item.quantity || 1) + "</span></p>",
            '<span class="j9itz yymkp c4t4j">' + formatPrice(item.price) + "</span>",
            "</div>",
            "</div>",
          ].join("");
        })
        .join("");
    }

    if (orderItemsRoot) {
      orderItemsRoot.innerHTML = order.items
        .map(function (item) {
          const details = [];
          if (item.color) details.push('<li class="m859b f1ztf">Color: ' + item.color + "</li>");
          if (item.size) details.push('<li class="m859b f1ztf">Size: ' + item.size + "</li>");

          return [
            '<div class="flex haw2c">',
            '<div class="relative"><img alt="' + item.title + '" class="y6rh0 cr96u aruvj fy2yn edpyz" src="' + (item.image || "") + '"/></div>',
            '<div class="t6ue9 flex flex-col">',
            '<h4 class="yymkp c4t4j">' + item.title + "</h4>",
            details.length ? '<ul class="j9itz space-y-1">' + details.join("") + "</ul>" : "",
            '<p class="j9itz m859b f1ztf"><span>Qty:</span><span>' + Number(item.quantity || 1) + "</span></p>",
            '<span class="j9itz yymkp c4t4j">' + formatPrice(item.price) + "</span>",
            "</div>",
            "</div>",
          ].join("");
        })
        .join("");
    }

    renderOrderSummaryValues(buildOrderSummaryPricing(order));
  }

  function formatOrderDate(value, options) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleDateString("en-GB", options || {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function formatOrderTime(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatOrderDateTime(value) {
    const dateLabel = formatOrderDate(value);
    const timeLabel = formatOrderTime(value);

    if (!dateLabel) return "";
    if (!timeLabel) return dateLabel;
    return dateLabel + " " + timeLabel;
  }

  function formatOrderAddress(address) {
    if (!address) return "";

    const seen = new Set();

    return [
      address.address_line_1,
      address.address_line_2,
      address.city,
      address.state,
      address.postal_code,
      address.country,
    ]
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(Boolean)
      .filter(function (value) {
        const normalized = value.toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .join(", ");
  }

  function persistLastCheckoutDetails(draft) {
    if (!draft) return;

    writeJsonStorage(lastCheckoutDetailsKey, {
      email: draft.email || "",
      fullName: draft.fullName || "",
      address1: draft.address1 || "",
      address2: draft.address2 || "",
      city: draft.city || "",
      state: draft.state || "",
      zipCode: draft.zipCode || "",
      country: draft.country || "",
      phone: draft.phone || "",
      shippingMethod: draft.shippingMethod || "",
      updatedAt: new Date().toISOString(),
    });
  }

  function getLatestOrderAddressLabel(order) {
    const orderAddress = formatOrderAddress(order && order.shipping_address);
    if (orderAddress) return orderAddress;

    const checkoutDraft =
      getPersistedReviewSnapshot() ||
      readJsonStorage(lastCheckoutDetailsKey, null) ||
      readJsonStorage(checkoutDraftKey, null);
    return formatOrderAddress(buildShippingAddressFromCheckoutDraft(checkoutDraft));
  }

  function getEstimatedDeliveryLabel(order) {
    const createdAt = order && order.created_at ? new Date(order.created_at) : new Date();
    const shippingAmount = Number(order && order.shipping_amount || 0);
    let transitDays = 4;

    if (shippingAmount >= 10) transitDays = 1;
    else if (shippingAmount >= 9) transitDays = 2;

    const deliveryDate = new Date(createdAt);
    deliveryDate.setDate(deliveryDate.getDate() + transitDays);

    return formatOrderDate(deliveryDate);
  }

  function getLatestOrderStatusLabel(order) {
    const normalizedStatus = normalizeLatestOrderTrackerStatus(order);
    if (normalizedStatus === "delivered") return "Delivered";
    if (normalizedStatus === "shipped") return "Shipped";
    return "Pending";
  }

  function normalizeLatestOrderTrackerStatus(order) {
    const rawStatus = String(order && (order.status || order.fulfillment_status) || "").trim().toLowerCase();
    if (rawStatus === "delivered" || rawStatus === "completed") return "delivered";
    if (rawStatus === "shipped") return "shipped";
    return "pending";
  }

  function getNextLatestOrderTrackerStatus(currentStatus) {
    if (currentStatus === "pending") return "Shipped";
    if (currentStatus === "shipped") return "Delivered";
    return "";
  }

  function getTrackerStepState(step, currentStatus) {
    var orderedSteps = ["placed", "pending", "shipped", "delivered"];
    var currentIndex = orderedSteps.indexOf(currentStatus);
    var stepIndex = orderedSteps.indexOf(step);

    if (stepIndex === -1) return "upcoming";
    if (currentIndex === -1) currentIndex = 1;
    if (stepIndex < currentIndex) return "completed";
    if (stepIndex === currentIndex) return "current";
    return "upcoming";
  }

  function buildCompletedTrackerMarkup(label) {
    return [
      '<svg class="y6rh0 x215h" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
      '<path d="M20 6 9 17l-5-5"></path>',
      "</svg>",
      label,
    ].join("");
  }

  function buildCurrentTrackerMarkup(label) {
    return [
      '<span class="relative flex">',
      '<span class="ykapz absolute inline-flex e9n2b nj29a si0ce e4zvp dark:bg-primary-600"></span>',
      '<span class="relative inline-flex nj29a n6fqq pikqk"></span>',
      '<span class="rfrdb">Current</span>',
      "</span>",
      '<span data-latest-order-current-status="true">' + label + "</span>",
    ].join("");
  }

  function buildUpcomingTrackerMarkup(label) {
    return label;
  }

  function buildTrackerStepMarkup(step, state, label) {
    if (state === "completed") {
      return {
        className: "hidden md:flex items-center i220p wgwtz yymkp c4t4j",
        innerHTML: buildCompletedTrackerMarkup(label),
      };
    }

    if (state === "current") {
      return {
        className: "hidden md:flex items-center i220p wgwtz yymkp s7mjk",
        innerHTML: buildCurrentTrackerMarkup(label),
      };
    }

    return {
      className: "hidden md:block my57n wgwtz yymkp c4t4j",
      innerHTML: buildUpcomingTrackerMarkup(label),
    };
  }

  function applyTrackerStepNode(node, step, currentStatus, labels) {
    if (!node) return;
    var state = getTrackerStepState(step, currentStatus);
    var nextMarkup = buildTrackerStepMarkup(step, state, labels[step]);
    node.className = nextMarkup.className;
    node.innerHTML = nextMarkup.innerHTML;
  }

  function applyOrderTracker(root, order) {
    if (!root) return;

    const trackerRoots = root.matches && root.matches("[data-order-tracker='true']")
      ? [root]
      : Array.from(root.querySelectorAll("[data-order-tracker='true']"));
    if (!trackerRoots.length) return;

    const currentStatus = normalizeLatestOrderTrackerStatus(order);
    const nextStatus = getNextLatestOrderTrackerStatus(currentStatus);
    const labels = {
      placed: "Order placed",
      pending: "Pending",
      shipped: "Shipped",
      delivered: "Delivered",
    };
    const progressState = {
      placed: getTrackerStepState("placed", currentStatus),
      pending: getTrackerStepState("pending", currentStatus),
      shipped: getTrackerStepState("shipped", currentStatus),
      delivered: getTrackerStepState("delivered", currentStatus),
    };

    trackerRoots.forEach(function (trackerRoot) {
      var mobileCurrent = trackerRoot.querySelector("[data-order-tracker-mobile-current='true']");
      if (mobileCurrent) {
        mobileCurrent.innerHTML = buildCurrentTrackerMarkup(labels[currentStatus]);
      }

      var mobileNext = trackerRoot.querySelector("[data-order-tracker-mobile-next='true']");
      if (mobileNext) {
        if (nextStatus) {
          mobileNext.style.display = "";
          mobileNext.innerHTML = [
            '<span class="at2zb">' + nextStatus + "</span>",
            "<span>",
            '<svg class="y6rh0 x215h" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
            '<circle cx="12" cy="12" r="10"></circle>',
            '<path d="M8 12h8"></path>',
            '<path d="m12 16 4-4-4-4"></path>',
            "</svg>",
            '<span class="rfrdb">Next</span>',
            "</span>",
          ].join("");
        } else {
          mobileNext.style.display = "none";
        }
      }

      applyTrackerStepNode(
        trackerRoot.querySelector('[data-order-tracker-step="placed"]'),
        "placed",
        currentStatus,
        labels,
      );
      applyTrackerStepNode(
        trackerRoot.querySelector('[data-order-tracker-step="pending"]'),
        "pending",
        currentStatus,
        labels,
      );
      applyTrackerStepNode(
        trackerRoot.querySelector('[data-order-tracker-step="shipped"]'),
        "shipped",
        currentStatus,
        labels,
      );
      applyTrackerStepNode(
        trackerRoot.querySelector('[data-order-tracker-step="delivered"]'),
        "delivered",
        currentStatus,
        labels,
      );

      trackerRoot.querySelectorAll("[data-order-tracker-progress]").forEach(function (node) {
        var step = node.getAttribute("data-order-tracker-progress");
        var stepState = progressState[step];
        if (!stepState) return;

        var isActive = stepState === "completed" || stepState === "current";
        node.style.width = isActive ? "100%" : "0%";
        node.parentElement && node.parentElement.setAttribute("aria-valuenow", isActive ? "100" : "0");
        node.className = isActive
          ? "flex flex-col lp3ls ftf66 overflow-hidden z0w76 m859b cncwr rm4xc offh6 a38gk uglyd"
          : "flex flex-col lp3ls ftf66 overflow-hidden pm6ks m859b cncwr rm4xc offh6 a38gk uglyd";
      });
    });
  }

  function renderLatestOrderItems(root, order) {
    if (!root || !order || !Array.isArray(order.items)) return;

    root.innerHTML = order.items.map(function (item) {
      const normalized = normalizeCartItem(item, 0);
      const reviewHref = buildWriteReviewHref(normalized);
      const hasSale = normalized.originalPrice && Number(normalized.originalPrice) > Number(normalized.price);
      const priceMarkup = hasSale
        ? [
            '<span class="liwkv block">',
            '<span class="yymkp f1ztf"><s>' + formatPrice(normalized.originalPrice) + "</s></span>",
            '<span class="yymkp gwcbr">' + formatPrice(normalized.price) + "</span>",
            "</span>",
          ].join("")
        : '<p class="liwkv yymkp c4t4j">' + formatPrice(normalized.price) + "</p>";

      return [
        '<div class="relative flex flex-row q3gap b2fns v60qq e1azp mjfwa y8a3d v77h5 u7zb2">',
        '<div class="relative y6rh0 mvv53 kds15">',
        '<img class="y6rh0 w-full fyct5 fy2yn ictpa" src="' + (normalized.image || "/images/photo-1699595749116-33a4a869503c.jpg") + '" alt="' + normalized.title.replace(/"/g, "&quot;") + '">',
        "</div>",
        '<div class="t6ue9">',
        '<div class="a3olr sm:flex ocxlb">',
        '<div class="t6ue9">',
        '<h4 class="c4t4j">' + normalized.title + "</h4>",
        priceMarkup,
        "</div>",
        "</div>",
        '<div class="flex flex-wrap zml5i nt9ka oskez">',
        '<div><h4 class="mpw84 yymkp f1ztf">Color</h4><p class="yymkp c4t4j">' + normalized.color + "</p></div>",
        '<div><h4 class="mpw84 yymkp f1ztf">Size</h4><p class="yymkp c4t4j">' + normalized.size + "</p></div>",
        '<div><h4 class="mpw84 yymkp f1ztf">Quantity</h4><p class="yymkp c4t4j">' + normalized.quantity + "</p></div>",
        "</div>",
        '<div class="fkl1d flex flex-wrap items-center osjzw">',
        '<button type="button" class="k85d4 zqj33 relative inline-flex lp3ls items-center i220p m859b sm:text-[13px] edpyz s6i1l mak94 x3ljb k0ser cirj5 dduyg disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden usqtq">Buy it again</button>',
        '<a class="k85d4 zqj33 relative inline-flex lp3ls items-center i220p m859b sm:text-[13px] edpyz s6i1l mak94 x3ljb k0ser cirj5 dduyg disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden usqtq" href="' + escapeHtml(reviewHref) + '">Write a product review</a>',
        "</div>",
        "</div>",
        "</div>",
      ].join("");
    }).join("");
  }

  function renderWriteReviewProduct() {
    if (!isPage("write-a-product-review.html")) return;

    const root = document.querySelector("[data-review-product='true']");
    if (!root) return;

    const imageNode = root.querySelector("[data-review-product-image='true']");
    const titleNode = root.querySelector("[data-review-product-title='true']");
    const params = new URLSearchParams(window.location.search);
    const fallbackTitle = params.get("title") || (titleNode ? titleNode.textContent.trim() : "Product");
    const fallbackImage = params.get("image") || (imageNode ? imageNode.getAttribute("src") : "");
    const slug = params.get("slug") || "";

    const applyProduct = function (product) {
      const image = product && product.image ? product.image : fallbackImage;
      const title = product && product.title ? product.title : fallbackTitle;

      if (imageNode && image) {
        imageNode.setAttribute("src", image);
        imageNode.setAttribute("alt", title || "Product Image");
      }

      if (titleNode && title) {
        titleNode.textContent = title;
      }
    };

    applyProduct(null);

    if (!slug) return;

    import("@siggistore/services/storefront/sanity-service")
      .then(function (module) {
        if (!module || !module.sanityService || typeof module.sanityService.getProductBySlug !== "function") {
          return null;
        }

        return module.sanityService.getProductBySlug(slug);
      })
      .then(function (product) {
        if (!product) return;

        const resolvedImage = product.image && product.image.asset && product.image.asset.url
          ? product.image.asset.url
          : product.images && product.images[0] && product.images[0].asset && product.images[0].asset.url
            ? product.images[0].asset.url
            : fallbackImage;

        applyProduct({
          title: product.title || fallbackTitle,
          image: resolvedImage,
        });
      })
      .catch(function (error) {
        console.warn("Unable to hydrate review product from Sanity.", error);
      });
  }

  function bindWriteReviewForm() {
    if (!isPage("write-a-product-review.html")) return;

    const submitButton = Array.from(document.querySelectorAll("button"))
      .find(function (button) {
        return /submit review/i.test((button.textContent || "").trim());
      });
    const headlineField = document.getElementById("hs-pro-shwprmah");
    const bodyField = document.getElementById("hs-pro-shwprmar");
    const nicknameField = document.getElementById("hs-pro-shchfn");
    const emailField = document.getElementById("hs-pro-shchfem");
    const footer = submitButton ? submitButton.parentElement : null;

    if (!submitButton || submitButton.dataset.reviewSubmitBound === "true") return;
    submitButton.dataset.reviewSubmitBound = "true";

    submitButton.addEventListener("click", async function () {
      const params = new URLSearchParams(window.location.search);
      const slug = params.get("slug") || "";
      const title = params.get("title") || "Product Detail";
      const image = params.get("image") || "";
      const recommendationField = document.querySelector('input[name="hs-pro-shprwrtp"]:checked');
      const ratingField = document.querySelector('input[name="hs-pro-shprcm"]:checked');
      const headline = headlineField ? headlineField.value.trim() : "";
      const body = bodyField ? bodyField.value.trim() : "";
      const nickname = nicknameField ? nicknameField.value.trim() : "";
      const email = emailField ? emailField.value.trim() : "";

      if (!headline || !body || !nickname || !email) {
        showMessage(footer, "data-write-review-message", "Headline, review, nickname, and email are required.", "error");
        return;
      }

      const rating = ratingField
        ? Number(String(ratingField.id || "").replace(/[^0-9]+/g, "")) || 5
        : 5;

      const reviewService = await getReviewService();
      if (!reviewService || typeof reviewService.submitReview !== "function") {
        showMessage(footer, "data-write-review-message", "Review service is unavailable right now.", "error");
        return;
      }

      const currentUser = await getCurrentUser();
      const originalLabel = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";

      try {
        const result = await reviewService.submitReview({
          product_slug: slug,
          product_title_snapshot: title,
          product_image_snapshot: image,
          customer_id: currentUser && currentUser.id ? currentUser.id : null,
          customer_name: nickname,
          customer_email: email,
          headline: headline,
          body: body,
          recommendation: recommendationField && recommendationField.id === "hs-pro-shprwrtpn" ? "no" : "yes",
          rating: rating,
          status: "published",
        });

        if (!result || !result.success) {
          throw new Error((result && result.error) || "Unable to submit the review right now.");
        }

        showMessage(footer, "data-write-review-message", "Review submitted. Redirecting to product page...", "success");

        const destination = slug
          ? "./Product Detail.html?slug=" + encodeURIComponent(slug) + "#reviews"
          : "./Product Detail.html#reviews";

        window.setTimeout(function () {
          window.location.href = destination;
        }, 300);
      } catch (error) {
        showMessage(
          footer,
          "data-write-review-message",
          error && error.message ? error.message : "Unable to submit the review right now.",
          "error",
        );
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    });
  }

  async function renderProductDetailStoredReviews() {
    if (!isPage("Product Detail.html")) return;

    const listRoot = document.querySelector("[data-product-review-list='true']");
    const template = listRoot ? listRoot.querySelector("[data-product-review-template='true']") : null;
    if (!listRoot || !template) return;

    listRoot.querySelectorAll("[data-generated-review='true']").forEach(function (node) {
      node.remove();
    });

    const params = new URLSearchParams(window.location.search);
    const titleNode = document.getElementById("product-detail-title");
    const reviewService = await getReviewService();
    if (!reviewService || typeof reviewService.getPublishedReviewsByProduct !== "function") {
      return;
    }

    try {
      const result = await reviewService.getPublishedReviewsByProduct({
        slug: params.get("slug") || "",
        title: titleNode ? titleNode.textContent.trim() : "",
        limit: 25,
      });

      const reviews = result && result.success && Array.isArray(result.data) ? result.data : [];
      if (!reviews.length) return;

      const markup = reviews.map(buildStoredReviewMarkup).join("");
      listRoot.insertAdjacentHTML("afterbegin", markup);
    } catch (error) {
      console.warn("Unable to render Supabase product reviews.", error);
    }
  }


  async function resolveLatestSupabaseOrder() {
    const services = await getServices();
    if (!services || !services.supabaseOrderService) return null;

    const user = await getCurrentUser();
    if (!user || !user.id) return null;

    try {
      const response = await services.supabaseOrderService.getOrders(user.id);
      const orders = response && response.success && Array.isArray(response.data)
        ? response.data
        : [];
      if (!orders.length) return null;

      const normalizedOrders = orders.map(function (order) {
        return hydrateOrderFromSnapshot({
          ...order,
          displayOrderNumber: order.displayOrderNumber || order.number || order.id,
          email:
            order.email ||
            order.shipping_address && order.shipping_address.email ||
            localStorage.getItem(authEmailKey) ||
            "",
        }, getPersistedReviewSnapshot());
      });

      var mergedOrders = mergeOrdersById(getStoredOrders(), normalizedOrders);
      saveStoredOrders(mergedOrders);
      writeJsonStorage(latestOrderKey, mergedOrders[0]);
      return mergedOrders[0];
    } catch (error) {
      console.warn("Unable to load latest Supabase order for My Orders page.", error);
      return null;
    }
  }

  async function renderLatestOrderCard() {
    if (!isPage("My Orders.html")) return;

    const root = document.querySelector("[data-latest-order-card='true']");
    if (!root) return;

    const supabaseOrder = await resolveLatestSupabaseOrder();
    const order = supabaseOrder || readJsonStorage(latestOrderKey, null);
    if (!order) return;

    const pricing = buildOrderSummaryPricing(order);
    const statusLabel = getLatestOrderStatusLabel(order);
    const addressLabel = getLatestOrderAddressLabel(order);
    const orderNumber = order.displayOrderNumber || order.id || "";
    const orderDate = formatOrderDateTime(order.created_at);
    const deliveryLabel = getEstimatedDeliveryLabel(order);

    root.querySelectorAll("[data-latest-order-status='true']").forEach(function (node) {
      node.innerHTML = '<span class="v3q4v y6rh0 n6fqq inline-block ij5jy nj29a"></span>' + statusLabel;
    });
    root.querySelectorAll("[data-latest-order-number='true']").forEach(function (node) {
      node.textContent = orderNumber;
    });
    root.querySelectorAll("[data-latest-order-date='true']").forEach(function (node) {
      node.textContent = orderDate || node.textContent;
    });
    root.querySelectorAll("[data-latest-order-total='true']").forEach(function (node) {
      node.textContent = formatPrice(pricing.total);
    });
    root.querySelectorAll("[data-latest-order-delivery='true']").forEach(function (node) {
      node.textContent = deliveryLabel;
    });
    root.querySelectorAll("[data-latest-order-address='true']").forEach(function (node) {
      node.textContent = addressLabel || "";
    });
    applyOrderTracker(root, order);

    root.querySelectorAll('a[href="./Order Details.html"]').forEach(function (link) {
      if (order && order.id) {
        link.setAttribute("href", "./Order Details.html?order=" + encodeURIComponent(order.id));
      }
    });

    renderLatestOrderItems(root.querySelector("[data-latest-order-items='true']"), order);
  }

  function bindReviewAndPayPage() {
    if (!isPage("Review and Pay.html") && !isPage("review-pay.html")) return;

    hydrateCheckoutForm();
    const draft = readJsonStorage(checkoutDraftKey, null) || collectCheckoutDraft();
    renderReviewSummaryFromDraft(draft);
    renderCheckoutSummaryFromDraft(draft);
    bindReviewSummarySync();
    bindCheckoutSummarySync();
    bindReviewShippingMethodEditor();

    const continueLink = findActionLink("./order-confirmation.html", /continue|place/i);
    if (!continueLink || continueLink.dataset.reviewBound === "true") return;

    if (draft && draft.email) {
      const emailField = document.getElementById("hs-pro-shchfem");
      if (emailField && !emailField.value) emailField.value = draft.email;
    }

    const placeReviewOrder = async function (footer) {
      const baseDraft = readJsonStorage(checkoutDraftKey, {}) || {};
      const currentDraft = mergeCheckoutDraft(baseDraft, collectCheckoutDraft());
      persistLastCheckoutDetails(currentDraft);
      const paymentMethod = getSelectedReviewPaymentMethod();
      const reviewSnapshot = buildReviewSnapshot(currentDraft, paymentMethod);
      persistReviewSnapshot(reviewSnapshot);
      const validationError = validateCheckoutDraft(currentDraft);

      if (validationError) {
        showMessage(footer, "data-review-message", validationError, "error");
        return;
      }

      const user = await getCurrentUser();
      const orderPayload = buildOrderPayloadFromReviewSnapshot(reviewSnapshot, user);

      let savedOrder = null;
      const services = await getServices();

      if (services && services.supabaseOrderService) {
        try {
          const response = await services.supabaseOrderService.createOrder(orderPayload);
          if (response && response.success && response.data) {
            savedOrder = hydrateOrderFromSnapshot({
              ...response.data,
              displayOrderNumber: response.data.id,
            }, reviewSnapshot);
          }
        } catch (error) {
          console.warn("Supabase order creation failed, falling back to local storage.", error);
        }
      }

      if (!savedOrder) {
        savedOrder = hydrateOrderFromSnapshot({
          ...orderPayload,
          id: "local-order-" + Date.now(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          displayOrderNumber: buildDisplayOrderNumber(),
        }, reviewSnapshot);
      }

      persistReviewSnapshot({
        ...reviewSnapshot,
        linkedOrderId: savedOrder.id,
        displayOrderNumber: savedOrder.displayOrderNumber || savedOrder.id,
      });

      const orders = getStoredOrders();
      orders.unshift(savedOrder);
      saveStoredOrders(orders);
      writeJsonStorage(latestOrderKey, savedOrder);
      localStorage.removeItem(lookupOrderKey);
      localStorage.removeItem(checkoutDraftKey);
      saveCartItems([]);
      clearCartInSupabase();

      showMessage(footer, "data-review-message", "Order placed successfully.", "success");
      window.location.href = "./order-confirmation.html";
    };

    continueLink.dataset.reviewBound = "true";
    continueLink.addEventListener("click", async function (event) {
      event.preventDefault();
      const footer = continueLink.closest(".qyrcd") || continueLink.parentElement;
      await placeReviewOrder(footer);
    });

    ["hs-pro-shpfpm2", "hs-pro-shpfpm3"].forEach(function (id) {
      const paymentInput = document.getElementById(id);
      if (!paymentInput || paymentInput.dataset.instantReviewBound === "true") return;

      paymentInput.dataset.instantReviewBound = "true";
      paymentInput.addEventListener("change", async function () {
        if (!paymentInput.checked) return;
        const footer = continueLink.closest(".qyrcd") || continueLink.parentElement;
        await placeReviewOrder(footer);
      });
    });
  }

  function bindOrderCheckupPage() {
    if (!isPage("Order Checkup.html")) return;

    const submitLink = findActionLink("./Order Details.html", /^submit$/i);
    if (!submitLink || submitLink.dataset.lookupBound === "true") return;

    submitLink.dataset.lookupBound = "true";
    submitLink.addEventListener("click", async function (event) {
      event.preventDefault();

      const numberInput = document.getElementById("hs-pro-shtofon");
      const emailInput = document.getElementById("hs-pro-shtofem");
      const lookupValue = numberInput ? numberInput.value.trim() : "";
      const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
      const container = submitLink.closest(".space-y-4") || submitLink.parentElement;

      if (!lookupValue || !email) {
        showMessage(container, "data-order-lookup-message", "Order number and email are required.", "error");
        return;
      }

      let order = getStoredOrders().find(function (entry) {
        const displayOrderNumber = String(entry.displayOrderNumber || entry.id || "").toLowerCase();
        const orderEmail = String(entry.email || entry.shipping_address && entry.shipping_address.email || "").toLowerCase();
        return displayOrderNumber === lookupValue.toLowerCase() && orderEmail === email;
      });

      if (!order && /^[0-9a-f-]{20,}$/i.test(lookupValue)) {
        const services = await getServices();
        if (services && services.supabaseOrderService) {
          try {
            const response = await services.supabaseOrderService.getOrder(lookupValue);
            if (response && response.success && response.data) {
              order = {
                ...response.data,
                displayOrderNumber: response.data.id,
                email: email,
              };
            }
          } catch (error) {
            console.warn("Supabase order lookup failed.", error);
          }
        }
      }

      if (!order) {
        showMessage(container, "data-order-lookup-message", "No order matched those details.", "error");
        return;
      }

      writeJsonStorage(lookupOrderKey, order);
      writeJsonStorage(latestOrderKey, order);
      showMessage(container, "data-order-lookup-message", "Order found. Redirecting...", "success");
      window.location.href = "./Order Details.html";
    });
  }

  function renderOrderConfirmationPage() {
    if (!isPage("order-confirmation.html")) return;
    const order = readJsonStorage(lookupOrderKey, null) || readJsonStorage(latestOrderKey, null);
    if (!order) return;
    renderConfirmationFromOrder(order);
  }

  async function renderOrderDetailsPage() {
    if (!isPage("Order Details.html")) return;

    let order = readJsonStorage(lookupOrderKey, null) || readJsonStorage(latestOrderKey, null);
    const params = new URLSearchParams(window.location.search);
    const requestedOrderId = params.get("order");
    if ((!order || (requestedOrderId && order.id !== requestedOrderId)) && requestedOrderId) {
      const services = await getServices();
      if (services && services.supabaseOrderService && typeof services.supabaseOrderService.getOrder === "function") {
        try {
          const response = await services.supabaseOrderService.getOrder(requestedOrderId);
          if (response && response.success && response.data) {
            order = hydrateOrderFromSnapshot({
              ...response.data,
              displayOrderNumber:
                response.data.displayOrderNumber ||
                response.data.number ||
                response.data.id,
              email:
                response.data.email ||
                response.data.shipping_address && response.data.shipping_address.email ||
                localStorage.getItem(authEmailKey) ||
                "",
            }, getPersistedReviewSnapshot());
            writeJsonStorage(lookupOrderKey, order);
            writeJsonStorage(latestOrderKey, order);
          }
        } catch (error) {
          console.warn("Unable to load storefront order details from Supabase.", error);
        }
      }
    }

    const checkoutDraft =
      getPersistedReviewSnapshot() ||
      readJsonStorage(lastCheckoutDetailsKey, null) ||
      readJsonStorage(checkoutDraftKey, null);
    const fallbackSource = checkoutDraft
      ? {
          ...checkoutDraft,
          email: checkoutDraft.email || "",
          payment_method: checkoutDraft.paymentMethod || "Card",
          items: checkoutDraft.items || [],
          shipping_amount: checkoutDraft.shippingAmount,
          tax_amount: checkoutDraft.estimatedTax,
          sale_discount: checkoutDraft.saleDiscount,
          promo_discount: checkoutDraft.promoDiscount,
          promo_code: checkoutDraft.promoCode,
          total: checkoutDraft.total,
          subtotal: checkoutDraft.subtotal,
          shipping_address: checkoutDraft.shippingAddress || buildShippingAddressFromCheckoutDraft(checkoutDraft),
          billing_address: checkoutDraft.billingAddress || checkoutDraft.shippingAddress || buildShippingAddressFromCheckoutDraft(checkoutDraft),
        }
      : null;
    const source = hydrateOrderFromSnapshot(order || fallbackSource, getPersistedReviewSnapshot());
    if (!source) return;
    const shippingAddress = source.shipping_address || {};
    const shippingName = [
      shippingAddress.first_name,
      shippingAddress.last_name,
    ].filter(Boolean).join(" ").trim();
    const shippingLocation = [
      shippingAddress.city,
      shippingAddress.postal_code,
      shippingAddress.country,
    ].filter(Boolean).join(", ");

    document.querySelectorAll("[data-order-details-payment-method='true']").forEach(function (node) {
      node.textContent = getPaymentMethodDisplayLabel(source.payment_method);
    });
    document.querySelectorAll("[data-order-details-payment-status='true']").forEach(function (node) {
      node.textContent = getPaymentStatusLabel(source.payment_method);
    });
    document.querySelectorAll("[data-order-details-contact-email='true']").forEach(function (node) {
      node.textContent = source.email || shippingAddress.email || "";
    });
    document.querySelectorAll("[data-order-details-shipping-name='true']").forEach(function (node) {
      node.textContent = shippingName || "";
    });
    document.querySelectorAll("[data-order-details-shipping-line1='true']").forEach(function (node) {
      node.textContent = shippingAddress.address_line_1 || "";
    });
    document.querySelectorAll("[data-order-details-shipping-location='true']").forEach(function (node) {
      node.textContent = shippingLocation || "";
    });
    document.querySelectorAll("[data-order-details-shipping-phone='true']").forEach(function (node) {
      node.textContent = shippingAddress.phone || "";
    });
    document.querySelectorAll("[data-order-details-delivery='true']").forEach(function (node) {
      node.textContent = getEstimatedDeliveryLabel(source);
    });
    applyOrderTracker(document, source);
    renderOrderSummaryValues(buildOrderSummaryPricing(source));
  }

  function bindOrderDetailsAddressModal() {
    if (!isPage("Order Details.html")) return;

    const modal = document.getElementById("hs-pro-sheam");
    if (!modal) return;

    const titleField = document.getElementById("hs-pro-sheamtt");
    const fullNameField = document.getElementById("hs-pro-sheamfn");
    const cityField = document.getElementById("hs-pro-sheamfct");
    const phoneField = document.getElementById("hs-pro-sheamfph");
    const saveButton = modal.querySelector(".uilco.qqy1w.s7rj7.ws8vo > button");
    const changeTriggers = Array.from(document.querySelectorAll('[data-hs-overlay="#hs-pro-sheam"]')).filter(function (trigger) {
      return !modal.contains(trigger);
    });

    if (!titleField || !fullNameField || !cityField || !phoneField || !saveButton) return;

    const populateModal = function () {
      const order = readJsonStorage(lookupOrderKey, null) || readJsonStorage(latestOrderKey, null);
      const shippingAddress = order && order.shipping_address ? order.shipping_address : {};

      titleField.value = shippingAddress.address_line_1 || "";
      fullNameField.value = [
        shippingAddress.first_name,
        shippingAddress.last_name,
      ].filter(Boolean).join(" ").trim();
      cityField.value = shippingAddress.city || "";
      phoneField.value = shippingAddress.phone || "";
    };

    changeTriggers.forEach(function (trigger) {
      if (trigger.dataset.orderDetailsAddressPopulateBound === "true") return;
      trigger.dataset.orderDetailsAddressPopulateBound = "true";
      trigger.addEventListener("click", populateModal);
    });

    if (saveButton.dataset.orderDetailsAddressSaveBound === "true") return;
    saveButton.dataset.orderDetailsAddressSaveBound = "true";
    saveButton.addEventListener("click", function () {
      const order = readJsonStorage(lookupOrderKey, null) || readJsonStorage(latestOrderKey, null);
      if (!order) return;

      const fullName = fullNameField.value.trim();
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const nextOrder = {
        ...order,
        shipping_address: {
          ...(order.shipping_address || {}),
          first_name: nameParts[0] || "",
          last_name: nameParts.slice(1).join(" "),
          address_line_1: titleField.value.trim(),
          city: cityField.value.trim(),
          phone: phoneField.value.trim(),
        },
      };

      writeJsonStorage(lookupOrderKey, nextOrder);
      writeJsonStorage(latestOrderKey, nextOrder);

      const orders = getStoredOrders().map(function (entry) {
        const entryId = entry && (entry.id || entry.displayOrderNumber);
        const nextId = nextOrder && (nextOrder.id || nextOrder.displayOrderNumber);
        return entryId === nextId ? nextOrder : entry;
      });
      saveStoredOrders(orders);

      renderOrderDetailsPage();
    });
  }

  function ensureLoggedOutCard(accountDropdown) {
    const loggedOutView = accountDropdown.querySelector(".auth-logged-out");
    if (loggedOutView) {
      loggedOutView.remove();
    }
    return null;
  }

  function bindLogoutButton(button, onLoggedOut) {
    if (!button || button.dataset.supabaseAuthBound) return;

    const freshButton = button.cloneNode(true);
    button.replaceWith(freshButton);
    freshButton.dataset.authBound = "true";
    freshButton.dataset.supabaseAuthBound = "true";
    freshButton.addEventListener("click", async function (event) {
      event.preventDefault();
      freshButton.disabled = true;

      try {
        const services = await getServices();
        if (services && services.supabaseAuthService) {
          await services.supabaseAuthService.signOut();
        }
      } catch (error) {
        console.warn("Supabase logout failed, continuing with local cleanup.", error);
      } finally {
        clearStoredAuth();
        if (typeof onLoggedOut === "function") onLoggedOut();
        window.location.href = "/Login.html";
      }
    });
  }

  function getProfileDisplayName(user, profile) {
    const firstName = (profile && profile.first_name) || user.user_metadata?.first_name || "";
    const lastName = (profile && profile.last_name) || user.user_metadata?.last_name || "";
    const combined = (firstName + " " + lastName).trim();
    if (combined) return combined;
    return (user.email || "").split("@")[0] || "";
  }

  function persistAuthSnapshot(user, profile) {
    localStorage.setItem(authKey, "true");
    localStorage.setItem(authEmailKey, user.email || "");
    localStorage.setItem(authNameKey, getProfileDisplayName(user, profile));

    const avatarUrl =
      (profile && profile.avatar_url) ||
      user.user_metadata?.avatar_url ||
      "";

    if (avatarUrl) {
      localStorage.setItem(authAvatarKey, avatarUrl);
    } else {
      localStorage.removeItem(authAvatarKey);
    }
  }

  async function syncStoredAuthWithSupabase() {
    const services = await getServices();
    if (!services || !services.supabaseAuthService) return false;

    const user = await services.supabaseAuthService.getCurrentUser();
    if (!user || !user.id) {
      clearStoredAuth();
      return false;
    }

    let profile = null;
    if (services.supabaseProfileService && typeof services.supabaseProfileService.getProfile === "function") {
      try {
        const response = await services.supabaseProfileService.getProfile(user.id);
        if (response && response.success) {
          profile = response.data || null;
        }
      } catch (error) {
        console.warn("Unable to load profile for header sync.", error);
      }
    }

    persistAuthSnapshot(user, profile);
    return true;
  }

  function ensureSharedAuthSync() {
    if (authSyncStarted) return;
    authSyncStarted = true;

    syncStoredAuthWithSupabase()
      .catch(function (error) {
        console.warn("Unable to sync header auth state.", error);
      })
      .finally(function () {
        setupAuthDropdown();
      });

    getServices().then(function (services) {
      if (!services || !services.supabaseAuthService || typeof services.supabaseAuthService.onAuthStateChange !== "function") {
        return;
      }

      services.supabaseAuthService.onAuthStateChange(async function (user) {
        if (user && user.id) {
          await syncStoredAuthWithSupabase();
        } else {
          clearStoredAuth();
        }

        setupAuthDropdown();
      });
    });

    window.addEventListener("focus", function () {
      syncStoredAuthWithSupabase()
        .catch(function () {
          clearStoredAuth();
        })
        .finally(function () {
          setupAuthDropdown();
        });
    });
  }

  function normalizeCrossAppLinks() {
    const isAdminApp = decodedPathname === "/admin" || decodedPathname.startsWith("/admin/");

    const storefrontRoutes = new Map([
      ["./index.html", "/"],
      ["./favorite.html", "/favorite.html"],
      ["./Login.html", "/Login.html"],
      ["./Create Account.html", "/Create Account.html"],
      ["./Personal Info.html", "/Personal Info.html"],
      ["./My Orders.html", "/My Orders.html"],
      ["./Order Details.html", "/Order Details.html"],
      ["./Order Checkup.html", "/Order Checkup.html"],
      ["./Addresses.html", "/Addresses.html"],
      ["./Cart.html", "/Cart.html"],
      ["./Checkout not Logged-In.html", "/Checkout%20not%20Logged-In.html"],
      ["./Checkout.html", "/Checkout.html"],
      ["./order-confirmation.html", "/order-confirmation.html"],
      ["./Product Listing.html", "/Product%20Listing.html"],
      ["./Product Detail.html", "/Product%20Detail.html"],
      ["./Empty Cart.html#", "/Empty%20Cart.html#"],
      ["./write-a-product-review.html", "/write-a-product-review.html"],
    ]);

    storefrontRoutes.forEach(function (absoluteHref, relativeHref) {
      document.querySelectorAll('a[href="' + relativeHref + '"]').forEach(function (link) {
        link.setAttribute("href", absoluteHref);
      });
    });

    const logoLink = document.querySelector('header .jdzig a.flex-none');
    if (logoLink) {
      logoLink.setAttribute("href", isAdminApp ? "/admin/" : "/");
    }

    Array.from(document.querySelectorAll("a")).forEach(function (link) {
      const text = (link.textContent || "").trim();

      if (/^Dashboard and more$/i.test(text)) {
        link.setAttribute("href", "/admin/");
      }

      if (isAdminApp && /^Help$/i.test(text) && link.getAttribute("href") === "/") {
        link.setAttribute("href", "/");
      }
    });
  }

  function setupAuthDropdown() {
    const accountDropdown = document.querySelector('.hs-dropdown-menu[aria-labelledby="hs-pro-shadnli"]');
    if (!accountDropdown) return;

    const loggedInView = accountDropdown.querySelector(".auth-logged-in") || accountDropdown.querySelector(":scope > .ltybu");
    const accountRoot = accountDropdown.closest(".hs-dropdown");
    const loggedOutView = ensureLoggedOutCard(accountDropdown);
    const accountName = accountDropdown.querySelector(".auth-user-name");
    const accountEmail = accountDropdown.querySelector(".auth-user-email");
    const logoutButton = accountDropdown.querySelector(".auth-logout-button");
    const avatarImages = document.querySelectorAll(".auth-avatar-image, .auth-account-avatar");
    const avatarFallback = document.querySelector(".auth-avatar-fallback");

    const setAuthView = function (isLoggedIn) {
      if (accountRoot) {
        if (isLoggedIn) {
          accountRoot.removeAttribute("data-storefront-hidden");
        } else {
          accountRoot.setAttribute("data-storefront-hidden", "true");
        }
      }
      if (loggedInView) loggedInView.classList.toggle("hidden", !isLoggedIn);
      if (loggedOutView) loggedOutView.classList.toggle("hidden", isLoggedIn);
      avatarImages.forEach(function (image) {
        image.classList.toggle("hidden", !isLoggedIn);
      });
      if (avatarFallback) avatarFallback.classList.toggle("hidden", isLoggedIn);

      if (isLoggedIn && accountName && accountEmail) {
        const email = localStorage.getItem(authEmailKey) || "";
        const fallbackName = email.includes("@") ? email.split("@")[0] : "";
        const name = localStorage.getItem(authNameKey) || fallbackName || "";
        const avatarUrl = localStorage.getItem(authAvatarKey) || "";
        accountName.textContent = name;
        accountEmail.textContent = email;
        avatarImages.forEach(function (image) {
          if (avatarUrl) {
            image.setAttribute("src", avatarUrl);
          } else {
            image.removeAttribute("src");
          }
        });
      }
    };

    setAuthView(localStorage.getItem(authKey) === "true");
    bindLogoutButton(logoutButton, function () {
      setAuthView(false);
    });
    document.querySelectorAll(".auth-logout-button").forEach(function (button) {
      bindLogoutButton(button);
    });
  }

  function initializeStorefrontPages() {
    normalizeCartButton();
    updateFavoritesSummary();
    updateCartSummaries();
    renderFavoritesDropdown();
    renderCartOverlayItems();
    renderCheckoutCartItems();
    renderSanityProductCarousel();
    renderFavoritePage();
    bindFavoriteToggles(document);
    bindAddToCartButtons(document);
    bindNewsletterForm(document);
    bindCheckoutPage();
    bindReviewAndPayPage();
    bindOrderCheckupPage();
    renderOrderConfirmationPage();
    renderOrderDetailsPage();
    bindOrderDetailsAddressModal();
    renderLatestOrderCard();
    renderWriteReviewProduct();
    renderProductDetailDisplayControls();
    bindWriteReviewForm();
    renderProductDetailStoredReviews();
    renderCartPage();
    normalizeCrossAppLinks();
    if (commerceStore && typeof commerceStore.applyStorefrontDiscountPromos === "function") {
      commerceStore.applyStorefrontDiscountPromos(document, { forceRefresh: true });
    }
  }

  async function initializeHeader() {
    await getCommerceStore();
    ensureSharedAuthSync();
    if (window.HSStaticMethods && typeof window.HSStaticMethods.autoInit === "function") {
      window.HSStaticMethods.autoInit();
    }

    if (initialized) {
      setupAuthDropdown();
      initializeStorefrontPages();
      updateFavoritesSummary();
      updateCartSummaries();
      return;
    }

    initialized = true;
    ensureHeaderStyles();
    setupAuthDropdown();
    initializeStorefrontPages();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initializeHeader();
    }, { once: true });
  } else {
    initializeHeader();
  }

  window.addEventListener("storefront:layout-ready", initializeHeader);
  window.addEventListener("favorites:update", function () {
    renderFavoritePage();
    renderFavoritesDropdown();
    renderCartOverlayItems();
    updateFavoritesSummary();
    normalizeCrossAppLinks();
  });
  window.addEventListener("cart:update", function () {
    updateCartSummaries();
    renderCartOverlayItems();
    renderCheckoutCartItems();
    renderSanityProductCarousel();
    if (isPage("Cart.html")) {
      renderCartPage();
    }
    if (commerceStore && typeof commerceStore.applyStorefrontDiscountPromos === "function") {
      commerceStore.applyStorefrontDiscountPromos(document, { forceRefresh: true });
    }
    normalizeCrossAppLinks();
  });

  window.addEventListener("storage", function () {
    renderFavoritePage();
    renderFavoritesDropdown();
    renderCartOverlayItems();
    renderCheckoutCartItems();
    renderOrderDetailsPage();
    renderLatestOrderCard();
    renderWriteReviewProduct();
    renderProductDetailDisplayControls();
    renderSanityProductCarousel();
    updateFavoritesSummary();
    updateCartSummaries();
    if (commerceStore && typeof commerceStore.applyStorefrontDiscountPromos === "function") {
      commerceStore.applyStorefrontDiscountPromos(document, { forceRefresh: true });
    }
    normalizeCrossAppLinks();
  });
})();
