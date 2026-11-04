import {
  PEDERNAL_CLAVE_CONTEXTO,
  hayClavesDeContextoInstaladas,
} from "../src/adaptadores/postgres/contexto-firmado.ts";
import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base.ts";
import {
  cargarEntorno,
  lineasDelInforme,
  type BaseDeLaClave,
} from "../src/adaptadores/vercel/cargar-entorno.ts";
import { crearClienteVercel } from "../src/adaptadores/vercel/cliente-vercel.ts";
import {
  EQUIPO_DE_VERCEL,
  leerDestino,
  leerTokenDeVercel,
  type Destino,
} from "../src/adaptadores/vercel/plan-de-variables.ts";
import {
  VARIABLE_DE_LA_CADENA,
  ejecutarInstalacionDeClave,
  leerCadenaDeDueno,
} from "./ejecutar-instalar-clave.ts";

/**
 * Lo que hace `scripts/cargar-entorno.ts`, separado de su arranque para poder probarlo con un Vercel y una base
 * falsos y capturando lo que escribe. Genera al azar y carga en Vercel (como sensibles, solo en el destino pedido y
 * SIN sobrescribir nada) las variables que no dependen del dueño; el detalle de las reglas está en
 * `src/adaptadores/vercel/cargar-entorno.ts`.
 *
 * Uso: `cargar-entorno --vercel preview` | `cargar-entorno --vercel production --confirmo production`.
 * Entorno: `PEDERNAL_VERCEL_TOKEN` (obligatorio) y `PEDERNAL_DB_MIGRACIONES` (la cadena DIRECTA del dueño de la
 * base de ese destino; sin ella la clave de contexto queda para el dueño).
 *
 * Ni la cadena, ni el token, ni ningún valor generado salen de acá: todo lo que se imprime pasa por un tapado que
 * suma cada valor apenas nace (y, en GitHub Actions, se lo entrega también al runner con `::add-mask::`, que lo
 * tapa en el resto del registro). Devuelve el código de salida: 0 todo cargado, 1 falla o quedó algo sin hacer,
 * 2 uso incorrecto.
 */

export type EntradaDeCargaDeEntornoDelComando = Readonly<{
  argumentos: readonly string[];
  entorno: Readonly<Record<string, string | undefined>>;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Una línea tal cual, sin tapar (el `::add-mask::` que lee el runner de GitHub). Solo se usa en Actions. */
  comando: (linea: string) => void;
  /** Se inyecta en las pruebas; por defecto, la base real con la cadena del dueño. */
  base?: (cadena: string) => BaseDeLaClave;
  /** Solo para el Vercel real: en las pruebas, un `fetch` falso (nunca hay red). */
  fetch?: typeof fetch;
  plazoDeVercelEnMs?: number;
  esperarEntreLecturas?: (milisegundos: number) => Promise<void>;
  bytesAlAzar?: (cuantos: number) => Uint8Array;
}>;

const USO =
  "uso: cargar-entorno --vercel <preview|production> [--confirmo production] " +
  "(production exige escribir también --confirmo production)";

function leerPedido(argumentos: readonly string[]): Destino | null {
  const [bandera, valor, confirmacion, confirmo] = argumentos;
  const destino = leerDestino(valor);
  if (bandera !== "--vercel" || destino === null) return null;
  if (destino === "preview") return argumentos.length === 2 ? destino : null;
  return argumentos.length === 4 && confirmacion === "--confirmo" && confirmo === "production"
    ? destino
    : null;
}

/** La base real: lo mismo que hace `npm run instalar-clave`, más mirar si ya hay una clave. */
function baseReal(cadena: string): BaseDeLaClave {
  return {
    async hayClavesInstaladas() {
      try {
        return { ok: true, hay: await hayClavesDeContextoInstaladas(cadena) };
      } catch (falla) {
        return { ok: false, motivo: describirFallaDeBase(falla, cadena) };
      }
    },
    async instalar(clave) {
      const lineas: string[] = [];
      const codigo = await ejecutarInstalacionDeClave({
        entorno: { [VARIABLE_DE_LA_CADENA]: cadena, [PEDERNAL_CLAVE_CONTEXTO]: clave },
        info: (linea) => lineas.push(linea),
        error: (linea) => lineas.push(linea),
      });
      return codigo === 0 ? { ok: true } : { ok: false, motivo: lineas.join(" ") };
    },
  };
}

export async function ejecutarCargaDeEntorno(
  entrada: EntradaDeCargaDeEntornoDelComando,
): Promise<number> {
  const { entorno } = entrada;
  const cadenaCruda = entorno[VARIABLE_DE_LA_CADENA]?.trim();
  // Se tapan la cadena, el token y cada valor generado (y la parte secreta de `<kid>:<hex>`).
  const tapados: string[] = [];
  const tapar = (linea: string) =>
    tapados.reduce(
      (texto, secreto) => ocultarSecretos(texto, secreto),
      ocultarSecretos(linea, cadenaCruda),
    );
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));

  const destino = leerPedido(entrada.argumentos);
  if (destino === null) {
    error(`ERROR: ${USO}`);
    return 2;
  }
  const lecturaDelToken = leerTokenDeVercel(entorno);
  if ("problema" in lecturaDelToken) {
    error(`ERROR: ${lecturaDelToken.problema}`);
    return 1;
  }
  const { token } = lecturaDelToken;
  tapados.push(token);

  // Sin cadena de la base no se instala la clave de contexto; con una cadena que no sirve, no se hace nada.
  let base: BaseDeLaClave | null = null;
  if (cadenaCruda !== undefined && cadenaCruda !== "") {
    const revisada = leerCadenaDeDueno(cadenaCruda);
    if ("problema" in revisada) {
      error(`ERROR: ${revisada.problema}`);
      return 1;
    }
    base = (entrada.base ?? baseReal)(revisada.cadena);
  }

  const cliente = crearClienteVercel({
    token,
    fetch: entrada.fetch ?? fetch,
    ...(entrada.plazoDeVercelEnMs === undefined ? {} : { plazoEnMs: entrada.plazoDeVercelEnMs }),
    ...(entrada.esperarEntreLecturas === undefined
      ? {}
      : { esperar: entrada.esperarEntreLecturas }),
  });
  info(
    `Se cargará en Vercel: ${destino.toUpperCase()} (proyecto pedernal-erp, equipo ${EQUIPO_DE_VERCEL}).`,
  );

  try {
    const informe = await cargarEntorno({
      destino,
      cliente,
      base,
      ...(entrada.bytesAlAzar === undefined ? {} : { bytesAlAzar: entrada.bytesAlAzar }),
      tapar: (secreto) => {
        tapados.push(secreto);
        if (entorno["GITHUB_ACTIONS"] === "true") entrada.comando(`::add-mask::${secreto}`);
      },
    });
    const lineas = lineasDelInforme(informe);
    for (const linea of lineas.info) info(linea);
    for (const linea of lineas.error) error(linea);
    return informe.ok ? 0 : 1;
  } catch (falla) {
    // Solo el tipo de la falla: su mensaje podría llevar algo que no debe salir.
    error(
      `ERROR inesperado (${falla instanceof Error ? falla.name : "falla"}): la corrida se cortó. ` +
        "Repetir el flujo es seguro: lo ya cargado figura como «ya existía». Si la corrida alcanzaba a instalar " +
        "la clave de contexto, avisale al dueño antes de repetir.",
    );
    return 1;
  }
}
