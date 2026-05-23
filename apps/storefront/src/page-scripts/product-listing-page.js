import sanityService from "@siggistore/services/storefront/sanity-service";
import {
  bindAddToCartButtons,
  bindFavoriteToggles,
  formatPrice,
  hydrateProductDataAttributes,
} from "/src/lib/store.js";

const categoryStrip = document.getElementById("product-listing-categories");
const grid = document.getElementById("product-listing-grid");
const countNode = document.getElementById("product-listing-count");
const params = new URLSearchParams(window.location.search);
const categorySlug = params.get("category");
const listingLimit = 100;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCategoryCards() {
  if (!categoryStrip) return [];
  return Array.from(categoryStrip.querySelectorAll("a"));
}

function getProductImage(product) {
  return product?.image?.asset?.url || product?.images?.[0]?.asset?.url || "";
}

function getProductHref(product) {
  return product?.slug?.current
    ? `./Product Detail.html?slug=${encodeURIComponent(product.slug.current)}`
    : "./Product Detail.html";
}

function getProductTitle(product) {
  return product?.title?.trim() || "Product";
}

function getProductCategory(product) {
  return product?.category?.title || "Product";
}

function getProductPriceMarkup(product) {
  const currency = product?.currency || "USD";
  const price = typeof product?.price === "number" ? product.price : 0;
  const nextPrice = formatPrice(price, currency);

  if (typeof product?.originalPrice === "number") {
    return `
      <p class="liwkv yymkp c4t4j">
        <span class="yymkp f1ztf"><s>${escapeHtml(formatPrice(product.originalPrice, currency))}</s></span>
        <span class="at2zb">${escapeHtml(nextPrice)}</span>
      </p>
    `;
  }

  return `<p class="liwkv at2zb yymkp c4t4j">${escapeHtml(nextPrice)}</p>`;
}

function getRatingCount(product, index) {
  const value = Number(product?.reviewCount ?? product?.reviewsCount ?? product?.ratingCount);
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  return Math.max(1, 25 - (index % 8) * 2);
}

function getReviewMarkup(product, index) {
  const filledStar =
    '<svg class="y6rh0 qpvtc c4t4j" fill="currentColor" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"></path></svg>';
  const emptyStar =
    '<svg class="y6rh0 qpvtc c4t4j" fill="currentColor" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.461 0z"></path></svg>';

  return `
    <div class="ljp3z flex items-center azl7k">
      ${filledStar.repeat(4)}
      ${emptyStar}
      <span class="duiq5 m859b c4t4j">(${getRatingCount(product, index)})</span>
    </div>
  `;
}

function buildProductCardMarkup(product, index) {
  const productId = product?._id || product?.slug?.current || `listing-product-${index}`;
  const productTitle = getProductTitle(product);
  const productCategory = getProductCategory(product);
  const productHref = getProductHref(product);
  const productImage = getProductImage(product);
  const productPrice = String(product?.price ?? 0);

  return `
    <div class="group relative"
      data-product-id="${escapeHtml(productId)}"
      data-product-title="${escapeHtml(productTitle)}"
      data-product-href="${escapeHtml(productHref)}"
      data-product-image="${escapeHtml(productImage)}"
      data-product-price="${escapeHtml(productPrice)}"
      data-product-category="${escapeHtml(productCategory)}">
      <div class="relative">
        <a class="block ictpa focus:outline-hidden" href="${escapeHtml(productHref)}">
          <img alt="${escapeHtml(productTitle)}" class="ictpa" src="${escapeHtml(productImage)}">
        </a>
        <div class="absolute bq7k1 m8htk nnhrf qqy1w wjvr4">
          <button class="ckw1y flex lp3ls items-center jdzig nj29a m859b s6i1l k0ser disabled:opacity-50 disabled:pointer-events-none focus:outline-hidden"
            type="button"
            data-favorite-toggle="true"
            data-product-id="${escapeHtml(productId)}"
            data-product-title="${escapeHtml(productTitle)}"
            data-product-href="${escapeHtml(productHref)}"
            data-product-image="${escapeHtml(productImage)}"
            data-product-price="${escapeHtml(productPrice)}"
            data-product-color="Default"
            data-product-size="${escapeHtml(productCategory)}"
            data-product-quantity="1">
            <svg class="y6rh0 xqxx6" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
            </svg>
            <span class="rfrdb">Add to favorites</span>
          </button>
        </div>
      </div>
      <a class="after:z-1 after:absolute after:inset-0" href="${escapeHtml(productHref)}"></a>
      <div class="z3wmw">
        <span class="block yymkp k80uv c4t4j">${escapeHtml(productTitle)}</span>
        <p class="vbvcb yymkp f1ztf">${escapeHtml(productCategory)}</p>
        ${getProductPriceMarkup(product)}
        ${getReviewMarkup(product, index)}
      </div>
    </div>
  `;
}

function renderEmptyProducts(message) {
  if (!grid) return;
  grid.innerHTML = `
    <div class="cti9j yymkp f1ztf c4t4j">
      ${escapeHtml(message)}
    </div>
  `;
}

function applyCategoryCards(categories) {
  const cards = getCategoryCards();
  if (!cards.length || !Array.isArray(categories) || categories.length === 0) return;

  cards.forEach((card, index) => {
    const category = categories[index];
    if (!category) return;

    const img = card.querySelector("img");
    const label = card.querySelector("span");
    const href = category?.slug?.current
      ? `./Product Listing.html?category=${encodeURIComponent(category.slug.current)}`
      : "./Product Listing.html#";

    if (img && category?.image?.asset?.url) {
      img.src = category.image.asset.url;
      img.alt = category.title || "Category Image";
    }

    if (label && category?.title) {
      label.textContent = category.title;
    }

    card.setAttribute("href", href);
  });
}

function applyProductCards(products, totalCount) {
  if (!grid) return;
  if (!Array.isArray(products) || products.length === 0) {
    renderEmptyProducts("No products found.");
    if (countNode) countNode.textContent = "0 Items";
    return;
  }

  grid.innerHTML = products.map(buildProductCardMarkup).join("");

  if (countNode) {
    const displayedCount =
      typeof totalCount === "number" && !Number.isNaN(totalCount)
        ? Math.min(products.length, totalCount)
        : products.length;
    countNode.textContent = `${displayedCount} Items`;
  }
}

async function hydrateListingPageFromSanity() {
  try {
    const [categories, listingResponse] = await Promise.all([
      sanityService.getCategories(),
      categorySlug
        ? sanityService.getProductsByCategory(categorySlug, listingLimit, 0)
        : sanityService.getProducts(listingLimit, 0).then((data) => ({
            data,
            total: Array.isArray(data) ? data.length : 0,
          })),
    ]);

    if (Array.isArray(categories) && categories.length > 0) {
      applyCategoryCards(categories);
    }

    const products = Array.isArray(listingResponse?.data)
      ? listingResponse.data
      : Array.isArray(listingResponse)
        ? listingResponse
        : [];

    if (products.length > 0) {
      applyProductCards(products, listingResponse?.total ?? products.length);
      hydrateProductDataAttributes(document);
      bindFavoriteToggles(document);
      bindAddToCartButtons(document);
    } else {
      applyProductCards([], 0);
    }
  } catch (error) {
    console.warn("Unable to hydrate Product Listing page from Sanity.", error);
    renderEmptyProducts("Products could not be loaded.");
  }
}

hydrateListingPageFromSanity();
