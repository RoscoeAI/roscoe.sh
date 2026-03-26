import { resolve } from "path";
import { readFile } from "fs/promises";
import { createSiteApp } from "./app.js";
import { createConsentRepositoryFromEnv } from "./consent-repository.js";

async function start() {
  const port = Number(process.env.PORT ?? 3000);
  const isProduction = process.env.NODE_ENV === "production";
  const repository = await createConsentRepositoryFromEnv();
  const app = createSiteApp(repository, {
    canonicalBaseUrl: process.env.ROSCOE_SITE_BASE_URL,
    supportEmail: process.env.ROSCOE_SITE_SUPPORT_EMAIL,
    staticRoot: resolve(process.cwd(), "dist/client"),
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      appType: "spa",
      server: { middlewareMode: true },
    });

    app.use(vite.middlewares);
    app.get(/^(?!\/api\/).*/, async (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }

      try {
        const templatePath = resolve(process.cwd(), "index.html");
        const template = await readFile(templatePath, "utf-8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
  }

  app.listen(port, () => {
    console.log(`Roscoe site listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
