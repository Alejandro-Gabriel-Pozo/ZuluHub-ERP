import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";

/**
 * El proveedor de imágenes de mentira del recorrido del logo (V1c): un servidor HTTP en 127.0.0.1 que hace de «res.cloudinary.com». Atiende SOLO las rutas
 * que se le programan (la transformación de logo de la carta) y todo lo demás es 404. Guarda cada pedido con sus cabeceras, para que la prueba vea qué sale
 * de la app hacia afuera: cuántos viajes y con qué cabeceras. La app lo alcanza por `conectar-proveedor-de-imagenes-simulado.mjs` (solo de pruebas).
 */
type PedidoAlProveedor = Readonly<{
  ruta: string;
  cabeceras: IncomingMessage["headers"];
  hostDelProveedor: string;
}>;

export type ProveedorDeImagenesSimulado = Readonly<{
  puerto: number;
  pedidos: PedidoAlProveedor[];
  /** Programa que esa ruta devuelve la imagen real (de ahí en más). Es un dato, no una función: nada se invoca desde un valor traído con la ruta del pedido. */
  servir(ruta: string): void;
  cerrar(): Promise<void>;
}>;

const WEBP_REAL = readFileSync(
  join(import.meta.dirname, "../../fixtures/activos/logo-carta-120.webp"),
);

/** Una imagen WebP real (120 por 120), la que el navegador sí sabe dibujar. */
const responderConElWebp = (res: ServerResponse): void => {
  res.writeHead(200, { "Content-Type": "image/webp", "Content-Length": String(WEBP_REAL.length) });
  res.end(WEBP_REAL);
};

export async function levantarProveedorDeImagenesSimulado(): Promise<ProveedorDeImagenesSimulado> {
  const pedidos: PedidoAlProveedor[] = [];
  const rutas = new Set<string>();
  const sockets = new Set<Socket>();
  const servidor = createServer((req, res) => {
    const ruta = req.url ?? "";
    pedidos.push({
      ruta,
      cabeceras: req.headers,
      hostDelProveedor: String(req.headers["x-recorrido-host"] ?? ""),
    });
    if (!rutas.has(ruta)) {
      res.writeHead(404);
      res.end();
      return;
    }
    // Un viaje lento a propósito: 20 visitas simultáneas se juntan mientras éste no vuelve.
    setTimeout(() => responderConElWebp(res), 150);
  });
  servidor.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  return {
    puerto: (servidor.address() as AddressInfo).port,
    pedidos,
    servir: (ruta) => {
      rutas.add(ruta);
    },
    cerrar: () =>
      new Promise<void>((resolver) => {
        for (const socket of sockets) socket.destroy();
        servidor.close(() => resolver());
      }),
  };
}
