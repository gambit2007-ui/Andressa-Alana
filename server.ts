import express, { type NextFunction, type Request, type Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import apiHandler from "./api/[...path].ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT ?? 3000);

  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      apiHandler(req, res);
      return;
    }
    next();
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.use((error: unknown, req: Request, res: Response, next: NextFunction): void => {
    console.error("Erro nao tratado no servidor:", error);
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ error: "Erro interno do servidor." });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Falha ao iniciar servidor:", error);
  process.exit(1);
});
