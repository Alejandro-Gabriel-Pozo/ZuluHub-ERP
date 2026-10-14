import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

/**
 * Un servidor HTTP en 127.0.0.1 (nunca sale de la máquina) que hace de «ARCA» en las pruebas del transporte y
 * del adaptador: recibe el POST, lo guarda y responde lo que la prueba programe, incluidas las maneras de
 * portarse mal (no contestar, mandar las cabeceras y colgarse, cortar el cuerpo a la mitad).
 */
type PedidoRecibido = Readonly<{
  metodo: string;
  ruta: string;
  cabeceras: IncomingMessage["headers"];
  cuerpo: string;
}>;

export type Manejador = (
  pedido: PedidoRecibido,
  respuesta: ServerResponse,
  peticion: IncomingMessage,
) => void;

export type ServidorFalso = Readonly<{
  url: string;
  pedidos: PedidoRecibido[];
  cerrar(): Promise<void>;
}>;

export async function servidorFalso(manejador: Manejador): Promise<ServidorFalso> {
  const pedidos: PedidoRecibido[] = [];
  const conexiones = new Set<Socket>();
  const servidor: Server = createServer((peticion, respuesta) => {
    const partes: Buffer[] = [];
    peticion.on("data", (parte: Buffer) => partes.push(parte));
    peticion.on("end", () => {
      const pedido: PedidoRecibido = {
        metodo: peticion.method ?? "",
        ruta: peticion.url ?? "",
        cabeceras: peticion.headers,
        cuerpo: Buffer.concat(partes).toString("utf8"),
      };
      pedidos.push(pedido);
      manejador(pedido, respuesta, peticion);
    });
  });
  servidor.on("connection", (socket) => {
    conexiones.add(socket);
    socket.on("close", () => conexiones.delete(socket));
  });
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    pedidos,
    cerrar: () =>
      new Promise<void>((resolver) => {
        for (const socket of conexiones) socket.destroy();
        servidor.close(() => resolver());
      }),
  };
}

/** Un puerto de loopback donde NO escucha nadie (se abrió y se cerró): la conexión será rechazada. */
export async function puertoCerrado(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const { port } = servidor.address() as AddressInfo;
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  return port;
}
