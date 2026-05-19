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
  const ordersKey = "appOrders";
  const latestOrderKey = "appLatestOrder";
  const lookupOrderKey = "appLookupOrder";
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

  function saveStoredOrders(orders) {
    writeJsonStorage(ordersKey, orders);
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

  async function renderSanityProductCarousel() {
    if (!isPage("Cart.html")) return;

    const carousel = document.querySelector('[data-sanity-product-carousel="cart-recommendations"]');
    if (!carousel || carousel.dataset.sanityRendered === "true") return;

    const slides = Array.from(carousel.querySelectorAll(".hs-carousel-slide"));
    if (!slides.length) return;

    try {
      const sanityModule = await import("/src/services/sanity-service.ts");
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
    const shippingAmount = getShippingAmount(shippingMethod ? shippingMethod.id : "hs-pro-esdo1");
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
      shippingMethod: shippingMethod ? shippingMethod.id : "hs-pro-esdo1",
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
          merged[key] = value.trim();
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

  function getPaymentStatusLabel(method) {
    if (method === "PayPal") return "Pay on delivery";
    if (method === "Klarna") return "Pay in store";
    return "Paid";
  }

  function getPaymentMethodDisplayLabel(method) {
    if (method === "PayPal") return "PayPal";
    if (method === "Klarna") return "Klarna";
    return "Card";
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

    return date.toLocaleDateString("en-US", options || {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    });
  }

  function formatOrderAddress(address) {
    if (!address) return "";

    return [
      address.address_line_1,
      address.address_line_2,
      address.city,
      address.state,
      address.postal_code,
      address.country,
    ].filter(Boolean).join(", ");
  }

  function getEstimatedDeliveryLabel(order) {
    const createdAt = order && order.created_at ? new Date(order.created_at) : new Date();
    const shippingAmount = Number(order && order.shipping_amount || 0);
    let transitDays = 4;

    if (shippingAmount >= 10) transitDays = 1;
    else if (shippingAmount >= 9) transitDays = 2;

    const deliveryDate = new Date(createdAt);
    deliveryDate.setDate(deliveryDate.getDate() + transitDays);

    return deliveryDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getLatestOrderStatusLabel(order) {
    const rawStatus = String(order && (order.status || order.fulfillment_status) || "").trim();
    if (!rawStatus) return "Preparing order";

    return rawStatus
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, function (char) {
        return char.toUpperCase();
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

    import("/src/services/sanity-service.ts")
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

  function renderLatestOrderCard() {
    if (!isPage("My Orders.html")) return;

    const root = document.querySelector("[data-latest-order-card='true']");
    const order = readJsonStorage(latestOrderKey, null);
    if (!root || !order) return;

    const pricing = buildOrderSummaryPricing(order);
    const statusLabel = getLatestOrderStatusLabel(order);
    const addressLabel = formatOrderAddress(order.shipping_address);
    const orderNumber = order.displayOrderNumber || order.id || "";
    const orderDate = formatOrderDate(order.created_at);
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
      if (addressLabel) node.textContent = addressLabel;
    });
    root.querySelectorAll("[data-latest-order-current-status='true']").forEach(function (node) {
      node.textContent = statusLabel;
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
      const validationError = validateCheckoutDraft(currentDraft);

      if (validationError) {
        showMessage(footer, "data-review-message", validationError, "error");
        return;
      }

      const user = await getCurrentUser();
      const paymentMethod = getSelectedReviewPaymentMethod();
      const orderPayload = {
        user_id: user && user.id ? user.id : "guest-" + Date.now(),
        status: "pending",
        payment_method: paymentMethod,
        subtotal: currentDraft.subtotal,
        shipping_amount: currentDraft.shippingAmount,
        tax_amount: currentDraft.estimatedTax,
        sale_discount: currentDraft.saleDiscount,
        promo_code: currentDraft.promoCode,
        promo_discount: currentDraft.promoDiscount,
        total: currentDraft.total,
        currency: currentDraft.currency || "USD",
        items: currentDraft.items.map(function (item) {
          return {
            product_id: item.product_id || item.id,
            quantity: Number(item.quantity || 1),
            price: Number(item.price || 0),
            title: item.title,
            image: item.image || "",
            href: item.href || "./Product Detail.html",
            color: item.color || "",
            size: item.size || "",
          };
        }),
        shipping_address: {
          first_name: currentDraft.fullName.split(" ")[0] || currentDraft.fullName,
          last_name: currentDraft.fullName.split(" ").slice(1).join(" "),
          email: currentDraft.email,
          phone: currentDraft.phone,
          address_line_1: currentDraft.address1,
          address_line_2: currentDraft.address2,
          city: currentDraft.city,
          postal_code: currentDraft.zipCode,
          country: currentDraft.country,
        },
        billing_address: {
          first_name: currentDraft.fullName.split(" ")[0] || currentDraft.fullName,
          last_name: currentDraft.fullName.split(" ").slice(1).join(" "),
          email: currentDraft.email,
          phone: currentDraft.phone,
          address_line_1: currentDraft.address1,
          address_line_2: currentDraft.address2,
          city: currentDraft.city,
          postal_code: currentDraft.zipCode,
          country: currentDraft.country,
        },
      };

      let savedOrder = null;
      const services = await getServices();

      if (services && services.supabaseOrderService && user && user.id) {
        try {
          const response = await services.supabaseOrderService.createOrder(orderPayload);
          if (response && response.success && response.data) {
            savedOrder = {
              ...response.data,
              displayOrderNumber: response.data.id,
              email: currentDraft.email,
            };
          }
        } catch (error) {
          console.warn("Supabase order creation failed, falling back to local storage.", error);
        }
      }

      if (!savedOrder) {
        savedOrder = {
          ...orderPayload,
          id: "local-order-" + Date.now(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          displayOrderNumber: buildDisplayOrderNumber(),
          email: currentDraft.email,
        };
      }

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
      const zipInput = document.getElementById("hs-pro-shtofsz");
      const lookupValue = numberInput ? numberInput.value.trim() : "";
      const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
      const zipCode = zipInput ? zipInput.value.trim() : "";
      const container = submitLink.closest(".space-y-4") || submitLink.parentElement;

      if (!lookupValue || !email || !zipCode) {
        showMessage(container, "data-order-lookup-message", "Order number, email, and shipping zip code are required.", "error");
        return;
      }

      let order = getStoredOrders().find(function (entry) {
        const displayOrderNumber = String(entry.displayOrderNumber || entry.id || "").toLowerCase();
        const orderEmail = String(entry.email || entry.shipping_address && entry.shipping_address.email || "").toLowerCase();
        const orderZip = String(entry.shipping_address && entry.shipping_address.postal_code || "").trim();
        return displayOrderNumber === lookupValue.toLowerCase() && orderEmail === email && orderZip === zipCode;
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

  function renderOrderDetailsPage() {
    if (!isPage("Order Details.html")) return;

    const order = readJsonStorage(lookupOrderKey, null) || readJsonStorage(latestOrderKey, null);
    const checkoutDraft = readJsonStorage(checkoutDraftKey, null);
    const fallbackSource = checkoutDraft
      ? {
          ...checkoutDraft,
          email: checkoutDraft.email || "",
          payment_method: "Card",
          shipping_address: {
            first_name: (checkoutDraft.fullName || "").split(" ")[0] || checkoutDraft.fullName || "",
            last_name: (checkoutDraft.fullName || "").split(" ").slice(1).join(" "),
            email: checkoutDraft.email || "",
            phone: checkoutDraft.phone || "",
            address_line_1: checkoutDraft.address1 || "",
            address_line_2: checkoutDraft.address2 || "",
            city: checkoutDraft.city || "",
            postal_code: checkoutDraft.zipCode || "",
            country: checkoutDraft.country || "",
          },
        }
      : null;
    const source = order || fallbackSource;
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

    const logoLink = document.querySelector('header a[aria-label="Preline"]');
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
    renderCartPage();
    normalizeCrossAppLinks();
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
    renderSanityProductCarousel();
    updateFavoritesSummary();
    updateCartSummaries();
    normalizeCrossAppLinks();
  });
})();
