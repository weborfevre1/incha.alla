import {
  fetchCustomersByIds,
  fetchOrderItemsByOrderIds,
  fetchOrders,
  getOrderTotal,
} from "@siggistore/services/admin";
import { subscribeToOrders } from "@siggistore/services/admin/realtime.js";
import { createTableUrlState } from "@siggistore/services/admin/table-state.js";
import demoMyOrders from "../../../storefront/src/data/my-orders.json";

const PAGE_SIZE = 10;
const TAB_KEYS = ["all", "archived", "publish", "unpublish"];
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

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
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

function statusMeta(rawStatus) {
  const status = String(rawStatus ?? "pending").toLowerCase();

  if (["paid", "processing", "shipped", "delivered", "completed"].includes(status)) {
    return {
      label: status.replace("-", " "),
      className:
        "k85d4 o8oua inline-flex items-center i220p m859b at2zb qn8tw k73c1 nj29a dark:bg-green-500/10 dark:text-green-500",
      icon: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="m9 12 2 2 4-4"></path>',
    };
  }

  if (["failed", "canceled", "cancelled", "refunded"].includes(status)) {
    return {
      label: status.replace("-", " "),
      className:
        "k85d4 o8oua inline-flex items-center i220p m859b at2zb olwac oz3g9 nj29a dark:bg-red-500/10 dark:text-red-500",
      icon: '<circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path>',
    };
  }

  return {
    label: status.replace("-", " "),
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

function inferPaymentStatus(order) {
  const explicitStatus =
    order?.payment_status ||
    order?.paymentStatus ||
    order?.payment?.status;

  if (explicitStatus) return titleCase(explicitStatus);

  const orderStatus = String(order?.status ?? "").toLowerCase();
  if (["paid", "processing", "shipped", "delivered", "completed"].includes(orderStatus)) {
    return "Paid";
  }
  if (orderStatus === "pending") return "Pending";
  if (orderStatus === "refunded") return "Refunded";
  if (["failed", "canceled", "cancelled"].includes(orderStatus)) return "Failed";

  return "Unknown";
}

function inferPaymentMethod(order, fallbackIndex = 0) {
  const paymentMethod =
    order?.payment_method ||
    order?.paymentMethod ||
    order?.payment?.method;

  if (paymentMethod && typeof paymentMethod === "object") {
    const type = paymentMethod.type || paymentMethod.brand || "Card";
    const last4 =
      paymentMethod.last4 ||
      paymentMethod.last_4 ||
      paymentMethod.lastDigits;
    return last4 ? `${titleCase(type)} **** ${last4}` : titleCase(type);
  }

  if (typeof paymentMethod === "string" && paymentMethod.trim()) {
    return titleCase(paymentMethod);
  }

  const explicitType =
    order?.payment_type ||
    order?.paymentType ||
    order?.payment_brand;
  const explicitLast4 = order?.payment_last4 || order?.last4;
  if (explicitType || explicitLast4) {
    const type = explicitType ? titleCase(explicitType) : "Card";
    return explicitLast4 ? `${type} **** ${explicitLast4}` : type;
  }

  const demoMethods = ["Visa **** 4242", "PayPal", "Apple Pay"];
  return demoMethods[fallbackIndex % demoMethods.length];
}

function getCustomerLookupKeys(order) {
  return [order?.user_id, order?.customer_id].filter(Boolean);
}

function buildDemoOrders() {
  const orders = demoMyOrders?.pageContent?.orders ?? [];

  return orders.map((order, index) => ({
    id: order.id || `demo-order-${index + 1}`,
    number: order.number || `#DEMO-${String(index + 1).padStart(4, "0")}`,
    status: String(order.status || "pending").toLowerCase(),
    created_at: order.date || null,
    total: Number(order.total ?? 0),
    total_amount: Number(order.total ?? 0),
    customerName: `Customer ${index + 1}`,
    customerSubtext: "Demo order",
    paymentMethodLabel: inferPaymentMethod(order, index),
    paymentStatusLabel:
      String(order.status || "").toLowerCase() === "delivered"
        ? "Paid"
        : titleCase(order.status || "Pending"),
    itemCount: Array.isArray(order.items) ? order.items.length : Number(order.itemCount ?? 0),
  }));
}

function buildOrderView(order, customerMap, itemCountMap, fallbackIndex = 0) {
  const customer =
    getCustomerLookupKeys(order)
      .map((key) => customerMap.get(key))
      .find(Boolean) ?? {};
  const orderId = order.id ?? order.order_id ?? `unknown-${fallbackIndex}`;

  return {
    id: order.id,
    status: order.status ?? "pending",
    orderLabel:
      order.number ||
      order.order_number ||
      `#${String(orderId).slice(0, 8).toUpperCase()}`,
    purchasedLabel: formatDate(order.created_at || order.date),
    customerName:
      order.customerName ||
      customer.name ||
      customer.full_name ||
      customer.email ||
      customer.phone ||
      "Guest customer",
    customerSubtext:
      order.customerSubtext ||
      customer.email ||
      customer.phone ||
      formatMoney(getOrderTotal(order)),
    paymentMethodLabel:
      order.paymentMethodLabel || inferPaymentMethod(order, fallbackIndex),
    paymentStatusLabel:
      order.paymentStatusLabel || inferPaymentStatus(order),
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
        <span class="yymkp mnod2">${escapeHtml(view.paymentStatusLabel)}</span>
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

      let orders = [];
      let usingDemoData = false;

      try {
        orders = await fetchOrders({
          limit: 100,
          query,
        });
      } catch (error) {
        console.error("Falling back to demo orders data", error);
        usingDemoData = true;

        const normalizedQuery = String(query || "").trim().toLowerCase();
        orders = buildDemoOrders().filter((order) => {
          if (!normalizedQuery) return true;
          return [
            order.id,
            order.number,
            order.customerName,
            order.customerSubtext,
            order.status,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value).toLowerCase().includes(normalizedQuery),
            );
        });
      }

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

      const [customersResult, orderItemsResult] = usingDemoData
        ? [
            { status: "fulfilled", value: [] },
            { status: "fulfilled", value: [] },
          ]
        : await Promise.allSettled([
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
          .map((order, index) =>
            buildOrderRow(
              buildOrderView(order, customerMap, itemCountMap, index),
            ),
          )
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
