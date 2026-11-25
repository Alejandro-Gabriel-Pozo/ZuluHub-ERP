import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";
import { uuidV5DeLista } from "../../../primitivas/identificadores/uuid-determinista";
import { leerCantidadPositiva, textoDeCantidad } from "./decimal";
import type { CampoDeHuella } from "./huella";
import { esUuid } from "./identificadores";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA } from "./registrar-compra";

/**
 * Corregir lo recibido de una línea de una recepción separada ya confirmada (E9 N3, decisión del dueño del 25/11/2026): no se reabre la recepción, se suma un registro con la cantidad que de
 * verdad llegó, la causa (lista cerrada, que separa en los reportes lo que es del proveedor de lo que no) y una nota opcional. Pura: sin reloj ni azar. La cantidad es la de la UNIDAD DE STOCK de
 * la línea (la misma con la que se concilia). `correccionesVistas` es la última corrección que vio quien pide: la versión optimista de la línea. Qué corresponde a cada línea (depósito, saldo,
 * lo conciliado) lo decide el caso de uso con la línea a la vista.
 */
export const CAUSAS_DE_CORRECCION = [
  "ERROR_DE_CARGA",
  "REPARTO_INTERNO",
  "FALTANTE_DEL_PROVEEDOR",
] as const;
export type CausaDeCorreccion = (typeof CAUSAS_DE_CORRECCION)[number];

/** El largo máximo de la nota: lo repite la base (`correccion_de_lo_recibido_nota_ck`) y lo compara una prueba de integración. */
export const MAXIMO_DE_LA_NOTA_DE_CORRECCION = 200;

const MAXIMO_DE_CORRECCIONES_VISTAS = 1_000_000;

export type CorreccionDeLoRecibidoPedida = Readonly<{
  clave: string;
  recepcionId: string;
  linea: number;
  correccionesVistas: number;
  /** La cantidad realmente recibida, en la unidad de stock (texto decimal de hasta 4 decimales, mayor que cero). */
  cantidad: string;
  causa: CausaDeCorreccion;
  nota: string | null;
  /** Con el control `stock.existencia_negativa` en AVISAR, quien corrige confirma que la baja va a dejar la existencia en negativo. */
  confirmoExistenciaNegativa: boolean;
}>;

export type ErrorDeCorreccionDeLoRecibido =
  | "IDENTIFICADOR_INVALIDO"
  | "LINEA_NO_ENCONTRADA"
  | "CORRECCION_DESACTUALIZADA"
  | "CANTIDAD_INVALIDA"
  | "CAUSA_DE_CORRECCION_INVALIDA"
  | "NOTA_DE_CORRECCION_INVALIDA";

const esEnteroEntre = (valor: unknown, minimo: number, maximo: number): valor is number =>
  Number.isInteger(valor) && (valor as number) >= minimo && (valor as number) <= maximo;

const esCausa = (valor: unknown): valor is CausaDeCorreccion =>
  (CAUSAS_DE_CORRECCION as readonly unknown[]).includes(valor);

/** Lee el pedido: lo que no es de la forma declarada no pasa. El orden de los errores es el del pedido (ids, línea, versión, cantidad, causa, nota). */
export function leerCorreccionDeLoRecibido(
  valor: unknown,
): Resultado<CorreccionDeLoRecibidoPedida, ErrorDeCorreccionDeLoRecibido> {
  const v =
    typeof valor === "object" && valor !== null && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : {};
  const clave = v["clave"];
  const recepcionId = v["recepcionId"];
  if (typeof clave !== "string" || !esUuid(clave)) return err("IDENTIFICADOR_INVALIDO");
  if (typeof recepcionId !== "string" || !esUuid(recepcionId)) return err("IDENTIFICADOR_INVALIDO");
  const linea = v["linea"];
  if (!esEnteroEntre(linea, 1, MAXIMO_DE_RENGLONES_DE_UNA_COMPRA)) {
    return err("LINEA_NO_ENCONTRADA");
  }
  const vistas = v["correccionesVistas"];
  if (!esEnteroEntre(vistas, 0, MAXIMO_DE_CORRECCIONES_VISTAS)) {
    return err("CORRECCION_DESACTUALIZADA");
  }
  const cantidad = v["cantidad"];
  const unidades = typeof cantidad === "string" ? leerCantidadPositiva(cantidad) : null;
  if (unidades === null) return err("CANTIDAD_INVALIDA");
  const causa = v["causa"];
  if (!esCausa(causa)) return err("CAUSA_DE_CORRECCION_INVALIDA");
  const crudaNota = v["nota"];
  let nota: string | null = null;
  if (crudaNota !== undefined && crudaNota !== null && crudaNota !== "") {
    if (typeof crudaNota !== "string") return err("NOTA_DE_CORRECCION_INVALIDA");
    const leida = textoDeUnaLineaDesdeTexto(crudaNota, {
      maximo: MAXIMO_DE_LA_NOTA_DE_CORRECCION,
      exigirUnaLetra: true,
    });
    if (!leida.ok) return err("NOTA_DE_CORRECCION_INVALIDA");
    nota = leida.valor;
  }
  const confirmo = v["confirmoExistenciaNegativa"];
  if (confirmo !== undefined && typeof confirmo !== "boolean") return err("IDENTIFICADOR_INVALIDO");
  return ok({
    clave,
    recepcionId,
    linea,
    correccionesVistas: vistas,
    cantidad: textoDeCantidad(unidades),
    causa,
    nota,
    confirmoExistenciaNegativa: confirmo === true,
  });
}

/** Lo que entra a la huella de la corrección: la misma clave con otro contenido es `CLAVE_REUTILIZADA`. La confirmación de existencia negativa no entra: repetir el pedido con ella es el mismo pedido. */
export const camposDeHuellaDeLaCorreccionDeLoRecibido = (
  p: CorreccionDeLoRecibidoPedida,
): readonly CampoDeHuella[] => [
  p.recepcionId,
  p.linea,
  p.correccionesVistas,
  p.cantidad,
  p.causa,
  p.nota,
];

// Los espacios de nombres son fijos: cambiar uno reescribiría el origen de lo ya guardado.
const ESPACIO_DEL_ID_DE_CORRECCION = "d1c8c8f6-35a1-4f3b-9b0e-6c3d3a4a8e21";
const ESPACIO_DE_LA_CLAVE_DE_MOVIMIENTO_DE_CORRECCION = "7b0f2a94-5d1e-4c36-8a57-e92c1d6b4f08";

/** El id de la corrección sale de su clave (no del azar): un reintento repite el mismo origen del movimiento de stock y la base no puede duplicarlo. */
export const idDeLaCorreccionDeLoRecibido = (clave: string): string =>
  uuidV5DeLista(ESPACIO_DEL_ID_DE_CORRECCION, [clave]);

/** La clave del movimiento de stock de una corrección (uno por corrección). */
export const claveDelMovimientoDeLaCorreccion = (correccionId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_CLAVE_DE_MOVIMIENTO_DE_CORRECCION, [correccionId]);
