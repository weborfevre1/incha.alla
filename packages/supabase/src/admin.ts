/**
 * Supabase Admin Operations
 *
 * Admin-specific database operations that require elevated privileges.
 * These use the shared supabase client but perform admin-level queries.
 */
import { getSupabase, supabase } from './client';
import type { SupabaseOrder, SupabaseProfile } from '@siggistore/shared-types';

export const ORDER_STATUSES = [
  'pending', 'paid', 'processing', 'shipped', 'delivered', 'failed', 'canceled', 'cancelled', 'refunded',
] as const;

export const PRODUCT_RUNTIME_TABLE =
  import.meta.env?.VITE_SUPABASE_PRODUCTS_TABLE || 'products_runtime';

export const PRODUCT_REVIEWS_TABLE = 'product_reviews';
export const PRODUCT_REVIEW_REPLIES_TABLE = 'product_review_replies';

const DISPLAY_VARIANTS_CHANNEL_PREFIX = '__display_variants:';
const DISPLAY_META_CHANNEL_PREFIX = '__display_meta:';

function encodeDisplayVariantsChannel(variants: any[] = []) {
  try {
    return `${DISPLAY_VARIANTS_CHANNEL_PREFIX}${encodeURIComponent(JSON.stringify(variants))}`;
  } catch {
    return `${DISPLAY_VARIANTS_CHANNEL_PREFIX}%5B%5D`;
  }
}

function decodeDisplayVariantsChannel(channel: string) {
  if (!String(channel || '').startsWith(DISPLAY_VARIANTS_CHANNEL_PREFIX)) return null;

  try {
    const value = String(channel).slice(DISPLAY_VARIANTS_CHANNEL_PREFIX.length);
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function encodeDisplayMetaChannel(meta: any = {}) {
  try {
    return `${DISPLAY_META_CHANNEL_PREFIX}${encodeURIComponent(JSON.stringify(meta))}`;
  } catch {
    return `${DISPLAY_META_CHANNEL_PREFIX}%7B%7D`;
  }
}

function decodeDisplayMetaChannel(channel: string) {
  if (!String(channel || '').startsWith(DISPLAY_META_CHANNEL_PREFIX)) return null;

  try {
    const value = String(channel).slice(DISPLAY_META_CHANNEL_PREFIX.length);
    const parsed = JSON.parse(decodeURIComponent(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function splitRuntimeChannels(channels: any[] = []) {
  const visibleChannels: string[] = [];
  let displayVariants: any[] | null = null;
  let displayMeta: any = null;

  (Array.isArray(channels) ? channels : []).forEach((channel) => {
    const meta = decodeDisplayMetaChannel(String(channel));
    if (meta) {
      displayMeta = meta;
      return;
    }
    const decoded = decodeDisplayVariantsChannel(String(channel));
    if (decoded) {
      displayVariants = decoded;
      return;
    }
    if (channel) visibleChannels.push(String(channel));
  });

  return { visibleChannels, displayVariants, displayMeta };
}

function normalizeDisplayVariants(variants: any[] = []) {
  return (Array.isArray(variants) ? variants : [])
    .map((variant) => ({
      size: String(variant?.size || '').trim(),
      color: String(variant?.color || '').trim(),
      quantity: Math.max(0, Number(variant?.quantity ?? variant?.stock ?? variant?.inventory ?? 0) || 0),
    }))
    .filter((variant) => variant.size && variant.color);
}

function getDisplayVariantStock(variants: any[] = []) {
  return normalizeDisplayVariants(variants).reduce((sum, variant) => sum + variant.quantity, 0);
}

function applyRange(query: any, limit?: number, offset = 0) {
  if (typeof limit !== 'number') return query;
  const from = Math.max(0, offset);
  const to = from + Math.max(0, limit) - 1;
  return query.range(from, to);
}

function isMissingTableError(error: any, tableName: string) {
  const qualified = `public.${tableName}`;
  const details = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .map(String)
    .join(' ');

  return (
    error?.code === '42P01' ||
    new RegExp(`Could not find the table ['"]?${qualified}['"]? in the schema cache`, 'i').test(details) ||
    new RegExp(`relation ['"]?${qualified}['"]? does not exist`, 'i').test(details) ||
    new RegExp(`relation ['"]?${tableName}['"]? does not exist`, 'i').test(details)
  );
}

function normalizeOrder(row: any): SupabaseOrder {
  if (!row) return row;
  return {
    ...row,
    user_id: row.user_id ?? row.customer_id ?? null,
    total_amount: Number(row.total_amount ?? row.total ?? 0),
    status: row.status ?? 'pending',
    currency: row.currency ?? 'USD',
    items: row.items ?? row.order_items ?? [],
  };
}

function normalizeCustomer(row: any) {
  if (!row) return row;
  return {
    ...row,
    user_id: row.user_id ?? row.id ?? null,
    name:
      row.name ||
      [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
      row.email ||
      'Unknown customer',
  };
}

function normalizeProductRuntime(row: any) {
  if (!row) return row;
  const { visibleChannels, displayVariants, displayMeta } = splitRuntimeChannels(row.channels);
  const normalizedDisplayVariants = normalizeDisplayVariants(
    Array.isArray(row.display_variants)
      ? row.display_variants
      : Array.isArray(row.variants)
        ? row.variants
        : displayVariants || [],
  );
  const variantStock = getDisplayVariantStock(normalizedDisplayVariants);
  const stock = normalizedDisplayVariants.length
    ? variantStock
    : row.stock == null ? Number(row.inventory ?? 0) || 0 : Number(row.stock) || 0;
  return {
    ...row,
    sanity_product_id:
      row.sanity_product_id ?? row.product_id ?? row.sanity_id ?? row.slug ?? null,
    price: row.price == null ? null : Number(row.price),
    compare_at_price: row.compare_at_price == null ? null : Number(row.compare_at_price),
    stock,
    sales_count: Number(row.sales_count ?? 0) || 0,
    status: row.status || 'publish',
    is_available:
      normalizedDisplayVariants.length
        ? variantStock > 0
        : row.is_available === undefined || row.is_available === null
        ? true
        : Boolean(row.is_available),
    channels: visibleChannels,
    display_variants: normalizedDisplayVariants,
    display_category: row.display_category || displayMeta?.category || null,
  };
}

async function safeProductRuntimeQuery<T>(executor: () => Promise<T>): Promise<T> {
  try {
    return await executor();
  } catch (error: any) {
    if (
      error?.code === '42P01' ||
      error?.message?.includes('relation') ||
      error?.message?.includes('does not exist')
    ) {
      return [] as unknown as T;
    }
    throw error;
  }
}

// ===== ORDERS =====

export async function fetchOrders(options: any = {}) {
  const { limit, offset, status, from, to, query: search } = options;
  let request = supabase.from('orders').select('*').order('created_at', { ascending: false });

  if (status && status !== 'all') {
    request = request.eq('status', status);
  }
  if (from) request = request.gte('created_at', from);
  if (to) request = request.lte('created_at', to);
  if (search) {
    request = request.or(
      `id.ilike.%${search}%,user_id.ilike.%${search}%,customer_id.ilike.%${search}%`,
    );
  }
  request = applyRange(request, limit, offset);

  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []).map(normalizeOrder);
}

export async function fetchOrderById(orderId: string) {
  const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (error) throw error;
  return normalizeOrder(data);
}

export async function updateOrderStatus(orderId: string, status: string) {
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('orders')
    .update({ status, updated_at: updatedAt })
    .eq('id', orderId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new Error(`Order ${orderId} was not found in Supabase.`);
  }
  return normalizeOrder({
    id: orderId,
    status,
    updated_at: updatedAt,
  });
}

export async function deleteOrder(orderId: string) {
  const { error } = await supabase.from('orders').delete().eq('id', orderId);
  if (error) throw error;
  return { id: orderId };
}

// ===== CUSTOMERS =====

export async function fetchCustomers(options: any = {}) {
  const { limit, offset, from, to, query: search } = options;
  let request = supabase.from('customers').select('*').order('created_at', { ascending: false });

  if (from) request = request.gte('created_at', from);
  if (to) request = request.lte('created_at', to);
  if (search) {
    request = request.or(
      `email.ilike.%${search}%,name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
    );
  }
  request = applyRange(request, limit, offset);

  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []).map(normalizeCustomer);
}

export async function fetchProfilesByIds(ids: string[] = []) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('profiles').select('*').in('id', ids);
  if (error) throw error;
  return data ?? [];
}

export async function fetchOrdersSince(sinceIso: string) {
  return fetchOrders({ from: sinceIso });
}

export async function fetchOrdersBetween(startIso: string, endIso: string) {
  return fetchOrders({ from: startIso, to: endIso });
}

export async function fetchCustomersBetween(startIso: string, endIso: string) {
  return fetchCustomers({ from: startIso, to: endIso });
}

export async function fetchCustomersByIds(ids: string[] = []) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('customers').select('*').in('id', ids);
  if (error) throw error;
  return (data ?? []).map(normalizeCustomer);
}

export async function fetchOrderItemsByOrderIds(orderIds: string[] = []) {
  if (!orderIds.length) return [];
  const { data, error } = await supabase.from('order_items').select('*').in('order_id', orderIds);
  if (error) throw error;
  return data ?? [];
}

// ===== PRODUCTS =====

export async function fetchProductRuntime(options: any = {}) {
  const { limit, offset, ids = [], status, query: search, table = PRODUCT_RUNTIME_TABLE } = options;

  return safeProductRuntimeQuery(async () => {
    const normalizedIds = [...new Set(ids.filter(Boolean).map(String))];
    let request = supabase
      .from(table)
      .select('*')
      .order('updated_at', { ascending: false, nullsFirst: false });

    if (status && status !== 'all') {
      request = request.eq('status', status);
    }
    if (search) {
      request = request.or(
        `sanity_product_id.ilike.%${search}%,product_id.ilike.%${search}%,slug.ilike.%${search}%,sku.ilike.%${search}%`,
      );
    }
    request = applyRange(request, limit, offset);

    const { data, error } = await request;
    if (error) throw error;

    const normalizedRows = (data ?? []).map(normalizeProductRuntime);
    if (!normalizedIds.length) return normalizedRows;

    return normalizedRows.filter((row: any) =>
      [row.sanity_product_id, row.product_id, row.slug, row.sku]
        .filter(Boolean)
        .some((value: string) => normalizedIds.includes(String(value))),
    );
  });
}

export async function fetchProductRuntimeByIds(ids = [], options = {}) {
  if (!ids.length) return [];
  return fetchProductRuntime({
    ...options,
    ids,
  });
}

export async function updateProductRuntimeAvailability(product: any, isAvailable: boolean, options: any = {}) {
  const table = options.table || PRODUCT_RUNTIME_TABLE;
  const nextAvailability = Boolean(isAvailable);
  const identifiers = {
    sanity_product_id: product?.runtime?.sanity_product_id || product?.id || null,
    product_id: product?.runtime?.product_id || null,
    slug: product?.slug || null,
    sku: product?.sku || null,
  };

  const payload = {
    ...identifiers,
    stock: Math.max(0, Number(product?.stock ?? 0) || 0),
    status: nextAvailability ? 'publish' : 'unpublish',
    is_available: nextAvailability,
    updated_at: new Date().toISOString(),
  };

  if (product?.runtime?.id) {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', product.runtime.id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeProductRuntime(data);
  }

  const { data, error } = await supabase.from(table).insert(payload).select('*').single();
  if (error) throw error;
  return normalizeProductRuntime(data);
}

export async function updateProductRuntimeDisplay(product: any, display: any = {}, options: any = {}) {
  const table = options.table || PRODUCT_RUNTIME_TABLE;
  const variants = normalizeDisplayVariants(display.variants);
  const tags = Array.isArray(display.tags) ? display.tags.filter(Boolean).map(String) : [];
  const stock = getDisplayVariantStock(variants);
  const nextAvailability = stock > 0;
  const identifiers = {
    sanity_product_id: product?.runtime?.sanity_product_id || product?.id || null,
    product_id: product?.runtime?.product_id || null,
    slug: product?.slug || null,
    sku: product?.sku || null,
  };
  const payload = {
    ...identifiers,
    stock,
    status: nextAvailability ? 'publish' : 'unpublish',
    is_available: nextAvailability,
    channels: [
      ...tags,
      encodeDisplayMetaChannel({ category: display.category || null }),
      encodeDisplayVariantsChannel(variants),
    ],
    updated_at: new Date().toISOString(),
  };

  if (product?.runtime?.id) {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', product.runtime.id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeProductRuntime(data);
  }

  const { data, error } = await supabase.from(table).insert(payload).select('*').single();
  if (error) throw error;
  return normalizeProductRuntime(data);
}

export function mergeProductWithRuntime(product: any, runtime: any) {
  if (!runtime) return product;
  const displayVariants = normalizeDisplayVariants(runtime.display_variants);
  const variantStock = getDisplayVariantStock(displayVariants);
  const hasDisplayVariants = displayVariants.length > 0;
  return {
    ...product,
    runtime,
    sku: runtime.sku || product.sku,
    price: runtime.price == null || Number.isNaN(runtime.price) ? product.price : runtime.price,
    compareAtPrice:
      runtime.compare_at_price == null || Number.isNaN(runtime.compare_at_price)
        ? product.compareAtPrice
        : runtime.compare_at_price,
    stock: hasDisplayVariants
      ? variantStock
      : runtime.stock == null || Number.isNaN(runtime.stock) ? product.stock : runtime.stock,
    status: runtime.status || product.status,
    isAvailable:
      hasDisplayVariants
        ? variantStock > 0
        : runtime.is_available === undefined || runtime.is_available === null
        ? product.isAvailable
        : Boolean(runtime.is_available),
    channels:
      Array.isArray(runtime.channels) && runtime.channels.length
        ? runtime.channels
        : product.channels,
    displayVariants:
      hasDisplayVariants
        ? displayVariants
        : product.displayVariants,
    displayCategory: runtime.display_category || product.displayCategory,
    salesCount: Number(runtime.sales_count ?? product.salesCount ?? 0) || 0,
    featured: runtime.featured === undefined ? Boolean(product.featured) : Boolean(runtime.featured),
  };
}

export function getProductStockState(product: any, options: any = {}) {
  const lowStockThreshold = Number(options.lowStockThreshold ?? 5);
  const stock = Math.max(0, Number(product?.stock ?? 0) || 0);
  const isAvailable = Boolean(product?.isAvailable);

  if (!isAvailable || stock <= 0) {
    return { key: 'out_of_stock', label: 'Out of stock', stock };
  }
  if (stock <= lowStockThreshold) {
    return { key: 'low_stock', label: 'Low in stock', stock };
  }
  return { key: 'in_stock', label: 'In stock', stock };
}

// ===== DISCOUNTS =====

export async function fetchDiscounts(options: any = {}) {
  const { limit, offset, status, query: search } = options;
  let request = supabase.from('discounts').select('*').order('created_at', { ascending: false });

  if (status && status !== 'all') {
    request = request.eq('status', status);
  }
  if (search) {
    request = request.or(`code.ilike.%${search}%,type.ilike.%${search}%`);
  }
  request = applyRange(request, limit, offset);

  const { data, error } = await request;
  if (error) {
    if (isMissingDiscountsTableError(error)) {
      console.warn('[supabase-admin] public.discounts is missing; returning an empty discount list.');
      return [];
    }
    throw error;
  }
  return data ?? [];
}

function isMissingDiscountsTableError(error: any) {
  return isMissingTableError(error, 'discounts');
}

function parseMissingColumn(error: any) {
  const details = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .map(String)
    .join(' ');

  const patterns = [
    /column ["']?([a-zA-Z0-9_]+)["']? does not exist/i,
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i,
    /schema cache.*column ['"]([a-zA-Z0-9_]+)['"]/i,
  ];

  for (const pattern of patterns) {
    const match = details.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

export async function createDiscount(input: any = {}) {
  const now = new Date().toISOString();
  const value = Number(input.value ?? input.amount ?? 0);

  if (!input.name || !String(input.name).trim()) {
    throw new Error('Discount name is required.');
  }
  if (!input.code || !String(input.code).trim()) {
    throw new Error('Discount code is required.');
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Discount amount must be greater than 0.');
  }

  const payload: Record<string, any> = {
    name: String(input.name).trim(),
    title: String(input.name).trim(),
    code: String(input.code).trim().toUpperCase(),
    status: String(input.status ?? 'draft').toLowerCase(),
    type: String(input.type ?? 'percent').toLowerCase(),
    value,
    amount: value,
    scope: String(input.scope ?? 'global'),
    applies_to: String(input.scope ?? 'global'),
    usage_count: Number(input.usage_count ?? 0) || 0,
    updated_at: now,
    created_at: input.created_at ?? now,
  };

  if (input.starts_at) payload.starts_at = input.starts_at;
  if (input.ends_at) payload.ends_at = input.ends_at;

  const usageLimit = Number(input.usage_limit);
  if (Number.isFinite(usageLimit) && usageLimit > 0) {
    payload.usage_limit = usageLimit;
  }

  const triedMissingColumns = new Set<string>();

  while (true) {
    const { data, error } = await supabase
      .from('discounts')
      .insert(payload)
      .select('*')
      .single();

    if (!error) return data;

    if (isMissingDiscountsTableError(error)) {
      throw new Error(
        'The Supabase table public.discounts does not exist yet. Create it before using discount creation.',
      );
    }

    const missingColumn = parseMissingColumn(error);
    if (!missingColumn || !(missingColumn in payload) || triedMissingColumns.has(missingColumn)) {
      throw error;
    }

    triedMissingColumns.add(missingColumn);
    delete payload[missingColumn];
  }
}

export async function deleteDiscount(discountId: string) {
  const { error } = await supabase.from('discounts').delete().eq('id', discountId);

  if (error) throw error;

  return { id: discountId };
}

// ===== PRODUCT REVIEWS =====

function normalizeProductReview(row: any) {
  if (!row) return row;

  return {
    ...row,
    rating: Math.max(1, Math.min(5, Number(row.rating ?? 5) || 5)),
    helpful_yes: Number(row.helpful_yes ?? 0) || 0,
    helpful_no: Number(row.helpful_no ?? 0) || 0,
    product_slug: row.product_slug ?? row.slug ?? '',
    product_title_snapshot: row.product_title_snapshot ?? row.title ?? '',
    product_image_snapshot: row.product_image_snapshot ?? row.image ?? '',
    customer_name: row.customer_name ?? row.nickname ?? 'Guest',
    customer_email: row.customer_email ?? row.email ?? '',
    recommendation: row.recommendation === 'no' ? 'no' : 'yes',
    status: row.status ?? 'pending',
  };
}

function normalizeProductReviewReply(row: any) {
  if (!row) return row;

  return {
    ...row,
    body: row.body ?? row.content ?? '',
  };
}

export async function fetchProductReviewReplies(reviewIds: string[] = []) {
  const normalizedIds = [...new Set((reviewIds || []).filter(Boolean).map(String))];
  if (!normalizedIds.length) return [];

  const { data, error } = await supabase
    .from(PRODUCT_REVIEW_REPLIES_TABLE)
    .select('*')
    .in('review_id', normalizedIds)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error, PRODUCT_REVIEW_REPLIES_TABLE)) {
      console.warn(
        `[supabase-admin] public.${PRODUCT_REVIEW_REPLIES_TABLE} is missing; returning an empty review reply list.`,
      );
      return [];
    }
    throw error;
  }

  return (data ?? []).map(normalizeProductReviewReply);
}

export async function fetchProductReviews(options: any = {}) {
  const {
    limit,
    offset,
    status,
    productSlug,
    productTitle,
    includeReplies = false,
    query: search,
  } = options;

  let request = supabase
    .from(PRODUCT_REVIEWS_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (status && status !== 'all') {
    request = request.eq('status', status);
  }
  if (productSlug) {
    request = request.eq('product_slug', productSlug);
  } else if (productTitle) {
    request = request.eq('product_title_snapshot', productTitle);
  }
  if (search) {
    request = request.or(
      `headline.ilike.%${search}%,body.ilike.%${search}%,customer_name.ilike.%${search}%,customer_email.ilike.%${search}%,product_title_snapshot.ilike.%${search}%`,
    );
  }
  request = applyRange(request, limit, offset);

  const { data, error } = await request;
  if (error) {
    if (isMissingTableError(error, PRODUCT_REVIEWS_TABLE)) {
      console.warn(
        `[supabase-admin] public.${PRODUCT_REVIEWS_TABLE} is missing; returning an empty review list.`,
      );
      return [];
    }
    throw error;
  }

  const reviews = (data ?? []).map(normalizeProductReview);
  if (!includeReplies || !reviews.length) return reviews;

  const replies = await fetchProductReviewReplies(reviews.map((review: any) => review.id));
  const repliesByReviewId = replies.reduce((map: Record<string, any[]>, reply: any) => {
    const key = String(reply.review_id || '');
    if (!key) return map;
    if (!Array.isArray(map[key])) map[key] = [];
    map[key].push(reply);
    return map;
  }, {});

  return reviews.map((review: any) => {
    const reviewReplies = repliesByReviewId[String(review.id)] || [];
    return {
      ...review,
      replies: reviewReplies,
      latest_reply: reviewReplies[0] || null,
    };
  });
}

export async function createProductReview(input: any = {}) {
  const now = new Date().toISOString();
  const rating = Math.max(1, Math.min(5, Number(input.rating ?? 5) || 5));
  const payload = {
    product_slug: String(input.product_slug ?? input.slug ?? '').trim(),
    sanity_product_id: String(input.sanity_product_id ?? '').trim() || null,
    product_title_snapshot: String(
      input.product_title_snapshot ?? input.title ?? input.product_title ?? '',
    ).trim(),
    product_image_snapshot: String(
      input.product_image_snapshot ?? input.image ?? input.product_image ?? '',
    ).trim(),
    customer_id: input.customer_id ?? null,
    customer_name: String(input.customer_name ?? input.nickname ?? '').trim(),
    customer_email: String(input.customer_email ?? input.email ?? '').trim(),
    rating,
    recommendation: String(input.recommendation ?? 'yes').trim().toLowerCase() === 'no' ? 'no' : 'yes',
    headline: String(input.headline ?? '').trim(),
    body: String(input.body ?? '').trim(),
    status: String(input.status ?? 'pending').trim().toLowerCase(),
    helpful_yes: Number(input.helpful_yes ?? 0) || 0,
    helpful_no: Number(input.helpful_no ?? 0) || 0,
    created_at: input.created_at ?? now,
    updated_at: now,
  };

  if (!payload.product_title_snapshot) {
    throw new Error('Review product title is required.');
  }
  if (!payload.customer_name) {
    throw new Error('Reviewer name is required.');
  }
  if (!payload.customer_email) {
    throw new Error('Reviewer email is required.');
  }
  if (!payload.headline) {
    throw new Error('Review headline is required.');
  }
  if (!payload.body) {
    throw new Error('Review body is required.');
  }

  const { data, error } = await supabase.from(PRODUCT_REVIEWS_TABLE).insert(payload).select('*').single();

  if (error) {
    if (isMissingTableError(error, PRODUCT_REVIEWS_TABLE)) {
      throw new Error(
        `The Supabase table public.${PRODUCT_REVIEWS_TABLE} does not exist yet. Create it before using product reviews.`,
      );
    }
    throw error;
  }

  return normalizeProductReview(data);
}

export async function updateProductReviewStatus(reviewId: string, status: string) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!reviewId) throw new Error('Review id is required.');
  if (!normalizedStatus) throw new Error('Review status is required.');

  const { data, error } = await supabase
    .from(PRODUCT_REVIEWS_TABLE)
    .update({
      status: normalizedStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reviewId)
    .select('*')
    .single();

  if (error) throw error;
  return normalizeProductReview(data);
}

export async function deleteProductReview(reviewId: string) {
  if (!reviewId) throw new Error('Review id is required.');

  const { error } = await supabase.from(PRODUCT_REVIEWS_TABLE).delete().eq('id', reviewId);
  if (error) throw error;
}

export async function createProductReviewReply(input: any = {}) {
  const payload = {
    review_id: input.review_id ?? input.reviewId ?? null,
    admin_id: input.admin_id ?? input.adminId ?? null,
    body: String(input.body ?? input.content ?? '').trim(),
  };

  if (!payload.review_id) {
    throw new Error('Review reply requires a review id.');
  }
  if (!payload.body) {
    throw new Error('Reply body is required.');
  }

  const { data, error } = await supabase
    .from(PRODUCT_REVIEW_REPLIES_TABLE)
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    if (isMissingTableError(error, PRODUCT_REVIEW_REPLIES_TABLE)) {
      throw new Error(
        `The Supabase table public.${PRODUCT_REVIEW_REPLIES_TABLE} does not exist yet. Create it before using product review replies.`,
      );
    }
    throw error;
  }

  await supabase
    .from(PRODUCT_REVIEWS_TABLE)
    .update({ updated_at: new Date().toISOString() })
    .eq('id', payload.review_id);

  return normalizeProductReviewReply(data);
}

// ===== CONVERSATIONS =====

export async function fetchConversations(options: any = {}) {
  const { limit, offset, query: search } = options;
  let request = supabase
    .from('conversations')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (search) {
    request = request.or(
      `id.ilike.%${search}%,customer_id.ilike.%${search}%,last_message.ilike.%${search}%`,
    );
  }
  request = applyRange(request, limit, offset);

  const { data, error } = await request;
  if (error) throw error;
  return data ?? [];
}

export async function fetchMessages(conversationId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(payload: {
  conversationId: string;
  senderId?: string | null;
  senderRole: string;
  content: string;
}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: payload.conversationId,
      sender_id: payload.senderId,
      sender_role: payload.senderRole,
      content: payload.content,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// ===== METRICS =====

export async function getOverviewMetrics(options: any = {}) {
  const { recentLimit = 10, rangeDays = 30 } = options;
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - rangeDays);

  const [orders, customers] = await Promise.all([
    fetchOrders({ from: sinceDate.toISOString(), limit: 500 }),
    fetchCustomers({ from: sinceDate.toISOString(), limit: 500 }),
  ]);

  const revenue = orders.reduce((sum: number, order: SupabaseOrder) => sum + Number(order.total_amount ?? 0), 0);
  const pendingOrders = orders.filter((o: SupabaseOrder) => o.status === 'pending');
  const failedOrders = orders.filter((o: SupabaseOrder) => o.status === 'failed');
  const refundedOrders = orders.filter((o: SupabaseOrder) => o.status === 'refunded');

  return {
    metrics: {
      revenue,
      orders: orders.length,
      customers: customers.length,
      averageOrderValue: orders.length ? revenue / orders.length : 0,
      pendingOrders: pendingOrders.length,
      failedOrders: failedOrders.length,
      refundedOrders: refundedOrders.length,
    },
    recentOrders: orders.slice(0, recentLimit),
    recentCustomers: customers.slice(0, recentLimit),
  };
}

export function getOrderTotal(order: any) {
  return Number(order?.total_amount ?? order?.total ?? 0);
}

export function getOrderItemUnitPrice(item: any) {
  return Number(item?.price_snapshot ?? item?.price ?? 0);
}
