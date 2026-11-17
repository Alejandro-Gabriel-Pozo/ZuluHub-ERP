import { spawn, type ChildProcess } from "node:child_process";
import { get } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Levanta la app REAL construida (`next start` sobre `apps/web`, el mismo servidor que usa Vercel) con el entorno que se le pasa. El
 * `next build` se hace antes (el CI lo reutiliza; en local, `npm run build:web`). Nada se simula acá: lo único de pruebas es el
 * módulo que conecta ARCA (`conectar-arca-simulada.mjs`), cargado con `NODE_OPTIONS` solo en ESTE proceso.
 */
export type AppReal = Readonly<{
  puerto: number;
  /** Lo que el servidor escribió en su salida y su salida de errores (para mostrarlo si algo falla). */
  registro: string[];
  detener(): Promise<void>;
}>;

const RAIZ = join(import.meta.dirname, "../../..");

/** Un puerto libre de loopback: se abre en el 0 y se suelta. */
async function puertoLibre(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const direccion = servidor.address();
  const puerto = typeof direccion === "object" && direccion !== null ? direccion.port : 0;
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  return puerto;
}

export async function levantarAppReal(
  entorno: Readonly<Record<string, string>>,
  puertoDeArca: number,
): Promise<AppReal> {
  const puerto = await puertoLibre();
  const registro: string[] = [];
  const preparado = pathToFileURL(join(import.meta.dirname, "conectar-arca-simulada.mjs")).href;
  const proceso: ChildProcess = spawn(
    process.execPath,
    [join(RAIZ, "node_modules/next/dist/bin/next"), "start", "-p", String(puerto)],
    {
      cwd: join(RAIZ, "apps/web"),
      // Entorno cerrado: solo lo que se declara acá (nada del entorno de quien corre la prueba se cuela en la app).
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: process.env["HOME"] ?? "",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: `--import ${preparado}`,
        PEDERNAL_RECORRIDO_ARCA_PUERTO: String(puertoDeArca),
        ...entorno,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const anotar = (parte: Buffer): void => {
    registro.push(parte.toString("utf8"));
  };
  proceso.stdout?.on("data", anotar);
  proceso.stderr?.on("data", anotar);
  let salio = false;
  proceso.once("exit", () => {
    salio = true;
  });

  const limite = Date.now() + 60_000;
  let estado: number;
  for (;;) {
    if (salio) throw new Error(`la app real terminó al arrancar:\n${registro.join("")}`);
    // `fetch` no sirve acá: el apoyo de ingreso de las pruebas lo reemplaza por uno que bloquea todo destino externo.
    estado = await new Promise<number>((resolver) => {
      const pedido = get(`http://127.0.0.1:${puerto}/api/salud`, (r) => {
        r.resume();
        resolver(r.statusCode ?? 0);
      });
      pedido.on("error", () => resolver(0));
    });
    if (estado === 200) break;
    if (Date.now() > limite) {
      proceso.kill("SIGKILL");
      throw new Error(
        `la app real no respondió en 60 s (último estado de /api/salud: ${estado}):\n${registro.join("")}`,
      );
    }
    await new Promise((resolver) => setTimeout(resolver, 250));
  }
  return {
    puerto,
    registro,
    detener: () =>
      new Promise<void>((resolver) => {
        if (salio) return resolver();
        proceso.once("exit", () => resolver());
        proceso.kill("SIGTERM");
        setTimeout(() => proceso.kill("SIGKILL"), 5_000).unref();
      }),
  };
}
