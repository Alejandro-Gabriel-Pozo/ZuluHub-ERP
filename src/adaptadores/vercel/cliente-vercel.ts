// Con extensión `.ts` a propósito: lo carga `scripts/migrar-base.ts` directamente con Node.
import { ocultarSecretos } from "../postgres/describir-falla-de-base.ts";
import { textoDeErrorSeguro } from "../trabajos/error-seguro.ts";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado.ts";
import {
  EQUIPO_DE_VERCEL,
  PROYECTO_DE_VERCEL,
  leerVariablesRemotas,
  type Destino,
  type VariableRemota,
} from "./plan-de-variables.ts";

/**
 * El cliente mínimo de la API REST de Vercel para las variables del proyecto `pedernal-erp`: listar,
 * escribir (siempre `sensitive`, para UN destino, con `upsert`), borrar y quitarle un destino a una
 * variable compartida. Recibe el `fetch` (en las pruebas, uno falso: no hace red por su cuenta).
 *
 * - El token viaja SOLO en el encabezado `Authorization`. Nunca en la dirección, el cuerpo ni un
 *   mensaje: lo que Vercel contesta se limpia antes de salir (el token y el valor que se estaba
 *   mandando se tapan, y `textoDeErrorSeguro` saca enlaces y tiras largas).
 * - Cada pedido tiene tiempo límite. Un pedido que no termina (red caída, Vercel colgado) es una falla
 *   `incierta`: no se sabe si Vercel llegó a aplicarlo.
 * - Las LECTURAS que fallan por algo pasajero (red, tiempo, 429, 5xx) se reintentan unas pocas veces
 *   con espera creciente. Las ESCRITURAS no se reintentan solas: una escritura incierta se declara tal
 *   cual y quien llama decide (el comando la da por no hecha y, si era una contraseña, la imprime).
 * - Un `DELETE` sobre una variable que ya no existe (404) es éxito: el resultado buscado ya se dio.
 *
 * Qué NO está confirmado contra la documentación oficial (no se pudo consultar en esta sesión; todo
 * está en `RUTAS`, en un solo lugar): la versión de cada ruta (`/v10` para listar y crear, `/v9` para
 * borrar y modificar), si la lista pagina, y la forma exacta de la respuesta de la creación. Lo que sí
 * está en el esquema de la herramienta de Vercel: `key`, `value`, `type`, `target`, `upsert` y `slug`.
 */

export const BASE_DE_LA_API = "https://api.vercel.com";
export const PLAZO_POR_DEFECTO_EN_MS = 15_000;
export const INTENTOS_DE_LECTURA = 3;
const ESPERA_ENTRE_LECTURAS_EN_MS = 500;

const RUTAS = {
  listar: `/v10/projects/${PROYECTO_DE_VERCEL}/env`,
  crear: `/v10/projects/${PROYECTO_DE_VERCEL}/env`,
  variable: (id: string) => `/v9/projects/${PROYECTO_DE_VERCEL}/env/${encodeURIComponent(id)}`,
};

export type FallaDeVercel = Readonly<{
  /** Ya limpio: se puede mostrar. */
  motivo: string;
  /** No se sabe si Vercel llegó a aplicar el pedido (red, tiempo, 429 o 5xx). */
  incierta: boolean;
}>;
export type RespuestaDeVercel<T> = Resultado<T, FallaDeVercel>;

export type ClienteDeVariables = Readonly<{
  listar: () => Promise<RespuestaDeVercel<readonly VariableRemota[]>>;
  escribir: (clave: string, valor: string, destino: Destino) => Promise<RespuestaDeVercel<null>>;
  borrar: (id: string) => Promise<RespuestaDeVercel<null>>;
  quitarDestinos: (id: string, quedan: readonly string[]) => Promise<RespuestaDeVercel<null>>;
}>;

export type OpcionesDelCliente = Readonly<{
  token: string;
  fetch: typeof fetch;
  /** Tiempo límite de cada pedido. */
  plazoEnMs?: number;
  /** Se inyecta en las pruebas para no esperar de verdad entre reintentos. */
  esperar?: (milisegundos: number) => Promise<void>;
}>;

type Pedido = Readonly<{
  metodo: "GET" | "POST" | "PATCH" | "DELETE";
  ruta: string;
  consulta?: Readonly<Record<string, string>>;
  cuerpo?: unknown;
  /** El valor que viaja en el cuerpo: se tapa si Vercel lo repite en un mensaje. */
  valor?: string;
}>;

const CODIGO_DE_ERROR = /^[A-Za-z0-9_-]{1,64}$/;

function pistaDe(estado: number): string {
  if (estado === 401 || estado === 403) {
    return "el token no sirve o no tiene permiso sobre el equipo y el proyecto";
  }
  if (estado === 404) return "no se encontró el proyecto o la variable";
  if (estado === 429) return "Vercel pidió esperar (demasiados pedidos)";
  if (estado >= 500) return "falla del lado de Vercel";
  return "Vercel rechazó el pedido";
}

export function crearClienteVercel(opciones: OpcionesDelCliente): ClienteDeVariables {
  const { token } = opciones;
  const plazo = opciones.plazoEnMs ?? PLAZO_POR_DEFECTO_EN_MS;
  const esperar =
    opciones.esperar ?? ((ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms)));

  /** Tapa el token y el valor del pedido, y saca enlaces y tiras largas. */
  const limpiar = (texto: string, valor: string | undefined): string =>
    textoDeErrorSeguro(ocultarSecretos(ocultarSecretos(texto, token), valor));

  const fallar = (motivo: string, incierta: boolean): RespuestaDeVercel<never> =>
    err({ motivo, incierta });

  async function pedir(pedido: Pedido): Promise<RespuestaDeVercel<unknown>> {
    const consulta = new URLSearchParams({ ...pedido.consulta, slug: EQUIPO_DE_VERCEL });
    const encabezados: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (pedido.cuerpo !== undefined) encabezados["Content-Type"] = "application/json";
    let respuesta: Response;
    try {
      respuesta = await opciones.fetch(`${BASE_DE_LA_API}${pedido.ruta}?${consulta.toString()}`, {
        method: pedido.metodo,
        headers: encabezados,
        ...(pedido.cuerpo === undefined ? {} : { body: JSON.stringify(pedido.cuerpo) }),
        signal: AbortSignal.timeout(plazo),
      });
    } catch (falla) {
      const porTiempo = falla instanceof Error && falla.name === "TimeoutError";
      return fallar(
        porTiempo ? "Vercel no contestó a tiempo" : "no se pudo hablar con Vercel (falla de red)",
        true,
      );
    }
    let cuerpo: unknown = null;
    try {
      cuerpo = await respuesta.json();
    } catch {
      // Sin cuerpo (o no es JSON): se decide por el estado.
    }
    if (respuesta.status === 404 && pedido.metodo === "DELETE") return ok(null);
    if (!respuesta.ok) {
      const error = (cuerpo as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      const codigo =
        typeof error?.code === "string" && CODIGO_DE_ERROR.test(error.code) ? error.code : "";
      const mensaje =
        typeof error?.message === "string" ? limpiar(error.message, pedido.valor) : "";
      const detalle = [codigo, mensaje].filter((parte) => parte !== "").join(": ");
      return fallar(
        `Vercel respondió ${respuesta.status}: ${pistaDe(respuesta.status)}${detalle === "" ? "" : ` (${detalle})`}`,
        respuesta.status === 429 || respuesta.status >= 500,
      );
    }
    return ok(cuerpo);
  }

  /** Una lectura que falla por algo pasajero se repite; otra falla se devuelve de una. */
  async function leer(pedido: Pedido): Promise<RespuestaDeVercel<unknown>> {
    let resultado = await pedir(pedido);
    for (let intento = 1; intento < INTENTOS_DE_LECTURA; intento++) {
      if (resultado.ok || !resultado.error.incierta) break;
      await esperar(ESPERA_ENTRE_LECTURAS_EN_MS * intento);
      resultado = await pedir(pedido);
    }
    return resultado;
  }

  /** Una escritura sale bien si Vercel contesta 2xx y no informa fallas dentro del cuerpo. */
  async function escribirYComprobar(pedido: Pedido): Promise<RespuestaDeVercel<null>> {
    const respuesta = await pedir(pedido);
    if (!respuesta.ok) return respuesta;
    const falladas = (respuesta.valor as { failed?: unknown } | null)?.failed;
    if (Array.isArray(falladas) && falladas.length > 0) {
      const primera = (falladas[0] as { error?: { code?: unknown } } | null)?.error?.code;
      const codigo = typeof primera === "string" && CODIGO_DE_ERROR.test(primera) ? primera : "";
      return fallar(`Vercel no aplicó el cambio${codigo === "" ? "" : ` (${codigo})`}`, false);
    }
    return ok(null);
  }

  return {
    async listar() {
      const respuesta = await leer({ metodo: "GET", ruta: RUTAS.listar });
      if (!respuesta.ok) return respuesta;
      const variables = leerVariablesRemotas(respuesta.valor);
      return variables === null
        ? fallar("Vercel contestó la lista de variables con una forma que no se entiende", false)
        : ok(variables);
    },
    escribir(clave, valor, destino) {
      return escribirYComprobar({
        metodo: "POST",
        ruta: RUTAS.crear,
        consulta: { upsert: "true" },
        cuerpo: { key: clave, value: valor, type: "sensitive", target: [destino] },
        valor,
      });
    },
    borrar(id) {
      return escribirYComprobar({ metodo: "DELETE", ruta: RUTAS.variable(id) });
    },
    quitarDestinos(id, quedan) {
      return escribirYComprobar({
        metodo: "PATCH",
        ruta: RUTAS.variable(id),
        cuerpo: { target: quedan },
      });
    },
  };
}
