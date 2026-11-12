import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import {
  cantidadConSignoDesdeCantidad,
  negarConSigno,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import { MAXIMO_DE_UNIDADES } from "../../../primitivas/cantidad/decimal-fijo";
import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import type { ClaseDeUso } from "../../catalogo/publico";
import { fraccionDeBruto } from "./merma";
import { cantidadDeUnidades, compararTexto, UNIDADES_POR_ENTERO } from "./movimiento";
import { MAXIMO_DE_NIVELES_DE_RECETA } from "./subcomposicion";

/**
 * La explosión de una línea vendida (E5 §3.3, pasos 1 a 7): qué artículos y cuánto descuenta una venta. Función pura: las versiones y
 * los artículos ya vienen leídos en la transacción; no hay reloj ni azar.
 *
 * 1. `q` = la cantidad vendida llevada a la unidad base del producto (`convertirCantidad`: exacta o se rechaza, D21).
 * 2. Con artículo activo (reventa): un renglón del artículo × `q`.
 * 3. Si no y hay composición vigente: por componente, `cantidad × q ÷ rinde`, con la cantidad del componente llevada a la unidad de stock.
 * 4. Si no hay ninguna y el producto es `VENDIBLE`: no descuenta y avisa `FALTA_RECETA` (la venta pasa, D140). Una `REVENTA` sin artículo
 *    no es «falta receta»: no se controla.
 * 5. Por cada opción elegida: sus líneas de consumo de la VERSIÓN sellada × `q`, y × el factor de tamaño de la variante elegida si
 *    `escalaConTamano`. El insumo sin artículo activo no descuenta y se avisa.
 * 6. UN solo redondeo por renglón del libro: se suma EXACTO todo lo que cae en el mismo (artículo, composición) y se redondea una vez a 4
 *    decimales con la política vigente. Es el mismo redondeo que `multiplicarCantidades` (`dividirRedondeando`), pero esa función solo
 *    multiplica de a dos y redondea cada vez: acá hay división por `rinde`, un segundo factor y sumas, y redondear en cada paso
 *    acumularía error (0,5 + 0,5 de 0,00925 = 0,0185 y no 0,0093 + 0,0093). La prueba compara ambos en el caso en que coinciden.
 * 7. El movimiento (un solo por ejemplar, `fecha_negocio` del ticket) lo arma el caso de uso: esto da los renglones, con signo de salida.
 */

export type ArticuloDeStock = Readonly<{
  articuloId: string;
  unidadDeStockId: CodigoDeUnidad;
  activo: boolean;
}>;

export type ComponenteVigente = Readonly<{
  articuloId: string;
  cantidad: Cantidad;
  unidadId: CodigoDeUnidad;
  /** La unidad de stock del artículo del componente. */
  unidadDeStockId: CodigoDeUnidad;
  /** E6: la merma en puntos, que se SUMA al neto (`merma.ts`, P-1). Sin dato: sin merma. */
  perdida?: Porcentaje | null;
}>;

/** E6: un componente que es un producto ELABORADO (subcomposición, D96). `cantidad` es la neta, en `unidadId` de la dimensión del elaborado. */
export type ComponenteCompuesto = Readonly<{
  compuestoId: string;
  cantidad: Cantidad;
  unidadId: CodigoDeUnidad;
  perdida?: Porcentaje | null;
}>;

/** La composición vigente (la de mayor número). Una versión VACÍA retira la receta: el producto vuelve a `null`, no a una lista vacía. */
export type ComposicionVigente = Readonly<{
  composicionId: string;
  rinde: Cantidad;
  componentes: readonly ComponenteVigente[];
  /** E6: los componentes que son elaborados. Sin dato: ninguno (la receta de E5). */
  compuestos?: readonly ComponenteCompuesto[];
}>;

export type ProductoParaExplotar = Readonly<{
  claseDeUso: ClaseDeUso;
  unidadBaseId: CodigoDeUnidad;
  /** El artículo de stock del propio producto (reventa), esté o no activo; `null` si no tiene. */
  articulo: ArticuloDeStock | null;
  composicion: ComposicionVigente | null;
}>;

/** Una línea de `consumo_de_opcion` de la versión sellada: `cantidad` en la unidad base (= de stock) del insumo. */
export type ConsumoDeOpcion = Readonly<{
  insumoId: string;
  cantidad: Cantidad;
  escalaConTamano: boolean;
}>;

export type OpcionElegida = Readonly<{
  versionDeOpcionId: string;
  consumos: readonly ConsumoDeOpcion[];
}>;
export type VarianteElegida = Readonly<{ versionDeOpcionId: string; factorDeTamano: Cantidad }>;

export type LineaVendida = Readonly<{
  posicion: number;
  productoId: string;
  /** Decimal exacto en la unidad de venta. */
  cantidad: Cantidad;
  unidadDeVentaId: CodigoDeUnidad;
  variante: VarianteElegida | null;
  opciones: readonly OpcionElegida[];
}>;

export type EntradaDeExplosion = Readonly<{
  lineas: readonly LineaVendida[];
  productos: ReadonlyMap<string, ProductoParaExplotar>;
  /** El artículo de cada insumo que consumen las opciones, por id de producto; el que falta no tiene artículo. */
  articulosDeInsumos: ReadonlyMap<string, ArticuloDeStock>;
}>;

export type RenglonDeConsumo = Readonly<{
  articuloId: string;
  composicionId: string | null;
  unidadDeStockId: CodigoDeUnidad;
  /** Negativa: lo que sale. Nunca cero (un renglón que redondea a cero no se escribe y se avisa). */
  cantidad: CantidadConSigno;
}>;

export type AvisoDeExplosion =
  | Readonly<{ tipo: "INSUMO_SIN_ARTICULO"; posicion: number; insumoId: string }>
  | Readonly<{ tipo: "CANTIDAD_EN_CERO"; articuloId: string; composicionId: string | null }>
  /** E6: un elaborado sin stock propio y sin receta: no hay qué descontar. */
  | Readonly<{ tipo: "COMPUESTO_SIN_RECETA"; compuestoId: string }>;

export type Explosion = Readonly<{
  renglones: readonly RenglonDeConsumo[];
  excepciones: readonly Readonly<{ posicion: number; tipo: "FALTA_RECETA" }>[];
  avisos: readonly AvisoDeExplosion[];
}>;

export type ErrorDeExplosion = Readonly<{
  codigo:
    | "PRODUCTO_DESCONOCIDO"
    | "CANTIDAD_INVALIDA"
    | "DIMENSION_DISTINTA"
    | "CONVERSION_NO_EXACTA"
    | "FUERA_DE_RANGO"
    | "RECETA_DEMASIADO_ANIDADA"
    | "OPCION_CON_CONSUMO_EN_VENTA_POR_PESO";
  /** La línea que lo causó; falta cuando sale de la suma de varias. */
  posicion?: number;
}>;

export type SituacionDeConsumo = "ARTICULO" | "COMPOSICION" | "FALTA_RECETA" | "NO_CONTROLADO";

/**
 * Qué hace una venta de este producto con el stock (pasos 2 a 4). Es la regla que también usa `ArticulosDeVenta.controla`
 * (`controla` = `ARTICULO` o `COMPOSICION`; `faltaReceta` = `FALTA_RECETA`): una sola vez, acá.
 */
export function situacionDeConsumo(producto: ProductoParaExplotar): SituacionDeConsumo {
  if (producto.articulo !== null && producto.articulo.activo) return "ARTICULO";
  if (
    producto.composicion !== null &&
    producto.composicion.componentes.length + (producto.composicion.compuestos?.length ?? 0) > 0
  ) {
    return "COMPOSICION";
  }
  return producto.claseDeUso === "VENDIBLE" ? "FALTA_RECETA" : "NO_CONTROLADO";
}

type Suma = {
  articuloId: string;
  composicionId: string | null;
  unidadDeStockId: CodigoDeUnidad;
  numerador: bigint;
  denominador: bigint;
};

/** Acumula una fracción exacta (en unidades mínimas de cantidad) en el renglón (artículo, composición). */
function sumar(
  sumas: Map<string, Suma>,
  articuloId: string,
  composicionId: string | null,
  unidadDeStockId: CodigoDeUnidad,
  numerador: bigint,
  denominador: bigint,
): void {
  const llave = JSON.stringify([articuloId, composicionId]);
  const previa = sumas.get(llave);
  sumas.set(
    llave,
    previa === undefined
      ? { articuloId, composicionId, unidadDeStockId, numerador, denominador }
      : {
          ...previa,
          numerador: previa.numerador * denominador + numerador * previa.denominador,
          denominador: previa.denominador * denominador,
        },
  );
}

const falla = (codigo: ErrorDeExplosion["codigo"], posicion?: number): ErrorDeExplosion =>
  posicion === undefined ? { codigo } : { codigo, posicion };

const UNO = UNIDADES_POR_ENTERO;

/**
 * E6: baja una composición hasta los artículos (D96). `qNum ÷ qDen` es la cantidad del producto que se produce, en su unidad base y en
 * unidades mínimas, como fracción exacta. Un componente que es elaborado con artículo activo descuenta SU stock (D94); sin artículo se
 * explota su propia receta, hasta `MAXIMO_DE_NIVELES_DE_RECETA` (la composición de la línea es el nivel 1). Nada se redondea acá: lo
 * hace el final, una vez por renglón (artículo, versión).
 */
function explotarComposicion(
  entrada: EntradaDeExplosion,
  sumas: Map<string, Suma>,
  avisos: AvisoDeExplosion[],
  composicion: ComposicionVigente,
  qNum: bigint,
  qDen: bigint,
  nivel: number,
): ErrorDeExplosion["codigo"] | null {
  if (nivel > MAXIMO_DE_NIVELES_DE_RECETA) return "RECETA_DEMASIADO_ANIDADA";
  for (const componente of composicion.componentes) {
    const enStock = convertirCantidad(
      componente.cantidad,
      componente.unidadId,
      componente.unidadDeStockId,
    );
    if (!enStock.ok) return enStock.error;
    const bruto = fraccionDeBruto(enStock.valor.unidades, componente.perdida ?? null);
    sumar(
      sumas,
      componente.articuloId,
      composicion.composicionId,
      componente.unidadDeStockId,
      bruto.numerador * qNum,
      bruto.denominador * composicion.rinde.unidades * qDen,
    );
  }
  for (const compuesto of composicion.compuestos ?? []) {
    const hijo = entrada.productos.get(compuesto.compuestoId);
    if (hijo === undefined) return "PRODUCTO_DESCONOCIDO";
    const enBase = convertirCantidad(compuesto.cantidad, compuesto.unidadId, hijo.unidadBaseId);
    if (!enBase.ok) return enBase.error;
    const bruto = fraccionDeBruto(enBase.valor.unidades, compuesto.perdida ?? null);
    const num = bruto.numerador * qNum;
    const den = bruto.denominador * composicion.rinde.unidades * qDen;
    if (hijo.articulo !== null && hijo.articulo.activo) {
      sumar(
        sumas,
        hijo.articulo.articuloId,
        composicion.composicionId,
        hijo.articulo.unidadDeStockId,
        num,
        den,
      );
    } else if (situacionDeConsumo(hijo) === "COMPOSICION") {
      const fallo = explotarComposicion(
        entrada,
        sumas,
        avisos,
        hijo.composicion as ComposicionVigente,
        num,
        den,
        nivel + 1,
      );
      if (fallo !== null) return fallo;
    } else {
      avisos.push({ tipo: "COMPUESTO_SIN_RECETA", compuestoId: compuesto.compuestoId });
    }
  }
  return null;
}

export function explotarConsumo(
  entrada: EntradaDeExplosion,
): Resultado<Explosion, ErrorDeExplosion> {
  const sumas = new Map<string, Suma>();
  const excepciones: { posicion: number; tipo: "FALTA_RECETA" }[] = [];
  const avisos: AvisoDeExplosion[] = [];

  for (const linea of entrada.lineas) {
    const producto = entrada.productos.get(linea.productoId);
    if (producto === undefined) return err(falla("PRODUCTO_DESCONOCIDO", linea.posicion));
    if (linea.cantidad.unidades <= 0n) return err(falla("CANTIDAD_INVALIDA", linea.posicion));
    const enBase = convertirCantidad(linea.cantidad, linea.unidadDeVentaId, producto.unidadBaseId);
    if (!enBase.ok) return err(falla(enBase.error, linea.posicion));
    const q = enBase.valor.unidades;

    const situacion = situacionDeConsumo(producto);
    if (situacion === "ARTICULO") {
      const articulo = producto.articulo as ArticuloDeStock;
      sumar(sumas, articulo.articuloId, null, articulo.unidadDeStockId, q, 1n);
    } else if (situacion === "COMPOSICION") {
      const fallo = explotarComposicion(
        entrada,
        sumas,
        avisos,
        producto.composicion as ComposicionVigente,
        q,
        1n,
        1,
      );
      if (fallo !== null) return err(falla(fallo, linea.posicion));
    } else if (situacion === "FALTA_RECETA") {
      excepciones.push({ posicion: linea.posicion, tipo: "FALTA_RECETA" });
    }

    const consumos = linea.opciones.flatMap((opcion) => opcion.consumos);
    // S-9: el consumo de una opción se multiplica por la cantidad en la unidad base: correcto para unidades y fracciones; peso, volumen y otras medidas no están definidos (nace cerrado, decisión de la sesión padre 10/11).
    if (consumos.length > 0 && UNIDADES[linea.unidadDeVentaId].dimension !== "CONTEO") {
      return err(falla("OPCION_CON_CONSUMO_EN_VENTA_POR_PESO", linea.posicion));
    }
    for (const consumo of consumos) {
      const articulo = entrada.articulosDeInsumos.get(consumo.insumoId);
      if (articulo === undefined || !articulo.activo) {
        avisos.push({
          tipo: "INSUMO_SIN_ARTICULO",
          posicion: linea.posicion,
          insumoId: consumo.insumoId,
        });
        continue;
      }
      // cantidad × q × factor (el factor vale 1 si la línea no escala o no hay variante). Los tres vienen en unidades mínimas (× 10⁴ cada
      // uno) y el resultado también: sobran dos escalas, de ahí el denominador.
      const factor =
        consumo.escalaConTamano && linea.variante !== null
          ? linea.variante.factorDeTamano.unidades
          : UNO;
      sumar(
        sumas,
        articulo.articuloId,
        null,
        articulo.unidadDeStockId,
        consumo.cantidad.unidades * q * factor,
        UNO * UNO,
      );
    }
  }

  const renglones: RenglonDeConsumo[] = [];
  const ordenadas = [...sumas.values()].sort(
    (a, b) =>
      compararTexto(a.articuloId, b.articuloId) ||
      compararTexto(a.composicionId ?? "", b.composicionId ?? ""),
  );
  for (const suma of ordenadas) {
    const unidades = dividirRedondeando(suma.numerador, suma.denominador, POLITICA_VIGENTE);
    if (unidades > MAXIMO_DE_UNIDADES) return err(falla("FUERA_DE_RANGO"));
    if (unidades === 0n) {
      avisos.push({
        tipo: "CANTIDAD_EN_CERO",
        articuloId: suma.articuloId,
        composicionId: suma.composicionId,
      });
      continue;
    }
    renglones.push({
      articuloId: suma.articuloId,
      composicionId: suma.composicionId,
      unidadDeStockId: suma.unidadDeStockId,
      cantidad: negarConSigno(cantidadConSignoDesdeCantidad(cantidadDeUnidades(unidades))),
    });
  }
  return ok({ renglones, excepciones, avisos });
}
