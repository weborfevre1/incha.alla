// Storefront service exports
export { createCMSPageService, type CMSPageService, type CMSPage } from './cms-page';
export { createSearchService, type SearchService, type Product as SearchProduct, type SearchResult, type SearchFilters, type SearchOptions } from './search';
export { createCollectionService, type CollectionService, type Category, type CollectionDetails } from './collection';
export { createStoreService, type StoreService, type ProductDetails, type ProductVariant } from './store';
export { createCMSMenuService, type CMSMenuService, type Menu, type MenuItem } from './cms-menu';

// Supabase & Sanity service layers (ported from old services/)
export { default as supabaseService } from './supabase-service';
export {
  supabaseAuthService,
  supabaseProfileService,
  supabaseOrderService,
  supabaseCartService,
  supabaseDiscountService,
  supabaseReviewService,
} from './supabase-service';
export { default as sanityService } from './sanity-service';
export { fetchDiscounts } from './supabase-service';
