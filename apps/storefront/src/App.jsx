import { useEffect, useRef, useState } from "react";
import { supabaseAuthService } from "@siggistore/services/storefront/supabase-service";
import { mountStorefrontIslands } from "./islands/mountStorefrontIslands.js";
import {
  applyStorefrontDiscountPromos,
  bindAddToCartButtons,
  bindFavoriteToggles,
  hydrateProductDataAttributes,
  updateCartSummaryUI,
  renderFavoritesDropdown,
  updateFavoritesSummaryUI,
} from "./lib/store.js";

const vendorScripts = [
  "/js/nouislider.min.js",
  "/js/floating-ui.core.umd.min.js",
  "/js/floating-ui.dom.umd.min.js",
  "/js/index.js",
  "/js/clipboard.min.js",
  "/js/hs-copy-clipboard-helper.js",
  "/js/app.js",
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-managed-src="${src}"]`);

    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }

      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.managedSrc = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => {
      reject(new Error(`Failed to load ${src}`));
    });
    document.body.append(script);
  });
}

async function loadVendorScripts() {
  for (const src of vendorScripts) {
    await loadScript(src);
  }
}

function initializeThemePickers() {
  const unavailableColorThemes = window.HS_UNAVAILABLE_COLOR_THEMES ?? {};
  const pathname = window.location.pathname;
  const themesDefaults = {
    default: "blue",
    harvest: "amber",
    retro: "fuchsia",
    ocean: "cyan",
    autumn: "yellow",
    moon: "gray",
    bubblegum: "pink",
    cashmere: "mauve",
    olive: "avocado",
  };

  let reducedThemes = [];
  let defaultTheme = "default";
  let defaultFont = "sans";

  for (const [key, value] of Object.entries(unavailableColorThemes)) {
    const { theme, excludes } = value;

    if (!pathname.includes(key)) continue;

    defaultTheme = theme;

    if (Array.isArray(excludes)) {
      reducedThemes = excludes;
    } else {
      if (excludes["*"]) reducedThemes.push(...excludes["*"]);

      for (const [nestedKey, nestedValue] of Object.entries(excludes)) {
        if (nestedKey !== "*" && pathname.includes(nestedKey)) {
          reducedThemes.push(...nestedValue);
        }
      }
    }

    break;
  }

  document
    .querySelectorAll('[data-hs-global-color-theme] input[type="radio"]')
    .forEach((input) => {
      if (reducedThemes.includes(input.value)) {
        input.disabled = true;
        input.closest(".group")?.classList.add("my57n", "rlfos");
      }

      input.addEventListener("change", (event) => {
        const value = event.target.value;
        const html = document.documentElement;
        const brand = themesDefaults[value];

        localStorage.setItem("hs-clipboard-theme", value);
        html.setAttribute("data-theme", `theme-${value}`);
        window.generateVariables?.(value, brand);
      });
    });

  document
    .querySelectorAll('[data-hs-global-brand] input[type="radio"]')
    .forEach((input) => {
      input.addEventListener("change", (event) => {
        const value = event.target.value;
        localStorage.setItem("hs-clipboard-brand", value);
        document.documentElement.setAttribute("data-brand", value);

        const currentTheme =
          localStorage.getItem("hs-clipboard-theme") || defaultTheme;
        window.generateVariables?.(currentTheme, value);
      });
    });

  document
    .querySelectorAll('[data-hs-global-font] input[type="radio"]')
    .forEach((input) => {
      input.addEventListener("change", (event) => {
        const value = event.target.value;
        localStorage.setItem("hs-clipboard-font", value);
        document.documentElement.setAttribute("data-font", value || defaultFont);
      });
    });
}

function initializePageBehaviors() {
  window.HSStaticMethods?.autoInit?.();
  initializeThemePickers();

  const overlayInstance = window.HSOverlay?.getInstance?.("#hs-pro-shnsm", true);
  if (overlayInstance?.element?.on) {
    overlayInstance.element.on("open", () => {
      const carousel = window.HSCarousel?.getInstance?.(
        "#hs-pro-shnsm [data-hs-carousel]",
        true,
      );

      carousel?.element?.recalculateWidth?.();
    });
  }
}

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.warn(`Unable to read ${key} from storage.`, error);
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function injectIslandMounts(html) {
  if (!html) return html;

  const categoriesPattern =
    /<div class="njjrs">\s*<!-- Grid -->\s*<div class="flex flex-wrap g26qa ocxlb">[\s\S]*?<\/div>\s*<!-- End Grid -->\s*<\/div>\s*<!-- Filter Bar -->/;

  const categoriesReplacement = `
<div class="njjrs">
<!-- Grid -->
<div data-storefront-island="homepage-categories" id="homepage-categories-root"></div>
<!-- End Grid -->
</div>
<!-- Filter Bar -->`;

  const productGridPattern =
    /<!-- Grid -->\s*<div data-storefront-island="homepage-product-grid" id="homepage-product-grid-root"><\/div>\s*<!-- End Grid -->\s*<!-- Loading Indicator -->[\s\S]*?<!-- End Loading Indicator -->|<!-- Grid -->\s*<div class="tex4h hfud4 z27bc fgi2s rn6hf h7z6o w0vti">[\s\S]*?<!-- End Loading Indicator -->/;

  const productGridReplacement = `
<!-- Grid -->
<div data-storefront-island="homepage-product-grid" id="homepage-product-grid-root"></div>
<!-- End Grid -->`;

  return html
    .replace(categoriesPattern, categoriesReplacement)
    .replace(productGridPattern, productGridReplacement);
}

function initializeAuthAndNavbar() {
  const authKey = "appLoggedIn";
  const authEmailKey = "appUserEmail";
  const authNameKey = "appUserName";
  const authAvatarKey = "appUserAvatar";

  const clearStoredAuth = () => {
    sessionStorage.clear();
    localStorage.removeItem(authKey);
    localStorage.removeItem(authEmailKey);
    localStorage.removeItem(authNameKey);
    localStorage.removeItem(authAvatarKey);
  };

  const accountDropdown = document.querySelector(
    '.hs-dropdown-menu[aria-labelledby="hs-pro-shadnli"]',
  );

  if (accountDropdown) {
    const loggedInView =
      accountDropdown.querySelector(".auth-logged-in") ??
      accountDropdown.querySelector(":scope > .ltybu");

    let loggedOutView = accountDropdown.querySelector(".auth-logged-out");

    if (!loggedOutView) {
      loggedOutView = document.createElement("div");
      loggedOutView.className = "auth-logged-out i0yn8 hidden";
      loggedOutView.innerHTML = `
        <div class="zorzx nck10 edpyz">
          <div class="a3olr rm4xc">
            <span class="block at2zb c4t4j">Account</span>
          </div>
          <a class="abuy9 aimp4 w-full inline-flex lp3ls items-center my9gz yymkp at2zb edpyz pm6ks mak94 ve4ck bni17 pucrg focus:outline-hidden soa63" href="./Login.html">
            Log in
          </a>
          <p class="ljp3z rm4xc yymkp f1ztf">
            Don't have an account?
            <a class="text-[13px] f1ztf carpj a8v2i bz0ic focus:outline-hidden ti70c" href="./Create Account.html">
              Register
            </a>
          </p>
        </div>
        <div class="-mx-3 dvh79 kize3">
          <div class="d6bui p3x4c e1azp mjfwa y8a3d v77h5 u7zb2">
            <a class="abuy9 aimp4 flex items-center h7z6o bnjlx y9dku focus:outline-hidden d298d" href="./My Orders.html">
              <div class="t6ue9">
                <div class="flex h7z6o">
                  <svg class="y6rh0 x215h liwkv c4t4j" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                  <div class="t6ue9">
                    <span class="yymkp c4t4j">My orders</span>
                  </div>
                </div>
              </div>
              <div class="ms-auto">
                <svg class="y6rh0 x215h n7lpx" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
              </div>
            </a>
          </div>
          <div class="d6bui p3x4c e1azp mjfwa y8a3d v77h5 u7zb2">
            <a class="abuy9 aimp4 flex items-center h7z6o bnjlx y9dku focus:outline-hidden d298d" href="./Order Checkup.html">
              <div class="t6ue9">
                <div class="flex h7z6o">
                  <svg class="y6rh0 x215h liwkv c4t4j" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0"></path><circle cx="12" cy="8" r="2"></circle><path d="M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712"></path></svg>
                  <div class="t6ue9">
                    <span class="yymkp c4t4j">Order status</span>
                  </div>
                </div>
              </div>
              <div class="ms-auto">
                <svg class="y6rh0 x215h n7lpx" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
              </div>
            </a>
          </div>
          <div class="d6bui p3x4c e1azp mjfwa y8a3d v77h5 u7zb2">
            <a class="abuy9 aimp4 flex items-center h7z6o bnjlx y9dku focus:outline-hidden d298d" href="./index.html">
              <div class="t6ue9">
                <div class="flex h7z6o">
                  <svg class="y6rh0 x215h liwkv c4t4j" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg>
                  <div class="t6ue9">
                    <span class="yymkp c4t4j">Help</span>
                  </div>
                </div>
              </div>
              <div class="ms-auto">
                <svg class="y6rh0 x215h n7lpx" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
              </div>
            </a>
          </div>
        </div>
      `;

      if (loggedInView) {
        loggedInView.insertAdjacentElement("afterend", loggedOutView);
      } else {
        accountDropdown.appendChild(loggedOutView);
      }
    }

    const accountName = accountDropdown.querySelector(".auth-user-name");
    const accountEmail = accountDropdown.querySelector(".auth-user-email");
    const logoutButton = accountDropdown.querySelector(".auth-logout-button");
    const avatarImages = document.querySelectorAll(
      ".auth-avatar-image, .auth-account-avatar",
    );
    const avatarFallback = document.querySelector(".auth-avatar-fallback");

    const setAuthView = (isLoggedIn) => {
      loggedInView?.classList.toggle("hidden", !isLoggedIn);
      loggedOutView?.classList.toggle("hidden", isLoggedIn);
      avatarImages.forEach((image) => {
        image.classList.toggle("hidden", !isLoggedIn);
      });
      avatarFallback?.classList.toggle("hidden", isLoggedIn);

      if (isLoggedIn && accountName && accountEmail) {
        const email = localStorage.getItem(authEmailKey) || "";
        const fallbackName = email.includes("@")
          ? email.split("@")[0]
          : "";
        const name = localStorage.getItem(authNameKey) || fallbackName;

        accountName.textContent = name;
        accountEmail.textContent = email;
      }

      const avatarUrl = localStorage.getItem(authAvatarKey);
      avatarImages.forEach((image) => {
        if (avatarUrl) {
          image.setAttribute("src", avatarUrl);
        } else {
          image.removeAttribute("src");
        }
      });
    };

    setAuthView(localStorage.getItem(authKey) === "true");

    if (logoutButton && !logoutButton.dataset.supabaseAuthBound) {
      const freshLogoutButton = logoutButton.cloneNode(true);
      logoutButton.replaceWith(freshLogoutButton);
      freshLogoutButton.dataset.authBound = "true";
      freshLogoutButton.dataset.supabaseAuthBound = "true";
      freshLogoutButton.addEventListener("click", async (event) => {
        event.preventDefault();
        freshLogoutButton.disabled = true;

        try {
          await supabaseAuthService.signOut();
        } catch (error) {
          console.warn("Supabase logout failed, continuing with local cleanup.", error);
        } finally {
          clearStoredAuth();
          setAuthView(false);
          window.location.href = "./Login.html";
        }
      });
    }
  }
}

function initializeStorefrontRuntimeState() {
  const newsletterKey = "appNewsletterSubscribers";
  const allowedNavLabels = new Set(["Home", "Grid", "Order Checkup", "Our Stores"]);
  const header = document.querySelector("header");

  const showInlineMessage = (container, message, tone = "success") => {
    if (!container) return;

    let messageNode = container.querySelector("[data-dynamic-message]");
    if (!messageNode) {
      messageNode = document.createElement("p");
      messageNode.setAttribute("data-dynamic-message", "true");
      messageNode.style.marginTop = "0.5rem";
      messageNode.style.fontSize = "0.875rem";
      container.appendChild(messageNode);
    }

    messageNode.textContent = message;
    messageNode.style.color = tone === "error" ? "#b91c1c" : "#166534";
  };

  if (header) {
    header.querySelectorAll("a").forEach((link) => {
      const label = link.textContent?.trim();
      if (!label) return;

      if (["Pages", "About Us", "Sales"].includes(label)) {
        link.style.display = "none";
      } else if (allowedNavLabels.has(label)) {
        link.style.removeProperty("display");
      }
    });
  }

  const newsletterInput = document.getElementById("hs-pro-shfsei");
  const newsletterButton = newsletterInput?.parentElement?.querySelector('button[type="button"]');
  if (newsletterInput && newsletterButton && !newsletterButton.dataset.newsletterBound) {
    newsletterButton.dataset.newsletterBound = "true";
    newsletterButton.addEventListener("click", () => {
      const email = newsletterInput.value.trim().toLowerCase();
      const container = newsletterInput.closest(".b70oy");

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showInlineMessage(container, "Enter a valid email address.", "error");
        return;
      }

      const subscribers = readJsonStorage(newsletterKey, []);
      if (!subscribers.includes(email)) {
        subscribers.push(email);
        writeJsonStorage(newsletterKey, subscribers);
      }

      newsletterInput.value = "";
      showInlineMessage(container, "You are subscribed for updates.");
    });
  }

  hydrateProductDataAttributes(document);
  bindFavoriteToggles(document);
  bindAddToCartButtons(document);
  updateFavoritesSummaryUI(document);
  renderFavoritesDropdown(document);
  updateCartSummaryUI(document);
  applyStorefrontDiscountPromos(document, { forceRefresh: true });

  if (!window.__storefrontReactCommerceEventsBound) {
    window.__storefrontReactCommerceEventsBound = "true";
    window.addEventListener("favorites:update", () => {
      updateFavoritesSummaryUI(document);
      renderFavoritesDropdown(document);
    });
    window.addEventListener("cart:update", () => {
      updateCartSummaryUI(document);
      applyStorefrontDiscountPromos(document, { forceRefresh: true });
    });
    window.addEventListener("storage", () => {
      updateFavoritesSummaryUI(document);
      renderFavoritesDropdown(document);
      updateCartSummaryUI(document);
      applyStorefrontDiscountPromos(document, { forceRefresh: true });
    });
  }
}

function initializeHeroHoverVideos(root = document) {
  const HERO_VIDEO_ASPECT = 16 / 9;
  const wrappers = root.querySelectorAll("[data-hero-video]");

  const fitHeroVideo = (wrapper) => {
    const frame = wrapper.querySelector("[data-hero-video-frame]");
    if (!frame) return;

    const { width, height } = wrapper.getBoundingClientRect();
    if (!width || !height) return;

    const boxAspect = width / height;
    let frameWidth = width;
    let frameHeight = height;

    if (boxAspect > HERO_VIDEO_ASPECT) {
      frameHeight = width / HERO_VIDEO_ASPECT;
    } else {
      frameWidth = height * HERO_VIDEO_ASPECT;
    }

    frame.style.width = `${frameWidth}px`;
    frame.style.height = `${frameHeight}px`;
    frame.style.left = `${(width - frameWidth) / 2}px`;
    frame.style.top = `${(height - frameHeight) / 2}px`;
  };

  wrappers.forEach((wrapper) => {
    const frame = wrapper.querySelector("[data-hero-video-frame]");
    const container = wrapper.closest(".ihunb");
    const playOverlay = container?.querySelector("[data-hero-play]");
    const poster = container?.querySelector("[data-hero-poster]");

    if (!frame || !container || !playOverlay || !poster) return;
    if (container.dataset.heroVideoBound === "true") return;

    container.dataset.heroVideoBound = "true";

    const startVideo = () => {
      if (!frame.src) {
        frame.src = frame.dataset.src || "";
      }

      wrapper.hidden = false;
      wrapper.setAttribute("aria-hidden", "false");
      fitHeroVideo(wrapper);
      playOverlay.hidden = true;
      poster.hidden = true;
    };

    container.addEventListener("pointerenter", startVideo, { once: true });
    container.addEventListener("mouseenter", startVideo, { once: true });
    container.addEventListener("focusin", startVideo, { once: true });
  });

  const syncAll = () => wrappers.forEach(fitHeroVideo);
  syncAll();

  if (!window.__storefrontHeroVideoResizeBound) {
    window.__storefrontHeroVideoResizeBound = "true";
    window.addEventListener("resize", () => {
      document.querySelectorAll("[data-hero-video]").forEach(fitHeroVideo);
    });
  }
}

export default function App() {
  const [markup, setMarkup] = useState("");
  const [error, setError] = useState("");
  const initializedRef = useRef(false);
  const shellRef = useRef(null);
  const unmountIslandsRef = useRef(() => {});

  useEffect(() => {
    fetch("/pages/home.html")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load storefront markup.");
        }

        return response.text();
      })
      .then((html) => {
        setMarkup(injectIslandMounts(html));
      })
      .catch((fetchError) => setError(fetchError.message));
  }, []);

  useEffect(() => {
    if (!shellRef.current || !markup || initializedRef.current) return;

    window.defaultVariables = { baseUrl: "https://preline.co/pro" };

    initializedRef.current = true;

    loadVendorScripts()
      .then(() => {
        unmountIslandsRef.current = mountStorefrontIslands(shellRef.current);
        initializePageBehaviors();
        initializeAuthAndNavbar();
        initializeStorefrontRuntimeState();
        initializeHeroHoverVideos(shellRef.current);
      })
      .catch((scriptError) => setError(scriptError.message));

    return () => {
      unmountIslandsRef.current?.();
    };
  }, [markup]);

  if (error) {
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Unable to load storefront</h1>
        <p>{error}</p>
      </main>
    );
  }

  return <div ref={shellRef} dangerouslySetInnerHTML={{ __html: markup }} />;
}
