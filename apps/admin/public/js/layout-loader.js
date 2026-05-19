(function () {
  const SHARED_HEADER_ID = "shared-site-header";
  const SHARED_FOOTER_ID = "shared-site-footer";
  const STOREFRONT_HEADER_PATH = "/header.html";
  const SHARED_FOOTER_PATH = "/footer.html";
  const HEADER_STANDARDIZER_SRC = "/admin/js/header-standardizer.js";
  const ADMIN_SHARED_HEADER_STYLE_ID = "admin-shared-header-spacing";

  function getTopLevelSection(tagName) {
    return Array.from(document.body.children).find(
      (element) => element.tagName.toLowerCase() === tagName,
    );
  }

  async function fetchSection(path, selector) {
    const response = await fetch(path);

    if (!response.ok) {
      throw new Error(`Failed to load ${path}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.querySelector(selector);
  }

  function ensureHeaderStandardizer() {
    const existingScript = document.querySelector('script[data-admin-header-standardizer="true"]');
    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    script.src = HEADER_STANDARDIZER_SRC;
    script.defer = true;
    script.dataset.adminHeaderStandardizer = "true";
    document.body.appendChild(script);
  }

  function ensureAdminSharedHeaderSpacing() {
    if (document.getElementById(ADMIN_SHARED_HEADER_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = ADMIN_SHARED_HEADER_STYLE_ID;
    style.textContent = `
      #${SHARED_HEADER_ID} {
        margin-top: 0.75rem;
      }
    `;
    document.head.appendChild(style);
  }

  async function loadSharedLayout() {
    const existingSharedHeader = document.getElementById(SHARED_HEADER_ID);
    const existingSharedFooter = document.getElementById(SHARED_FOOTER_ID);
    const headerTarget = getTopLevelSection("header");
    const footerTargets = Array.from(document.body.children).filter(
      (element) =>
        element.tagName.toLowerCase() === "footer" &&
        element.id !== SHARED_FOOTER_ID,
    );
    const footerTarget = footerTargets.at(-1);

    if (!headerTarget && !footerTarget && !existingSharedHeader && !existingSharedFooter) {
      return;
    }

    const [headerSource, footerSource] = await Promise.all([
      headerTarget || existingSharedHeader
        ? fetchSection(STOREFRONT_HEADER_PATH, "header")
        : Promise.resolve(null),
      footerTarget ? fetchSection(SHARED_FOOTER_PATH, "footer") : Promise.resolve(null),
    ]);

    if (headerSource) {
      headerSource.id = SHARED_HEADER_ID;
      ensureAdminSharedHeaderSpacing();

      if (existingSharedHeader) {
        existingSharedHeader.replaceWith(headerSource);
      } else if (headerTarget) {
        headerTarget.before(headerSource);
      } else {
        document.body.prepend(headerSource);
      }
    }

    if (footerTarget && footerSource) {
      footerSource.id = SHARED_FOOTER_ID;
      footerTarget.replaceWith(footerSource);
    }

    ensureHeaderStandardizer();
    window.HSStaticMethods?.autoInit?.();
    window.dispatchEvent(new CustomEvent("layout:ready"));
    window.dispatchEvent(new CustomEvent("storefront:layout-ready"));
  }

  loadSharedLayout().catch((error) => {
    console.warn("Shared layout could not be loaded:", error);
  });
})();
