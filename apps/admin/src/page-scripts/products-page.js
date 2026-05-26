import { createTableUrlState } from "@siggistore/services/admin/table-state.js";
import {
  fetchProductRuntimeByIds,
  getProductStockState,
  mergeProductWithRuntime,
  PRODUCT_RUNTIME_TABLE,
  updateProductRuntimeAvailability,
} from "@siggistore/services/admin";
import {
  fetchSanityProducts,
  subscribeToSanityProducts,
} from "@siggistore/services/admin/sanity-service.js";
import { subscribeToProductRuntime } from "@siggistore/services/admin/realtime.js";

const PAGE_SIZE = 10;
const TAB_KEYS = ["all"];
const tableState = createTableUrlState({
  defaultPage: 1,
  defaultPageSize: PAGE_SIZE,
  statusParam: "status",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMoney(value) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function getProductRuntimeErrorMessage(error, fallback) {
  const message = String(error?.message || "");
  if (/products_runtime|schema cache|relation .* does not exist/i.test(message)) {
    return "Product runtime table is missing. Run scripts/create-products-runtime-table.sql in Supabase, then try again.";
  }
  return message ? `${fallback}: ${message}` : `${fallback}.`;
}

function filterProductsByTab(products, tabKey) {
  return products;
}

function buildRuntimeLookupKey(product) {
  return [product.id, product.slug, product.sku]
    .filter(Boolean)
    .map(String);
}

function buildStockBadgeMarkup(stockState) {
  const toneClass =
    stockState.key === "out_of_stock"
      ? "text-red-600"
      : stockState.key === "low_stock"
        ? "text-amber-600"
        : "text-green-600";

  return `
    <span class="inline-flex items-center jdzig yymkp vd4s8 ${toneClass}" data-stock-badge="true">
      <svg class="y6rh0 qpvtc" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      ${escapeHtml(stockState.label)}
      <span class="m859b f1ztf">(${stockState.stock})</span>
    </span>
  `;
}

function hydrateProductRow(row, product) {
  const rowKey = String(product.slug || product.id || product.sku || "product")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();
  const detailsHref = `./product-details.html?product=${encodeURIComponent(
    product.slug || product.id,
  )}`;
  const image = row.querySelector("img");
  const nameLink = row.querySelector('td:nth-child(2) a');
  const categoryCell = row.querySelector('td:nth-child(3) .yymkp');
  const availabilityCell = row.querySelector('td:nth-child(4) .flex.flex-wrap.g86xu.items-center.osjzw');
  const availabilityInput = row.querySelector('td:nth-child(4) input[type="checkbox"]');
  const skuCell = row.querySelector('td:nth-child(5) .yymkp');
  const priceCell = row.querySelector('td:nth-child(6) .yymkp');
  const actionLinks = row.querySelectorAll('td:nth-child(7) a');
  const dropdownButton = row.querySelector('td:nth-child(7) button[id]');
  const dropdownMenu = row.querySelector('td:nth-child(7) .hs-dropdown-menu');
  const stockState = getProductStockState(product);

  if (image) {
    if (product.imageUrl) {
      image.src = product.imageUrl;
      image.alt = "Product Image";
      image.classList.remove("hidden");
    } else {
      image.removeAttribute("src");
      image.alt = "Product Image";
    }
  }

  if (nameLink) {
    nameLink.textContent = product.name;
    nameLink.setAttribute("href", detailsHref);
  }

  if (categoryCell) {
    categoryCell.textContent = product.category;
  }

  if (availabilityInput) {
    availabilityInput.checked = Boolean(product.isAvailable);
    availabilityInput.disabled = false;
    availabilityInput.dataset.productId = product.id;
    availabilityInput.dataset.productSlug = product.slug;
    availabilityInput.dataset.productSku = product.sku;
  }

  if (availabilityCell) {
    let badge = availabilityCell.querySelector("[data-stock-badge='true']");
    if (!badge) {
      availabilityCell.insertAdjacentHTML("beforeend", buildStockBadgeMarkup(stockState));
      badge = availabilityCell.querySelector("[data-stock-badge='true']");
    } else {
      badge.outerHTML = buildStockBadgeMarkup(stockState);
    }
  }

  if (skuCell) {
    skuCell.textContent = product.sku;
  }

  if (priceCell) {
    priceCell.textContent = formatMoney(product.price);
  }

  actionLinks.forEach((link) => {
    link.setAttribute("href", detailsHref);
  });

  if (dropdownButton) {
    dropdownButton.id = `hs-pro-etwsdd-${rowKey}`;
  }

  if (dropdownMenu && dropdownButton?.id) {
    dropdownMenu.setAttribute("aria-labelledby", dropdownButton.id);
  }

  const dropdownInfo = dropdownMenu?.querySelector(".abuy9.aimp4");
  if (dropdownInfo) {
    const textBlocks = dropdownInfo.querySelectorAll("span");
    if (textBlocks[1]) {
      textBlocks[1].textContent = product.name;
    }
  }

  const infoRows = dropdownMenu?.querySelectorAll(".flex.g86xu.items-center.abuy9.aimp4.cursor-pointer.edpyz.ibg9k");
  if (infoRows?.length >= 3) {
    const valueNodes = [
      product.sku,
      formatMoney(product.price),
      String(product.stock ?? 0),
    ];
    infoRows.forEach((infoRow, index) => {
      const valueNode = infoRow.querySelector(".m859b.f1ztf");
      if (valueNode && valueNodes[index] !== undefined) {
        valueNode.textContent = valueNodes[index];
      }
    });
  }

  const downloadCta = dropdownMenu?.querySelector(".w-full.abuy9.aimp4.inline-flex");
  if (downloadCta) {
    downloadCta.textContent = "View product";
  }
}

function renderProductsIntoMockTable(products, tbody, mockMarkup) {
  if (!tbody) return;

  if (!tbody.querySelector("tr") && mockMarkup) {
    tbody.innerHTML = mockMarkup;
  }

  let rows = Array.from(tbody.querySelectorAll("tr"));

  if (!rows.length) {
    const wrapper = document.createElement("tbody");
    wrapper.innerHTML = mockMarkup.trim();
    rows = Array.from(wrapper.querySelectorAll("tr"));
    if (!rows.length) {
      tbody.innerHTML = "";
      return;
    }
    tbody.innerHTML = "";
    rows.forEach((row) => tbody.appendChild(row));
    rows = Array.from(tbody.querySelectorAll("tr"));
  }

  const templateRow = rows[0].cloneNode(true);

  while (rows.length < products.length) {
    const clonedRow = templateRow.cloneNode(true);
    tbody.appendChild(clonedRow);
    rows.push(clonedRow);
  }

  rows.forEach((row, index) => {
    const product = products[index];
    if (!product) {
      row.classList.add("hidden");
      return;
    }

    row.classList.remove("hidden");
    hydrateProductRow(row, product);
  });
}

async function initProductsPage() {
  const searchInput = document.getElementById("products-search-input");
  const title = document.getElementById("products-page-title");
  const liveStatus = document.getElementById("products-live-status");
  const tabButtons = Array.from(
    document.querySelectorAll('[id^="hs-pro-tabs-dut-item-"][role="tab"]'),
  );

  if (!searchInput || !title || !tabButtons.length) return;

  const panelMap = new Map(
    TAB_KEYS.map((tabKey) => {
      const panel =
        tabKey === "all"
          ? document.querySelector("#hs-pro-tabs-dut-all")
          : document.querySelector(`#hs-pro-tabs-dut-${tabKey}`);
      const pagination = panel?.querySelector('nav[aria-label="Pagination"]');
      const footer = pagination?.closest("div.flex.flex-wrap.g86xu.items-center.osjzw");
      return [
        tabKey,
        {
          panel,
          tbody:
            tabKey === "all"
              ? document.getElementById("products-table-body")
              : panel?.querySelector("tbody.divide-y.divide-table-line"),
          pagination:
            tabKey === "all"
              ? document.getElementById("products-pagination")
              : pagination,
          footer:
            tabKey === "all"
              ? document.getElementById("products-table-footer")
              : footer,
          count:
            tabKey === "all"
              ? document.getElementById("products-results-count") ||
                document.getElementById("products-resultats-count") ||
                document.querySelector("#products-table-footer p .at2zb")
              : footer?.querySelector("p .at2zb"),
          previousButton:
            tabKey === "all"
              ? document.getElementById("products-pagination-prev")
              : pagination?.querySelector('button[aria-label="Previous"]'),
          nextButton:
            tabKey === "all"
              ? document.getElementById("products-pagination-next")
              : pagination?.querySelector('button[aria-label="Next"]'),
          pageIndicators:
            tabKey === "all"
              ? [
                  document.getElementById("products-pagination-current"),
                  {},
                  document.getElementById("products-pagination-total"),
                ]
              : pagination?.querySelectorAll("span"),
          mockMarkup:
            (tabKey === "all"
              ? document.getElementById("products-table-body")
              : panel?.querySelector("tbody.divide-y.divide-table-line"))?.innerHTML ?? "",
        },
      ];
    }),
  );

  let isRendering = false;
  let queuedRender = false;
  let mergedProductsSnapshot = [];

  function setLiveStatus(message, tone = "muted") {
    if (!liveStatus) return;

    liveStatus.textContent = message;
    liveStatus.dataset.tone = tone;

    if (tone === "success") {
      liveStatus.style.color = "var(--color-green-600, #15803d)";
    } else if (tone === "warning") {
      liveStatus.style.color = "var(--color-amber-600, #d97706)";
    } else if (tone === "error") {
      liveStatus.style.color = "var(--color-red-600, #dc2626)";
    } else {
      liveStatus.style.color = "";
    }
  }

  function getCurrentTab() {
    const state = tableState.getState();
    return TAB_KEYS.includes(state.status) ? state.status : "all";
  }

  function syncTabButtons(currentTab) {
    tabButtons.forEach((button) => {
      const tabKey = button.id.replace("hs-pro-tabs-dut-item-", "");
      const isActive = tabKey === currentTab;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");

      TAB_KEYS.forEach((key) => {
        const config = panelMap.get(key);
        if (config?.panel) {
          config.panel.classList.toggle("hidden", key !== currentTab);
        }
      });
    });
  }

  function restoreMockPanel(config) {
    if (!config?.tbody) return;
    config.tbody.innerHTML = config.mockMarkup;
  }

  async function render() {
    if (isRendering) {
      queuedRender = true;
      return;
    }

    isRendering = true;

    try {
      const state = tableState.getState();
      const query = state.query || state.filter || "";
      const currentTab = getCurrentTab();
      const panelConfig = panelMap.get(currentTab);

      if (!panelConfig?.tbody || !panelConfig.count || !panelConfig.pagination) {
        return;
      }

      const { previousButton, nextButton, pageIndicators, tbody, count } = panelConfig;
      syncTabButtons(currentTab);
      searchInput.value = query;

      const products = await fetchSanityProducts({
        limit: 100,
        query,
      });
      setLiveStatus(
        products.length
          ? `Live Sanity products loaded: ${products.length}`
          : "Sanity is connected, but no products matched this view.",
        products.length ? "success" : "warning",
      );

      const runtimeIds = [
        ...new Set(
          products.flatMap((product) => buildRuntimeLookupKey(product)),
        ),
      ];
      let runtimeRows = [];

      try {
        runtimeRows = await fetchProductRuntimeByIds(runtimeIds, {
          table: PRODUCT_RUNTIME_TABLE,
        });
      } catch (runtimeError) {
        console.warn("Supabase runtime unavailable for products page", runtimeError);
        setLiveStatus(
          getProductRuntimeErrorMessage(
            runtimeError,
            "Live Sanity products loaded, but Supabase runtime could not be merged",
          ),
          "warning",
        );
      }

      const runtimeMap = new Map();

      runtimeRows.forEach((runtime) => {
        [runtime.sanity_product_id, runtime.product_id, runtime.slug, runtime.sku]
          .filter(Boolean)
          .forEach((key) => {
            runtimeMap.set(String(key), runtime);
          });
      });

      const mergedProducts = products.map((product) => {
        const runtime = buildRuntimeLookupKey(product)
          .map((key) => runtimeMap.get(String(key)))
          .find(Boolean);
        return mergeProductWithRuntime(product, runtime);
      });
      mergedProductsSnapshot = mergedProducts;

      const filteredProducts = filterProductsByTab(mergedProducts, currentTab);
      const totalResults = filteredProducts.length;
      const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));
      const safePage = Math.min(Math.max(Number(state.page || 1), 1), totalPages);

      if (safePage !== Number(state.page || 1)) {
        tableState.setPage(safePage);
        return;
      }

      const start = (safePage - 1) * PAGE_SIZE;
      const pageProducts = filteredProducts.slice(start, start + PAGE_SIZE);

      title.textContent = `Products (${totalResults.toLocaleString()})`;
      count.textContent = String(totalResults);
      if (pageIndicators?.length >= 3) {
        pageIndicators[0].textContent = String(safePage);
        pageIndicators[2].textContent = String(totalPages);
      }
      if (previousButton) previousButton.disabled = safePage <= 1;
      if (nextButton) nextButton.disabled = safePage >= totalPages;

      if (!pageProducts.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="cti9j edpyz yymkp f1ztf c4t4j">
              ${escapeHtml(query ? "No products match your current search." : "No products found for this tab yet.")}
            </td>
          </tr>
        `;
      } else {
        renderProductsIntoMockTable(
          pageProducts,
          tbody,
          panelConfig.mockMarkup,
        );
        if (runtimeRows.length) {
          setLiveStatus(
            "Live Sanity products loaded with Supabase runtime data.",
            "success",
          );
        }
      }

      window.HSStaticMethods?.autoInit?.();
    } catch (error) {
      console.error("Failed to render Sanity products", error);
      setLiveStatus(
        error?.message
          ? `Live products failed to load: ${error.message}`
          : "Live products failed to load.",
        "error",
      );
      const panelConfig = panelMap.get(getCurrentTab());
      restoreMockPanel(panelConfig);
    } finally {
      isRendering = false;
      if (queuedRender) {
        queuedRender = false;
        render();
      }
    }
  }

  searchInput.addEventListener("input", (event) => {
    tableState.setQuery(event.currentTarget.value.trim());
    tableState.setPage(1);
    render();
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabKey = button.id.replace("hs-pro-tabs-dut-item-", "");
      tableState.setStatus(tabKey);
      tableState.setPage(1);
      render();
    });
  });

  TAB_KEYS.forEach((tabKey) => {
    const config = panelMap.get(tabKey);
    config?.previousButton?.addEventListener("click", () => {
      if (getCurrentTab() !== tabKey) return;
      const state = tableState.getState();
      if ((state.page || 1) <= 1) return;
      tableState.setPage((state.page || 1) - 1);
      render();
    });

    config?.nextButton?.addEventListener("click", () => {
      if (getCurrentTab() !== tabKey) return;
      const state = tableState.getState();
      tableState.setPage((state.page || 1) + 1);
      render();
    });
  });

  document.addEventListener("change", async (event) => {
    const availabilityInput = event.target.closest?.('td:nth-child(4) input[type="checkbox"]');
    if (!availabilityInput) return;

    const product = mergedProductsSnapshot.find((item) => {
      return (
        String(item.id) === availabilityInput.dataset.productId ||
        String(item.slug) === availabilityInput.dataset.productSlug ||
        String(item.sku) === availabilityInput.dataset.productSku
      );
    });

    if (!product) return;

    const nextValue = availabilityInput.checked;
    availabilityInput.disabled = true;
    setLiveStatus("Saving product availability...", "muted");

    try {
      const runtime = await updateProductRuntimeAvailability(product, nextValue, {
        table: PRODUCT_RUNTIME_TABLE,
      });
      Object.assign(product, mergeProductWithRuntime(product, runtime));
      setLiveStatus("Product availability saved.", "success");
      await render();
    } catch (error) {
      availabilityInput.checked = !nextValue;
      setLiveStatus(
        getProductRuntimeErrorMessage(error, "Availability update failed"),
        "error",
      );
    } finally {
      availabilityInput.disabled = false;
    }
  });

  await render();

  const unsubscribe = subscribeToSanityProducts(() => {
    render();
  });
  const unsubscribeRuntime = subscribeToProductRuntime(
    () => {
      render();
    },
    {
      table: PRODUCT_RUNTIME_TABLE,
    },
  );

  window.addEventListener("beforeunload", () => {
    unsubscribe?.();
    unsubscribeRuntime?.();
  });
}

initProductsPage();
