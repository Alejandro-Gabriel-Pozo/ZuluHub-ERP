import {
  CODIGOS_PUBLICOS,
  errorDeCodigo,
  type Respuesta,
} from "../capacidades/experiencia/respuesta";
import type { CodigoDeSalon } from "../capacidades/experiencia/respuesta-de-salon";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";

/**
 * De un error del salón al código público que sale a la pantalla «Mesas» (ADR-016). Lista de permitidos: solo cuatro errores del dominio tienen un texto propio, los que la maqueta
 * aprobada `mesas.html` (fila «Errores del formulario» de «Textos nuevos», 09/11/2026) redacta: el número fuera de 1 a 99, el número repetido, la mesa que queda fuera del salón y la
 * que se superpone con otra (con el número de esa mesa). Cualquier OTRO error de negocio del módulo (versión vieja, mesa que no existe, con cuenta abierta, forma o tamaño inexistentes,
 * sucursal fuera de alcance, y también dos altas que se pisaron a la vez: no se sabe con qué mesa) sale como el genérico «Esta acción no está permitida» (dueño, 30/10/2026,
 * interfaz sobria). Pasan SIN CAMBIOS: los motivos del guard y los demás códigos públicos y `ERROR_DE_LA_BASE_NO_TRADUCIDO`, que es un defecto y sale como inesperado, con referencia.
 * Previene: que un error del salón salga como un fallo inesperado, o que un defecto de la base se disfrace de «no permitido». Chequeo: `errores-de-salon.test.ts`.
 */

const CON_TEXTO_PROPIO: Readonly<Record<string, CodigoDeSalon>> = {
  NUMERO_DE_MESA_INVALIDO: "SALON_NUMERO_DE_MESA_INVALIDO",
  NUMERO_DE_MESA_EN_USO: "SALON_NUMERO_DE_MESA_EN_USO",
  MESA_FUERA_DEL_SALON: "SALON_MESA_FUERA_DEL_SALON",
  // Unir mesas (SAL-E1): dos motivos con texto aprobado; el resto de los rechazos de la unión sale como «No se pueden unir», sin motivo.
  MESA_LIBRE: "SALON_UNIR_MESA_LIBRE",
  MESA_CON_COBRO: "SALON_UNIR_LA_MESA_YA_TIENE_UN_COBRO",
  MISMA_CUENTA: "SALON_UNIR_NO_SE_PUEDEN_UNIR",
  SUCURSAL_DISTINTA: "SALON_UNIR_NO_SE_PUEDEN_UNIR",
  MESA_UNIDA: "SALON_UNIR_NO_SE_PUEDEN_UNIR",
  MESA_DIVIDIDA: "SALON_UNIR_NO_SE_PUEDEN_UNIR",
};

const DEFECTO_DE_LA_BASE = "ERROR_DE_LA_BASE_NO_TRADUCIDO";
const GENERICO = { codigo: "CATALOGO_ACCION_NO_PERMITIDA" } as const;

/** Motivos de «unir» que en «dividir» no significan lo mismo: «dividir» los sale como el genérico (interfaz sobria; la pantalla ya no ofrece lo que no se puede). */
const MOTIVOS_DE_UNIR_QUE_NO_SON_DE_DIVIDIR: ReadonlySet<string> = new Set([
  "MESA_LIBRE",
  "MESA_CON_COBRO",
  "MISMA_CUENTA",
  "SUCURSAL_DISTINTA",
  "MESA_UNIDA",
  "MESA_DIVIDIDA",
]);
export const errorDeDividir = (error: unknown): unknown =>
  typeof error === "string" && MOTIVOS_DE_UNIR_QUE_NO_SON_DE_DIVIDIR.has(error) ? GENERICO : error;

export function traducirErrorDeSalon(error: unknown): unknown {
  if (typeof error === "string") {
    if (Object.hasOwn(CON_TEXTO_PROPIO, error)) return { codigo: CON_TEXTO_PROPIO[error] };
    if (Object.hasOwn(CODIGOS_PUBLICOS, error) || error === DEFECTO_DE_LA_BASE) return error;
    return GENERICO;
  }
  if (typeof error === "object" && error !== null) {
    const { error: nombre, numeros } = error as { error?: unknown; numeros?: unknown };
    if (nombre === "MESA_SUPERPUESTA") {
      const primera = Array.isArray(numeros) ? (numeros as unknown[])[0] : undefined;
      return typeof primera === "number" && Number.isSafeInteger(primera) && primera > 0
        ? {
            codigo: "SALON_MESA_SUPERPUESTA" satisfies CodigoDeSalon,
            parametros: { numero: String(primera) },
          }
        : GENERICO;
    }
    // Un error de negocio con nombre y forma de objeto: también el genérico. La base trae `tipo`, no `error`.
    if (typeof nombre === "string") return GENERICO;
  }
  return error;
}

/** El genérico del salón ya como respuesta: un pedido sin la forma pedida, sin sucursal con la que trabajar, o de una mesa, cuenta o impresora que no es de esa sucursal. */
export const respuestaGenericaDeSalon = (): Respuesta<never> => ({
  ok: false,
  error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"),
});

/**
 * Lo que tienen en común las acciones web del salón y de las comandas: sin sucursal de trabajo (`""`) cierra (nunca «todas»), un pedido sin la forma pedida es el genérico, `hacer` corre
 * el caso de uso (o devuelve `null` si lo pedido no es de la sucursal: el genérico, igual que si no existiera) y el resultado se traduce con `traducirErrorDeSalon`. Una excepción sale sin detalle y con
 * referencia. Un solo lugar, igual que `accionDeVentas`.
 */
export async function accionDelSalon<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  sucursalId: string,
  crudo: unknown,
  leerElPedido: (crudo: unknown) => Resultado<E, unknown>,
  hacer: (pedido: E) => Promise<Resultado<S, unknown> | null>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  if (sucursalId === "") return respuestaGenericaDeSalon();
  const pedido = leerElPedido(crudo);
  if (!pedido.ok) return respuestaGenericaDeSalon();
  try {
    const hecho = await hacer(pedido.valor);
    if (hecho === null) return respuestaGenericaDeSalon();
    return aRespuesta(
      hecho.ok ? hecho : err(traducirErrorDeSalon(hecho.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
