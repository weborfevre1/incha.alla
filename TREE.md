# TREE

This repository is organized as a `pnpm`/Turbo monorepo with two apps and a shared `packages/` workspace.

```text
D:\inchallah
|-- apps/
|   |-- storefront/              # Customer commerce app (Vite + React)
|   |   |-- public/
|   |   |-- sanity/
|   |   |   `-- schemaTypes/
|   |   |-- src/
|   |   |   |-- adapters/
|   |   |   |-- components/
|   |   |   |-- config/
|   |   |   |-- contexts/
|   |   |   |-- data/
|   |   |   |-- hooks/
|   |   |   |-- islands/
|   |   |   |-- lib/
|   |   |   |-- pages/
|   |   |   `-- shells/
|   |   |-- index.html
|   |   |-- package.json
|   |   |-- sanity.cli.ts
|   |   |-- sanity.config.ts
|   |   |-- tailwind.config.js
|   |   |-- tsconfig.app.json
|   |   |-- tsconfig.json
|   |   |-- tsconfig.node.json
|   |   `-- vite.config.ts
|   `-- admin/                   # Seller/admin dashboard (Vite + React)
|       |-- public/
|       |-- src/
|       |   |-- components/
|       |   |-- contexts/
|       |   |-- data/
|       |   |-- hooks/
|       |   |-- lib/
|       |   |-- page-scripts/
|       |   `-- pages/
|       |-- discounts.html
|       |-- index.html
|       |-- orders.html
|       |-- package.json
|       |-- products.html
|       |-- spa.html
|       |-- tsconfig.json
|       |-- tsconfig.node.json
|       `-- vite.config.ts
|-- docs/
|-- node_modules/
|-- packages/
|   |-- auth/                    # Shared auth hooks/provider and role guards
|   |   |-- src/
|   |   |   |-- index.ts
|   |   |   `-- react.tsx
|   |   `-- package.json
|   |-- sanity/                  # Shared Sanity client and helpers
|   |   |-- src/
|   |   |   `-- index.ts
|   |   `-- package.json
|   |-- services/                # Shared storefront/admin business logic
|   |   |-- src/
|   |   |   |-- admin/
|   |   |   |-- storefront/
|   |   |   `-- index.ts
|   |   `-- package.json
|   |-- shared-types/            # Cross-app TypeScript types
|   |   |-- src/
|   |   |   `-- index.ts
|   |   `-- package.json
|   |-- supabase/                # Shared Supabase client and admin operations
|   |   |-- src/
|   |   |   |-- admin.ts
|   |   |   |-- client.ts
|   |   |   `-- index.ts
|   |   `-- package.json
|   |-- ui/                      # Shared UI package placeholder
|   |   |-- src/
|   |   |   `-- index.ts
|   |   `-- package.json
|   `-- utils/                   # Logger and shared utilities
|       |-- src/
|       |   |-- index.ts
|       |   `-- logger.ts
|       `-- package.json
|-- .env.local
|-- .gitignore
|-- README.md
|-- TREE.md
|-- package.json
|-- pnpm-lock.yaml
|-- pnpm-workspace.yaml
|-- tsconfig.base.json
|-- tsconfig.json
`-- turbo.json
```

## Runtime Notes

### Storefront
- Dev server: `http://127.0.0.1:3000`
- Entry: `apps/storefront/index.html -> apps/storefront/src/main.tsx`
- Vite aliases shared workspace packages from `packages/*`
- Proxies `/admin` to the admin app during development

### Admin
- Dev server: `http://127.0.0.1:4173`
- Entries: `index.html`, `orders.html`, `products.html`, `discounts.html`, `spa.html`
- Main SPA entry: `apps/admin/src/main.tsx`
- Served under `/admin/` in Vite build/dev config

## Shared Layers

- `packages/auth` provides `AuthProvider`, `useAuth()`, `useAuthButton()`, and `useAdminGuard()`
- `packages/supabase` provides the singleton client plus admin data helpers
- `packages/sanity` provides the shared CMS client and image/price helpers
- `packages/services` separates storefront and admin business logic
- `packages/shared-types` centralizes auth, CMS, and admin domain types
- `packages/utils` contains shared logging/utilities
- `packages/ui` exists, but is currently a placeholder rather than a full component library

## Workspace Notes

- Workspace packages are declared in `pnpm-workspace.yaml`
- Root orchestration uses Turbo via `build`, `dev`, `type-check`, and `lint`
- The repo uses `pnpm-lock.yaml` as the single workspace lockfile
