import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { decimal, entero, identificador, leer } from "./entradas-de-facturacion";

/**
 * Las entradas del consumo de las opciones de un grupo (A13, tramo Consumo): de lo que manda la pantalla a lo que entiende la composición. Puras: sin base ni servidor.
 *
 * Lista de permitidos: solo se leen las claves que declara el esquema (la empresa y la persona no se pueden mandar). `versionDeOpciones` es la que la persona vio al abrir; con otra, el caso
 * de uso rechaza sin escribir. La cantidad sigue siendo TEXTO (ADR-006) y qué es una cantidad válida lo decide la primitiva dentro del caso de uso; los ids de las opciones los liga la página.
 * Chequeo: `entradas-de-consumo.test.ts`.
 */

/** Cotas de forma para no leer un pedido enorme (las reglas de negocio las pone el dominio). */
const MAXIMO_DE_OPCIONES_POR_PEDIDO = 100;
const MAXIMO_DE_LINEAS_POR_OPCION = 50;

const FORMA_DE_UNA_LINEA = z.object({
  insumoId: identificador,
  cantidad: decimal,
  escalaConTamano: z.boolean(),
});

const FORMA_DEL_PEDIDO = z.object({
  productoId: identificador,
  grupoId: identificador,
  versionDeOpciones: entero,
  opciones: z
    .array(
      z.object({
        opcionId: identificador,
        lineas: z.array(FORMA_DE_UNA_LINEA).max(MAXIMO_DE_LINEAS_POR_OPCION),
      }),
    )
    .max(MAXIMO_DE_OPCIONES_POR_PEDIDO),
});

export type PedidoDeConsumo = z.output<typeof FORMA_DEL_PEDIDO>;
export type LineaPedida = z.output<typeof FORMA_DE_UNA_LINEA>;

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDeConsumo(
  crudo: unknown,
): Resultado<PedidoDeConsumo, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** Cómo se llama cada campo de una línea de consumo: `consumo_<opción>_<línea>_<campo>`; la opción es su posición en el grupo y la línea es `l<n>`. */
export const nombreDeCampoDeConsumo = (
  opcion: number,
  linea: string,
  campo: "insumo" | "cantidad" | "escala",
): string => `consumo_${String(opcion)}_${linea}_${campo}`;

const CAMPO_DE_CONSUMO = /^consumo_(\d{1,3})_(l\d{1,3})_(insumo|cantidad|escala)$/;

/**
 * Las líneas de consumo que mandó el formulario, por opción (la posición `i` es la i-ésima opción que ligó la página) y en el orden en que aparecen. Una línea sin insumo no existe (el insumo es lo
 * que la nombra); sin cantidad trae el texto vacío (lo rechaza el dominio); la escala es `true` solo si la casilla vino marcada. Lo que no tiene la forma pedida, no es texto o apunta a una opción
 * que no se ligó no se lee: lo que no se declara no existe. Una línea repetida conserva el primer valor de cada campo.
 */
export function leerLasLineasDeConsumo(
  campos: Iterable<readonly [string, unknown]>,
  cantidadDeOpciones: number,
): readonly (readonly LineaPedida[])[] {
  const porOpcion = Array.from(
    { length: cantidadDeOpciones },
    () => new Map<string, { insumo?: string; cantidad?: string; escala?: boolean }>(),
  );
  for (const [nombre, valor] of campos) {
    const partes = CAMPO_DE_CONSUMO.exec(nombre);
    if (partes === null || typeof valor !== "string") continue;
    const lineas = porOpcion[Number(partes[1])];
    if (lineas === undefined) continue;
    const linea = lineas.get(partes[2] as string) ?? {};
    const campo = partes[3] as "insumo" | "cantidad" | "escala";
    if (campo === "escala") linea.escala ??= valor === "on";
    else linea[campo] ??= valor;
    lineas.set(partes[2] as string, linea);
  }
  return porOpcion.map((lineas) =>
    [...lineas.values()].flatMap((l) =>
      l.insumo === undefined || l.insumo === ""
        ? []
        : [{ insumoId: l.insumo, cantidad: l.cantidad ?? "", escalaConTamano: l.escala === true }],
    ),
  );
}
