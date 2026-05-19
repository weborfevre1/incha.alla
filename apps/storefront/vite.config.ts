import path from "node:path";
import fs from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { defineConfig, normalizePath, type Plugin, type ViteDevServer } from "vite";

const appRoot = path.resolve(__dirname);
const adminRoot = path.resolve(__dirname, "..", "admin");
const adminPublicRoot = path.resolve(adminRoot, "public");
const packagesRoot = path.resolve(__dirname, "..", "..", "packages");
const workspaceRoot = path.resolve(__dirname, "..", "..");
const adminPrefix = "/admin";

function toViteFsPath(filePath: string) {
  return `/@fs/${normalizePath(filePath)}`;
}

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript; charset=utf-8";
    case ".ts":
    case ".tsx":
    case ".jsx":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    default:
      return "text/plain; charset=utf-8";
  }
}

function prefixAdminAssetUrls(html: string) {
  return html
    .replace(/(src|href)=("|')\/(?!admin\/|@vite\/|@fs\/)([^"'#?]+)("|')/g, (_match, attribute, quoteStart, assetPath, quoteEnd) => {
      if (assetPath === "header.html" || assetPath === "footer.html") {
        return `${attribute}=${quoteStart}/${assetPath}${quoteEnd}`;
      }

      if (assetPath.startsWith("src/")) {
        const absoluteAssetPath = path.resolve(adminRoot, assetPath);
        return `${attribute}=${quoteStart}${toViteFsPath(absoluteAssetPath)}${quoteEnd}`;
      }

      return `${attribute}=${quoteStart}${adminPrefix}/${assetPath}${quoteEnd}`;
    })
    .replace(/url\((["']?)\/(?!admin\/)([^)"']+)\1\)/g, (_match, quote, assetPath) => {
      return `url(${quote}${adminPrefix}/${assetPath}${quote})`;
    });
}

function toSafeFilePath(root: string, relativePath: string) {
  const absolutePath = path.resolve(root, "." + relativePath);
  const normalizedRoot = normalizePath(root + path.sep);
  const normalizedAbsolute = normalizePath(absolutePath);

  if (!normalizedAbsolute.startsWith(normalizedRoot)) {
    return null;
  }

  return absolutePath;
}

async function sendFile(res: ViteDevServer["middlewares"] extends never ? never : any, filePath: string) {
  const fileContents = await fs.readFile(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", getContentType(filePath));
  res.end(fileContents);
}

function adminSoftMergePlugin(): Plugin {
  return {
    name: "siggistore-admin-soft-merge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url;
        if (!requestUrl) {
          next();
          return;
        }

        const url = new URL(requestUrl, "http://127.0.0.1");
        const pathname = decodeURIComponent(url.pathname);
        if (!pathname.startsWith(adminPrefix)) {
          next();
          return;
        }

        const adminPathname = pathname.slice(adminPrefix.length) || "/";
        const isRootRequest = adminPathname === "/";
        const rootRelativePath = isRootRequest ? "/index.html" : adminPathname;

        if (rootRelativePath.endsWith(".html")) {
          const htmlPath = toSafeFilePath(adminRoot, rootRelativePath);
          if (!htmlPath) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }

          try {
            const html = await fs.readFile(htmlPath, "utf8");
            const transformed = await server.transformIndexHtml(pathname, prefixAdminAssetUrls(html));
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(transformed);
            return;
          } catch (error) {
            next(error as Error);
            return;
          }
        }

        if (rootRelativePath.startsWith("/src/")) {
          const sourcePath = toSafeFilePath(adminRoot, rootRelativePath);
          if (!sourcePath) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }

          try {
            const transformed = await server.transformRequest(sourcePath);
            if (!transformed) {
              next();
              return;
            }

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/javascript; charset=utf-8");
            res.end(transformed.code);
            return;
          } catch (error) {
            next(error as Error);
            return;
          }
        }

        const publicPath = toSafeFilePath(adminPublicRoot, rootRelativePath);
        if (publicPath) {
          try {
            await fs.access(publicPath);
            await sendFile(res, publicPath);
            return;
          } catch {}
        }

        const rootPath = toSafeFilePath(adminRoot, rootRelativePath);
        if (rootPath) {
          try {
            await fs.access(rootPath);
            await sendFile(res, rootPath);
            return;
          } catch {}
        }

        next();
      });
    },
  };
}

export default defineConfig({
  root: appRoot,
  envDir: workspaceRoot,
  publicDir: path.resolve(appRoot, "public"),
  plugins: [react(), adminSoftMergePlugin()],
  resolve: {
    alias: {
      "@": path.resolve(appRoot, "src"),
      "@admin": path.resolve(appRoot, "..", "admin", "src"),
      // Workspace package aliases - map package name to its directory
      "@siggistore/auth": path.resolve(packagesRoot, "auth", "src"),
      "@siggistore/supabase": path.resolve(packagesRoot, "supabase", "src"),
      "@siggistore/sanity": path.resolve(packagesRoot, "sanity", "src"),
      "@siggistore/services": path.resolve(packagesRoot, "services", "src"),
      "@siggistore/shared-types": path.resolve(packagesRoot, "shared-types", "src"),
      "@siggistore/utils": path.resolve(packagesRoot, "utils", "src"),
      "@siggistore/ui": path.resolve(packagesRoot, "ui", "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(appRoot, "dist"),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: path.resolve(appRoot, "index.html"),
      },
    },
  },
});
