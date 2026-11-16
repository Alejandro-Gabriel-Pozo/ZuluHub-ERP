import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";
import { leerCantidadPositiva, textoDeCantidad } from "./decimal";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA } from "./registrar-compra";

/**
 * El control de la mercadería de una recepción separada (N3, E9 §3.8, D118): por cada línea recibida, quien recibe deja constancia de su condición. Pura: sin reloj ni
 * azar. Sin control de una línea = «no se constató» (no existe un CONFORME por defecto: lo calla el que no miró). Los límites los repite la base
 * (`inspeccion_de_linea_de_recepcion`: `inspeccion_observacion_ck`, `inspeccion_temperatura_ck`, `inspeccion_cantidad_remito_ck`, `inspeccion_observacion_requerida_ck`)
 * y los compara `test/integracion/compras-n3-migracion.test.ts`.
 */
export const CONDICIONES_DE_LINEA = ["CONFORME", "CON_OBSERVACIONES", "RECHAZADA"] as const;
export type CondicionDeLinea = (typeof CONDICIONES_DE_LINEA)[number];

export type ControlDeLinea = Readonly<{
  linea: number;
  /** Lo que decía el remito, en la unidad de la línea (texto decimal de hasta 4 decimales, mayor que cero); `null` si no se cargó. */
  cantidadSegunRemito: string | null;
  condicion: CondicionDeLinea;
  /** Obligatoria si la condición no es CONFORME. */
  observacion: string | null;
  /** Grados Celsius con a lo sumo un decimal; `null` si no se midió. Solo plausibilidad física: el rango aceptable lo decide quien recibe (compras.md NV5). */
  temperaturaEnC: string | null;
}>;

export type ErrorDeControl =
  | "CONTROL_INVALIDO"
  | "LINEA_NO_ENCONTRADA"
  | "LINEA_REPETIDA"
  | "CONDICION_INVALIDA"
  | "OBSERVACION_REQUERIDA"
  | "OBSERVACION_INVALIDA"
  | "TEMPERATURA_INVALIDA"
  | "CANTIDAD_SEGUN_REMITO_INVALIDA";

export const LARGO_MAXIMO_DE_LA_OBSERVACION_DE_RECEPCION = 500;
/** Por encima del cero absoluto y por debajo de mil grados: lo que cabe en `numeric(5,1)` y tiene sentido físico (`inspeccion_temperatura_ck`). */
const FORMA_DE_LA_TEMPERATURA = /^-?(?:0|[1-9][0-9]{0,2})(?:\.[0-9])?$/;

function leerTemperatura(texto: string): string | null {
  if (!FORMA_DE_LA_TEMPERATURA.test(texto)) return null;
  const grados = Number(texto);
  // La forma ya acota a tres dígitos y un decimal: el único borde físico que queda es el cero absoluto (-273,15 °C).
  if (grados <= -273.15) return null;
  // Forma canónica: sin «.0» de más y sin cero negativo (`5.0` y `5` son el mismo pedido).
  const sinDecimalVacio = texto.endsWith(".0") ? texto.slice(0, -2) : texto;
  return sinDecimalVacio === "-0" ? "0" : sinDecimalVacio;
}

/** Lee el control de UNA línea. El orden de los errores es el del pedido (forma, línea, condición, cantidad, temperatura, observación). */
export function leerControlDeLinea(valor: unknown): Resultado<ControlDeLinea, ErrorDeControl> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return err("CONTROL_INVALIDO");
  }
  const v = valor as Record<string, unknown>;
  const linea = v["linea"];
  if (
    typeof linea !== "number" ||
    !Number.isInteger(linea) ||
    linea < 1 ||
    linea > MAXIMO_DE_RENGLONES_DE_UNA_COMPRA
  ) {
    return err("LINEA_NO_ENCONTRADA");
  }
  const condicion = v["condicion"];
  if (
    typeof condicion !== "string" ||
    !(CONDICIONES_DE_LINEA as readonly string[]).includes(condicion)
  ) {
    return err("CONDICION_INVALIDA");
  }
  let cantidadSegunRemito: string | null = null;
  const remito = v["cantidadSegunRemito"];
  if (remito !== undefined && remito !== null) {
    const unidades = typeof remito === "string" ? leerCantidadPositiva(remito) : null;
    if (unidades === null) return err("CANTIDAD_SEGUN_REMITO_INVALIDA");
    cantidadSegunRemito = textoDeCantidad(unidades);
  }
  let temperaturaEnC: string | null = null;
  const temperatura = v["temperaturaEnC"];
  if (temperatura !== undefined && temperatura !== null) {
    const leida = typeof temperatura === "string" ? leerTemperatura(temperatura) : null;
    if (leida === null) return err("TEMPERATURA_INVALIDA");
    temperaturaEnC = leida;
  }
  let observacion: string | null = null;
  const texto = v["observacion"];
  if (texto !== undefined && texto !== null) {
    const leida =
      typeof texto === "string"
        ? textoDeUnaLineaDesdeTexto(texto, {
            maximo: LARGO_MAXIMO_DE_LA_OBSERVACION_DE_RECEPCION,
            exigirUnaLetra: true,
          })
        : null;
    if (leida === null || !leida.ok) return err("OBSERVACION_INVALIDA");
    observacion = leida.valor;
  }
  if (condicion !== "CONFORME" && observacion === null) return err("OBSERVACION_REQUERIDA");
  return ok({
    linea,
    cantidadSegunRemito,
    condicion: condicion as CondicionDeLinea,
    observacion,
    temperaturaEnC,
  });
}

/** Lee los controles de una recepción: ninguno repite línea, y cada uno apunta a una línea que existe (`lineasDeLaRecepcion` = cuántas tiene). */
export function leerControles(
  valor: unknown,
  lineasDeLaRecepcion: number,
): Resultado<readonly ControlDeLinea[], ErrorDeControl> {
  if (!Array.isArray(valor)) return err("CONTROL_INVALIDO");
  const vistas = new Set<number>();
  const controles: ControlDeLinea[] = [];
  for (const crudo of valor as readonly unknown[]) {
    const control = leerControlDeLinea(crudo);
    if (!control.ok) return control;
    if (control.valor.linea > lineasDeLaRecepcion) return err("LINEA_NO_ENCONTRADA");
    if (vistas.has(control.valor.linea)) return err("LINEA_REPETIDA");
    vistas.add(control.valor.linea);
    controles.push(control.valor);
  }
  return ok(controles);
}
