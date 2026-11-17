import {
  importeATexto,
  importeCero,
  importeDesdeTexto,
  restar,
  sumar,
  type Importe,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { importeDeEntrada, sumarImportes } from "./importes";
import { observacionOpcional } from "./texto";

/**
 * El arqueo de una sesión al cerrarla (e3 §3.2; decisiones 123 y 164): «una cosa es lo que se dice que se cobró y otra lo que se
 * cuenta». El esperado de cada (medio, cuenta) es la suma EXACTA de sus movimientos (`bigint` de centavos); el efectivo se cuenta
 * SIEMPRE por billetes más monedas y no admite «conforme»; los demás medios se declaran o se aceptan con un «conforme general»
 * (con quién y cuándo); un total declarado en una línea gana sobre el conforme. La diferencia es contado − esperado. Hay una línea por
 * cada (medio, cuenta) con movimientos más la del efectivo, aunque no haya tenido ninguno. Puro: sin reloj ni azar (el instante y la
 * persona del cierre entran como dato). La base repite todo al confirmar (`sesion_caja_verificar_cierre`).
 */

/** Los billetes del cono monetario que se cuentan (Q12 de e3). La misma lista que `arqueo_billete_denominacion_ck`. */
export const DENOMINACIONES_DE_BILLETES: readonly number[] = [
  20000, 10000, 2000, 1000, 500, 200, 100,
];
export const CANTIDAD_MAXIMA_DE_BILLETES = 99999;

export type BilleteContado = Readonly<{ denominacion: number; cantidad: number }>;

export type ConteoDeEfectivo = Readonly<{
  billetes: readonly BilleteContado[];
  /** Las monedas, como un solo importe. */
  monedas: ImporteJson;
}>;

/** El total que quien cierra declara para una línea que no es efectivo (lo que dicen los comprobantes). */
export type TotalDeclarado = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  contado: ImporteJson;
}>;

/** Un movimiento de la sesión, tal como suma al esperado: con signo. */
export type MovimientoParaArqueo = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
}>;

export type EntradaDeArqueo = Readonly<{
  /** El medio efectivo de la empresa. */
  efectivoId: string;
  movimientos: readonly MovimientoParaArqueo[];
  /** `null` = no contó el efectivo. */
  conteo: ConteoDeEfectivo | null;
  otros: readonly TotalDeclarado[];
  conformeGeneral: boolean;
  observacion: string | null | undefined;
  /** Quién cierra y el instante del cierre: lo que se anota en cada línea conforme. */
  cierraPor: string;
  cierraEn: Date;
}>;

export type LineaDeArqueo = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  esperado: Importe;
  /** Efectivo: billetes + monedas; demás medios: el total declarado; `null` si la línea es conforme. */
  contado: Importe | null;
  /** Solo la línea de efectivo. */
  contadoMonedas: Importe | null;
  conforme: boolean;
  conformePor: string | null;
  conformeEn: Date | null;
  /** contado − esperado; `null` si es conforme (la línea muestra «conforme», no una diferencia). */
  diferencia: Importe | null;
}>;

export type ArqueoCalculado = Readonly<{
  /** Ordenadas por (medio, cuenta). */
  lineas: readonly LineaDeArqueo[];
  /** El detalle del conteo, de mayor a menor denominación; solo las denominaciones que vinieron. */
  billetes: readonly BilleteContado[];
  observacion: string | null;
}>;

export type LineaFaltante = Readonly<{ medioDePagoId: string; cuentaDeCobroId: string | null }>;

export type ErrorDeArqueo =
  | "CONTEO_DE_EFECTIVO_FALTANTE"
  | "CONTEO_DUPLICADO"
  | "CONTEO_DE_MEDIO_AJENO"
  | "OBSERVACION_INVALIDA"
  | Readonly<{ codigo: "CONTEO_INVALIDO"; campo: string }>
  | Readonly<{ codigo: "CONTEO_O_CONFORME_FALTANTE"; lineas: readonly LineaFaltante[] }>;

const conteoInvalido = (campo: string): ErrorDeArqueo => ({ codigo: "CONTEO_INVALIDO", campo });

/** La llave de un par (medio, cuenta): con ella se agrupa y se ordena (orden por defecto de los textos, sin comparador propio). */
function llaveDelPar(medioDePagoId: string, cuentaDeCobroId: string | null): string {
  return JSON.stringify([medioDePagoId, cuentaDeCobroId]);
}

export type LineaEsperada = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  esperado: Importe;
}>;

/**
 * El esperado de cada (medio, cuenta): Σ de los importes de sus movimientos, en `bigint` de centavos, más la línea del efectivo aunque no
 * haya tenido movimientos (esperado cero). Es el mismo cálculo que el de la base al confirmar.
 */
export function esperadoPorLinea(
  movimientos: readonly MovimientoParaArqueo[],
  efectivoId: string,
): readonly LineaEsperada[] {
  const lineas = new Map<string, LineaEsperada>();
  lineas.set(llaveDelPar(efectivoId, null), {
    medioDePagoId: efectivoId,
    cuentaDeCobroId: null,
    esperado: importeCero(ARS),
  });
  for (const m of movimientos) {
    const llave = llaveDelPar(m.medioDePagoId, m.cuentaDeCobroId);
    const actual = lineas.get(llave);
    lineas.set(llave, {
      medioDePagoId: m.medioDePagoId,
      cuentaDeCobroId: m.cuentaDeCobroId,
      esperado: sumar(actual?.esperado ?? importeCero(ARS), m.importe),
    });
  }
  return [...lineas.keys()].sort().map((llave) => lineas.get(llave) as LineaEsperada);
}

/** Σ(denominación × cantidad) de los billetes, con cada billete validado. Detalle de mayor a menor denominación. */
function contarBilletes(
  billetes: readonly BilleteContado[],
): Resultado<Readonly<{ detalle: readonly BilleteContado[]; total: Importe }>, ErrorDeArqueo> {
  const cantidades = new Map<number, number>();
  const partes: Importe[] = [];
  for (const [i, billete] of billetes.entries()) {
    if (!DENOMINACIONES_DE_BILLETES.includes(billete.denominacion)) {
      return err(conteoInvalido(`billetes.${i}.denominacion`));
    }
    if (
      !Number.isInteger(billete.cantidad) ||
      billete.cantidad < 0 ||
      billete.cantidad > CANTIDAD_MAXIMA_DE_BILLETES
    ) {
      return err(conteoInvalido(`billetes.${i}.cantidad`));
    }
    if (cantidades.has(billete.denominacion)) return err("CONTEO_DUPLICADO");
    cantidades.set(billete.denominacion, billete.cantidad);
    // Pesos enteros como texto: ni `number` ni coma flotante en el dinero (ADR-006).
    const pesos = BigInt(billete.denominacion) * BigInt(billete.cantidad);
    partes.push(importeDesdeTexto(ARS, pesos.toString()));
  }
  const detalle = DENOMINACIONES_DE_BILLETES.flatMap((denominacion) => {
    const cantidad = cantidades.get(denominacion);
    return cantidad === undefined ? [] : [{ denominacion, cantidad }];
  });
  return ok({ detalle, total: sumarImportes(partes) });
}

/**
 * Los totales declarados de los demás medios, por línea: cada uno es de una línea no efectivo de la sesión (con movimientos), una sola
 * vez, y bien escrito. Un total mal escrito es un error, nunca se toma como conforme ni como «sin contar» (defecto de la auditoría).
 */
function declaradosDeOtros(
  otros: readonly TotalDeclarado[],
  lineasNoEfectivo: ReadonlySet<string>,
): Resultado<ReadonlyMap<string, Importe>, ErrorDeArqueo> {
  const declarados = new Map<string, Importe>();
  for (const [i, otro] of otros.entries()) {
    const contado = importeDeEntrada(otro.contado, "NO_NEGATIVO");
    if (!contado.ok) return err(conteoInvalido(`otros.${i}.contado`));
    const llave = llaveDelPar(otro.medioDePagoId, otro.cuentaDeCobroId);
    if (!lineasNoEfectivo.has(llave)) return err("CONTEO_DE_MEDIO_AJENO");
    if (declarados.has(llave)) return err("CONTEO_DUPLICADO");
    declarados.set(llave, contado.valor);
  }
  return ok(declarados);
}

/**
 * Calcula el arqueo de la sesión o dice qué falta. Orden: el efectivo se cuenta (`CONTEO_DE_EFECTIVO_FALTANTE`, aunque haya «conforme
 * general»: no lo cubre), cada billete y las monedas bien escritos, los totales declarados bien escritos y de líneas de la sesión, la
 * observación, y por último que toda línea no efectivo con movimientos esté declarada o cubierta por el conforme general
 * (`CONTEO_O_CONFORME_FALTANTE`, con la lista de las que faltan).
 */
export function decidirArqueo(entrada: EntradaDeArqueo): Resultado<ArqueoCalculado, ErrorDeArqueo> {
  const { conteo } = entrada;
  if (conteo === null || conteo.billetes.length === 0) return err("CONTEO_DE_EFECTIVO_FALTANTE");
  const billetes = contarBilletes(conteo.billetes);
  if (!billetes.ok) return billetes;
  const monedas = importeDeEntrada(conteo.monedas, "NO_NEGATIVO");
  if (!monedas.ok) return err(conteoInvalido("monedas"));

  const esperadas = esperadoPorLinea(entrada.movimientos, entrada.efectivoId);
  const noEfectivo = esperadas.filter((l) => l.medioDePagoId !== entrada.efectivoId);
  const declarados = declaradosDeOtros(
    entrada.otros,
    new Set(noEfectivo.map((l) => llaveDelPar(l.medioDePagoId, l.cuentaDeCobroId))),
  );
  if (!declarados.ok) return declarados;
  const observacion = observacionOpcional(entrada.observacion);
  if (!observacion.ok) return observacion;

  const faltan: LineaFaltante[] = [];
  const lineas: LineaDeArqueo[] = [];
  for (const esperada of esperadas) {
    const { medioDePagoId, cuentaDeCobroId, esperado } = esperada;
    if (medioDePagoId === entrada.efectivoId) {
      const contado = sumar(billetes.valor.total, monedas.valor);
      lineas.push({
        medioDePagoId,
        cuentaDeCobroId,
        esperado,
        contado,
        contadoMonedas: monedas.valor,
        conforme: false,
        conformePor: null,
        conformeEn: null,
        diferencia: restar(contado, esperado),
      });
      continue;
    }
    const declarado = declarados.valor.get(llaveDelPar(medioDePagoId, cuentaDeCobroId));
    if (declarado !== undefined) {
      lineas.push({
        medioDePagoId,
        cuentaDeCobroId,
        esperado,
        contado: declarado,
        contadoMonedas: null,
        conforme: false,
        conformePor: null,
        conformeEn: null,
        diferencia: restar(declarado, esperado),
      });
    } else if (entrada.conformeGeneral) {
      lineas.push({
        medioDePagoId,
        cuentaDeCobroId,
        esperado,
        contado: null,
        contadoMonedas: null,
        conforme: true,
        conformePor: entrada.cierraPor,
        conformeEn: entrada.cierraEn,
        diferencia: null,
      });
    } else {
      faltan.push({ medioDePagoId, cuentaDeCobroId });
    }
  }
  if (faltan.length > 0) return err({ codigo: "CONTEO_O_CONFORME_FALTANTE", lineas: faltan });
  return ok({ lineas, billetes: billetes.valor.detalle, observacion: observacion.valor });
}

/** ¿Alguna línea contada difiere de lo esperado? Entonces el cierre deja la entrada de auditoría `CIERRE_CON_DIFERENCIA`. */
export function hayDiferenciaDeArqueo(
  lineas: readonly Pick<LineaDeArqueo, "diferencia">[],
): boolean {
  return lineas.some((l) => l.diferencia !== null && l.diferencia.unidades !== 0n);
}

/** Lo que se compara de un cierre para saber si un reintento es el mismo (no incluye quién, cuándo ni la observación). */
export type ArqueoComparable = Readonly<{
  lineas: readonly Pick<
    LineaDeArqueo,
    "medioDePagoId" | "cuentaDeCobroId" | "contado" | "contadoMonedas" | "conforme"
  >[];
  billetes: readonly BilleteContado[];
}>;

function formaComparable(arqueo: ArqueoComparable): string {
  const lineas = arqueo.lineas
    .map((l) =>
      JSON.stringify([
        l.medioDePagoId,
        l.cuentaDeCobroId,
        l.contado === null ? null : importeATexto(l.contado),
        l.contadoMonedas === null ? null : importeATexto(l.contadoMonedas),
        l.conforme,
      ]),
    )
    .sort();
  // Una denominación que no vino cuenta como cero: «mismo conteo» no depende de si el cero se mandó o se omitió.
  const billetes = DENOMINACIONES_DE_BILLETES.map(
    (d) => arqueo.billetes.find((b) => b.denominacion === d)?.cantidad ?? 0,
  );
  return JSON.stringify([lineas, billetes]);
}

/**
 * ¿El pedido de cerrar repite el cierre ya guardado? Mismo conteo y mismo conforme, comparados contra el ARQUEO GUARDADO (sin columna
 * nueva): es un doble clic o un reintento de red y devuelve `yaEstabaCerrada` sin escribir. Cualquier otra diferencia es otro cierre y
 * recibe `SESION_CERRADA`. Previene que alguien «cierre otra vez» con otro conteo sobre una sesión congelada.
 */
export function repiteElCierre(guardado: ArqueoComparable, pedido: ArqueoComparable): boolean {
  return formaComparable(guardado) === formaComparable(pedido);
}
