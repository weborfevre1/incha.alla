import {
  deleteOrder,
  fetchCustomersByIds,
  fetchOrderItemsByOrderIds,
  fetchOrders,
} from "@siggistore/services/admin";
import { subscribeToOrders } from "@siggistore/services/admin/realtime.js";
import { createTableUrlState } from "@siggistore/services/admin/table-state.js";

const PAGE_SIZE = 10;
const TAB_KEYS = ["all", "archived", "publish", "unpublish"];
const tableState = createTableUrlState({
  defaultPage: 1,
  defaultPageSize: PAGE_SIZE,
  statusParam: "status",
});
const STOREFRONT_LATEST_ORDER_KEY = "appLatestOrder";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function titleCase(value) {
  return String(value ?? "")
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getPaymentMethodDisplayLabel(method) {
  const normalized = String(method ?? "").trim().toLowerCase();
  if (normalized === "paypal") return "A la livraison";
  if (normalized === "klarna") return "A la boutique";
  if (normalized === "card") return "Par Chario";
  return method ? titleCase(method) : "-";
}

function getOrderDisplayNumber(order) {
  const raw =
    order?.displayOrderNumber ||
    order?.number ||
    order?.order_number ||
    order?.id;

  if (!raw) return "#UNKNOWN";
  const normalized = String(raw).trim();
  return normalized.startsWith("#") ? normalized : `#${normalized.toUpperCase()}`;
}

function statusMeta(rawStatus) {
  const status = String(rawStatus ?? "pending").toLowerCase();
  const label = titleCase(status);

  if (["paid", "processing", "shipped", "delivered", "completed"].includes(status)) {
    return {
      label,
      className:
        "k85d4 o8oua inline-flex items-center i220p m859b at2zb qn8tw k73c1 nj29a dark:bg-green-500/10 dark:text-green-500",
      icon: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="m9 12 2 2 4-4"></path>',
    };
  }

  if (["failed", "canceled", "cancelled", "refunded"].includes(status)) {
    return {
      label,
      className:
        "k85d4 o8oua inline-flex items-center i220p m859b at2zb olwac oz3g9 nj29a dark:bg-red-500/10 dark:text-red-500",
      icon: '<circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path>',
    };
  }

  return {
    label,
    className:
      "k85d4 o8oua inline-flex items-center i220p m859b at2zb nck10 h3ns9 nj29a",
    icon: '<path d="M12 2v6"></path><path d="M12 18v4"></path><path d="M4.93 4.93l4.24 4.24"></path><path d="m14.83 14.83 4.24 4.24"></path><path d="M2 12h6"></path><path d="M16 12h6"></path><path d="m4.93 19.07 4.24-4.24"></path><path d="m14.83 9.17 4.24-4.24"></path>',
  };
}

function filterOrdersByTab(orders, tabKey) {
  if (tabKey === "archived") {
    return orders.filter((order) =>
      ["failed", "canceled", "cancelled", "refunded"].includes(
        String(order.status ?? "").toLowerCase(),
      ),
    );
  }

  if (tabKey === "publish") {
    return orders.filter((order) =>
      ["paid", "processing", "shipped", "delivered", "completed"].includes(
        String(order.status ?? "").toLowerCase(),
      ),
    );
  }

  if (tabKey === "unpublish") {
    return orders.filter(
      (order) => String(order.status ?? "").toLowerCase() === "pending",
    );
  }

  return orders;
}

function buildEmptyRow(message, colspan = 9) {
  return `
    <tr>
      <td colspan="${colspan}" class="cti9j edpyz yymkp f1ztf c4t4j">
        ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

function readStorefrontLatestOrder() {
  try {
    const raw = window.localStorage.getItem(STOREFRONT_LATEST_ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.id) return null;
    return parsed;
  } catch (error) {
    console.warn("Unable to read latest storefront order bridge.", error);
    return null;
  }
}

function getPaymentStatusLabel(order) {
  const explicitStatus =
    order?.payment_status ||
    order?.paymentStatus ||
    order?.payment?.status ||
    order?.status;

  return explicitStatus ? titleCase(explicitStatus) : "Pending";
}

function getPhoneNumberLabel(order, customer) {
  return (
    order?.shipping_address?.phone ||
    customer?.phone ||
    order?.phone ||
    "-"
  );
}

function getPaymentMethodLabel(order) {
  const paymentMethod =
    order?.payment_method ||
    order?.paymentMethod ||
    order?.payment?.method;

  if (paymentMethod && typeof paymentMethod === "object") {
    const type = paymentMethod.type || paymentMethod.brand || "";
    const last4 =
      paymentMethod.last4 ||
      paymentMethod.last_4 ||
      paymentMethod.lastDigits;
    if (!type && !last4) return "-";
    return last4
      ? `${titleCase(type || "Card")} **** ${last4}`
      : titleCase(type);
  }

  if (typeof paymentMethod === "string" && paymentMethod.trim()) {
    return getPaymentMethodDisplayLabel(paymentMethod);
  }

  const explicitType =
    order?.payment_type ||
    order?.paymentType ||
    order?.payment_brand;
  const explicitLast4 = order?.payment_last4 || order?.last4;
  if (explicitType || explicitLast4) {
    const type = explicitType ? getPaymentMethodDisplayLabel(explicitType) : "Par Chario";
    return explicitLast4 ? `${type} **** ${explicitLast4}` : type;
  }

  return "-";
}

function getCustomerLookupKeys(order) {
  return [order?.user_id, order?.customer_id].filter(Boolean);
}

function getCustomerName(order, customer) {
  return (
    order.customerName ||
    customer.name ||
    customer.full_name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() ||
    order.shipping_address?.phone ||
    customer.phone ||
    order.email ||
    order.shipping_address?.email ||
    customer.email ||
    "Guest customer"
  );
}

function getCustomerSubtext(order, customer) {
  const value =
    order.customerSubtext ||
    order.email ||
    order.shipping_address?.email ||
    customer.email ||
    customer.phone ||
    order.shipping_address?.phone ||
    "";
  const name = getCustomerName(order, customer);
  return value && value !== name ? value : "Guest order";
}

function buildOrderView(order, customerMap, itemCountMap) {
  const customer =
    getCustomerLookupKeys(order)
      .map((key) => customerMap.get(key))
      .find(Boolean) ?? {};

  return {
    id: order.id,
    status: order.status ?? "pending",
    orderLabel: getOrderDisplayNumber(order),
    purchasedLabel: formatDate(order.created_at || order.date),
    customerName: getCustomerName(order, customer),
    customerSubtext: getCustomerSubtext(order, customer),
    paymentMethodLabel: getPaymentMethodLabel(order),
    phoneNumberLabel: getPhoneNumberLabel(order, customer),
    itemCount:
      itemCountMap.get(order.id) ??
      (Array.isArray(order.items) ? order.items.length : 0),
  };
}

function buildOrderRow(view) {
  const status = statusMeta(view.status);

  return `
    <tr>
      <td class="gmilb offh6 aimp4 xxt8a">
        <input type="checkbox" class="y6rh0 x215h robkw fsj2t ftf66 cirj5 s7mjk jw8en qgcqn checked:bg-primary-checked checked:border-primary-checked disabled:opacity-50 disabled:pointer-events-none">
      </td>
      <td class="gmilb offh6 cti9j dg39k">
        <a class="yymkp at2zb c4t4j carpj a8v2i bz0ic focus:outline-hidden ti70c" href="./order-details.html?order=${encodeURIComponent(view.id)}">
          ${escapeHtml(view.orderLabel)}
        </a>
      </td>
      <td class="gmilb offh6 cti9j dg39k">
        <span class="yymkp mnod2">${escapeHtml(view.purchasedLabel)}</span>
      </td>
      <td class="gmilb offh6 cti9j dg39k">
        <span class="${status.className}">
          <svg class="y6rh0 xqxx6" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${status.icon}
          </svg>
          ${escapeHtml(status.label)}
        </span>
      </td>
      <td class="gmilb offh6 cti9j dg39k">
        <div class="t6ue9">
          <span class="yymkp mnod2">${escapeHtml(view.customerName)}</span>
          <p class="m859b f1ztf">${escapeHtml(view.customerSubtext)}</p>
        </div>
      </td>
      <td class="gmilb offh6 cti9j dg39k">
        <span class="yymkp mnod2">${escapeHtml(view.paymentMethodLabel)}</span>
      </td>
      <td class="gmilb offh6 cti9j dg39k">
        <span class="yymkp mnod2">${escapeHtml(view.phoneNumberLabel)}</span>
      </td>
      <td class="gmilb offh6 cti9j dg39k qk13w">
        <span class="yymkp mnod2">${escapeHtml(String(view.itemCount))}</span>
      </td>
      <td class="stpxn witespace-nowrap cti9j dg39k qk13w">
        <div class="hs-dropdown [--auto-close:inside] [--placement:bottom-right] relative inline-flex">
          <button type="button" class="mxukx inline-flex lp3ls items-center my9gz edpyz s6i1l mak94 x3ljb k0ser cirj5 dduyg disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden usqtq" aria-haspopup="menu" aria-expanded="false" aria-label="Dropdown">
            <svg class="y6rh0 xqxx6" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
          <div class="hs-dropdown-menu hs-dropdown-open:opacity-100 mvv53 transition-[opacity,margin] duration opacity-0 hidden nnhrf khfq6 mak94 ocfsa ictpa p6d5j" role="menu" aria-orientation="vertical" tabindex="-1">
            <div class="i0yn8">
              <a class="w-full flex items-center h7z6o k85d4 o8oua edpyz text-[13px] j6b7h ibg9k disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden mhymu" href="./order-details.html?order=${encodeURIComponent(view.id)}">
                View
              </a>
              <button type="button" class="w-full flex items-center h7z6o k85d4 o8oua edpyz text-[13px] j6b7h ibg9k disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden mhymu" data-order-delete="${escapeHtml(view.id)}">
                Delete
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

async function initOrdersPage() {
  const activePanel = document.querySelector("#hs-pro-tabs-dut-all");
  if (!activePanel) return;

  const tableBody = activePanel.querySelector("tbody.divide-y.divide-table-line");
  const searchInput = document.querySelector('input[placeholder="Search orders"]');
  const title = document.querySelector("h1.dxw73");
  const pagination = activePanel.querySelector('nav[aria-label="Pagination"]');
  const footer = pagination?.closest("div.flex.flex-wrap.g86xu.items-center.osjzw");
  const count = footer?.querySelector("p .at2zb");
  const previousButton = pagination?.querySelector('button[aria-label="Previous"]');
  const nextButton = pagination?.querySelector('button[aria-label="Next"]');
  const pageIndicators = pagination?.querySelectorAll("span");
  const tabButtons = Array.from(
    document.querySelectorAll('[id^="hs-pro-tabs-dut-item-"][role="tab"]'),
  );

  if (!tableBody || !searchInput || !title || !count || !pagination || !previousButton || !nextButton || !pageIndicators?.length) {
    return;
  }

  let isRendering = false;
  let queuedRender = false;

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

      const panelSelector = button.getAttribute("data-hs-tab");
      if (!panelSelector) return;
      const panel = document.querySelector(panelSelector);
      if (panel) panel.classList.toggle("hidden", !isActive);
    });
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
      const pageSize = Number(state.pageSize || PAGE_SIZE);
      const page = Number(state.page || 1);

      syncTabButtons(currentTab);
      searchInput.value = query;

      const fetchedOrders = await fetchOrders({
        limit: 100,
        query,
      });
      const bridgeOrder = readStorefrontLatestOrder();
      const orders = fetchedOrders.length
        ? fetchedOrders
        : bridgeOrder
          ? [bridgeOrder]
          : [];

      const filteredOrders = filterOrdersByTab(orders, currentTab);
      const totalResults = filteredOrders.length;
      const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
      const safePage = Math.min(Math.max(page, 1), totalPages);

      if (safePage !== page) {
        tableState.setPage(safePage);
        return;
      }

      const start = (safePage - 1) * pageSize;
      const pageOrders = filteredOrders.slice(start, start + pageSize);
      const userIds = [
        ...new Set(
          pageOrders.flatMap((order) => getCustomerLookupKeys(order)),
        ),
      ];
      const orderIds = pageOrders.map((order) => order.id).filter(Boolean);

      const [customersResult, orderItemsResult] = await Promise.allSettled([
        userIds.length ? fetchCustomersByIds(userIds) : Promise.resolve([]),
        orderIds.length ? fetchOrderItemsByOrderIds(orderIds) : Promise.resolve([]),
      ]);

      const customers =
        customersResult.status === "fulfilled" ? customersResult.value : [];
      const orderItems =
        orderItemsResult.status === "fulfilled" ? orderItemsResult.value : [];

      const customerMap = new Map();
      customers.forEach((customer) => {
        if (customer.id) customerMap.set(customer.id, customer);
        if (customer.user_id) customerMap.set(customer.user_id, customer);
      });

      const itemCountMap = new Map();
      orderItems.forEach((item) => {
        const current = itemCountMap.get(item.order_id) ?? 0;
        const increment = Number(item.quantity ?? 1);
        itemCountMap.set(
          item.order_id,
          current + (Number.isFinite(increment) ? increment : 1),
        );
      });

      title.textContent = `Orders (${totalResults.toLocaleString()})`;
      count.textContent = String(totalResults);
      pageIndicators[0].textContent = String(safePage);
      pageIndicators[2].textContent = String(totalPages);
      previousButton.disabled = safePage <= 1;
      nextButton.disabled = safePage >= totalPages;

      if (!pageOrders.length) {
        tableBody.innerHTML = buildEmptyRow(
          query
            ? "No orders match your current search."
            : "No orders found for this tab yet.",
        );
      } else {
        tableBody.innerHTML = pageOrders
          .map((order) => buildOrderRow(buildOrderView(order, customerMap, itemCountMap)))
          .join("");
      }

      window.HSStaticMethods?.autoInit?.();
    } catch (error) {
      console.error("Failed to render orders page", error);
      tableBody.innerHTML = buildEmptyRow(
        "Unable to load orders right now.",
      );
      count.textContent = "0";
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

  previousButton.addEventListener("click", () => {
    const state = tableState.getState();
    if ((state.page || 1) <= 1) return;
    tableState.setPage((state.page || 1) - 1);
    render();
  });

  nextButton.addEventListener("click", () => {
    const state = tableState.getState();
    tableState.setPage((state.page || 1) + 1);
    render();
  });

  tableBody.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-order-delete]");
    if (!deleteButton) return;

    const orderId = deleteButton.getAttribute("data-order-delete");
    if (!orderId) return;

    const shouldDelete = window.confirm(`Delete order ${orderId}?`);
    if (!shouldDelete) return;

    const originalText = deleteButton.textContent;
    deleteButton.textContent = "Deleting...";
    deleteButton.disabled = true;

    try {
      await deleteOrder(orderId);
      render();
    } catch (error) {
      console.error("Failed to delete order", error);
      window.alert("Unable to delete this order right now.");
      deleteButton.textContent = originalText;
      deleteButton.disabled = false;
    }
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabKey = button.id.replace("hs-pro-tabs-dut-item-", "");
      tableState.setStatus(tabKey);
      tableState.setPage(1);
      render();
    });
  });

  const unsubscribe = subscribeToOrders(() => {
    render();
  });

  window.addEventListener("beforeunload", () => {
    unsubscribe?.();
  });

  await render();
}

initOrdersPage();
