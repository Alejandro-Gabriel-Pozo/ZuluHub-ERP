import { importeCero, restar, sumar, type Importe } from "../../../primitivas/dinero/importe";
import { prorratear } from "../../../primitivas/dinero/prorrateo";
import { exactoDeImporte } from "../../../primitivas/dinero/monto-exacto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * EL CENTRO DE COSTO DE UN ASIENTO (decisión del dueño, 20/11: «la deuda es de la empresa» y cada importe «debe identificar el centro de costo»).
 * Un asiento reparte su importe entre sucursales (`centroDeCosto` = el id de la sucursal) o lo deja «sin centro de costo» (`null`: se etiqueta, no
 * se bloquea). La base solo impone que el reparto SUME EXACTO el importe, con el signo del asiento, y que el del espejo sea el negativo del original
 * (`0092`, disparador diferido); quién calcula el reparto es esta función pura.
 *
 * Las funciones trabajan con MAGNITUDES (importes positivos); el signo del asiento se aplica al final (`conSigno`).
 *
 *  1. Lo que el asiento imputa a comprobantes concretos hereda el centro de costo de cada comprobante (`imputaciones`).
 *  2. El resto («a cuenta», saldo inicial) se reparte proporcional a lo pendiente de cada centro, SOLO entre los centros con pendiente POSITIVO
 *     (decisión del dueño, 21/11), con `prorratear` (restos mayores; ante un empate gana el primero del orden fijo). Los centros van en orden
 *     fijo: por id de sucursal ascendente y `null` al final.
 *  3. Si ningún centro tiene pendiente positivo, el resto va todo a «sin centro de costo».
 * Ejemplo (decisión del dueño, 21/11): 10,00 «a cuenta» con el mismo pendiente en tres centros = 3,34 / 3,33 / 3,33 (el centavo de más, al primero).
 *
 * Una regla, un lugar: el reparto con resto mayor es `prorratear` (primitiva de dinero); acá solo se arma qué pesos y en qué orden.
 */
export type CentroDeCosto = string | null;

export type Reparto = Readonly<{ centroDeCosto: CentroDeCosto; importe: Importe }>;

export type ErrorDeDistribucion = "DISTRIBUCION_INVALIDA";

/** El orden fijo de los centros: por sucursal ascendente; «sin centro de costo» al final. */
export function compararCentros(a: CentroDeCosto, b: CentroDeCosto): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

const positivo = (importe: Importe): boolean => importe.unidades > 0n;

/** Junta los renglones de un mismo centro, descarta los de importe cero y los deja en el orden fijo. */
function normalizar(renglones: readonly Reparto[]): Reparto[] {
  const porCentro = new Map<CentroDeCosto, Importe>();
  for (const r of renglones) {
    const previo = porCentro.get(r.centroDeCosto);
    porCentro.set(r.centroDeCosto, previo === undefined ? r.importe : sumar(previo, r.importe));
  }
  return [...porCentro.entries()]
    .filter(([, importe]) => importe.unidades !== 0n)
    .sort(([a], [b]) => compararCentros(a, b))
    .map(([centroDeCosto, importe]) => ({ centroDeCosto, importe }));
}

export function distribuirPorCentroDeCosto(
  entrada: Readonly<{
    importe: Importe;
    imputaciones: readonly Reparto[];
    pendientePorCentro: ReadonlyArray<
      Readonly<{ centroDeCosto: CentroDeCosto; pendiente: Importe }>
    >;
  }>,
): Resultado<Reparto[], ErrorDeDistribucion> {
  const { importe } = entrada;
  if (!positivo(importe)) return err("DISTRIBUCION_INVALIDA");
  const moneda = importe.moneda;
  let asignado = importeCero(moneda);
  for (const i of entrada.imputaciones) {
    if (i.importe.moneda !== moneda || !positivo(i.importe)) return err("DISTRIBUCION_INVALIDA");
    asignado = sumar(asignado, i.importe);
  }
  for (const p of entrada.pendientePorCentro) {
    if (p.pendiente.moneda !== moneda) return err("DISTRIBUCION_INVALIDA");
  }
  const resto = restar(importe, asignado);
  if (resto.unidades < 0n) return err("DISTRIBUCION_INVALIDA");

  const renglones: Reparto[] = [...entrada.imputaciones];
  if (resto.unidades > 0n) {
    const pesos = normalizar(
      entrada.pendientePorCentro
        .filter((p) => positivo(p.pendiente))
        .map((p) => ({ centroDeCosto: p.centroDeCosto, importe: p.pendiente })),
    );
    if (pesos.length === 0) {
      renglones.push({ centroDeCosto: null, importe: resto });
    } else {
      const partes = prorratear(
        resto,
        pesos.map((p) => exactoDeImporte(p.importe)),
      );
      for (const [i, parte] of partes.entries()) {
        const peso = pesos[i];
        if (peso !== undefined)
          renglones.push({ centroDeCosto: peso.centroDeCosto, importe: parte });
      }
    }
  }
  return ok(normalizar(renglones));
}

/** El mismo reparto con el signo del asiento: `"-"` lo niega (un pago, una nota de crédito) y `"+"` lo deja. */
export function conSigno(reparto: readonly Reparto[], signo: "+" | "-"): Reparto[] {
  const cero = reparto[0] === undefined ? null : importeCero(reparto[0].importe.moneda);
  return reparto.map((r) => ({
    centroDeCosto: r.centroDeCosto,
    importe: signo === "+" || cero === null ? r.importe : restar(cero, r.importe),
  }));
}

/** El reparto del espejo de un asiento: el del original, negado EXACTO (lo exige la base al confirmar). */
export function distribucionDelEspejo(original: readonly Reparto[]): Reparto[] {
  return conSigno(original, "-");
}

/**
 * ¿La distribución de un asiento es válida? Al menos un renglón, un solo renglón por centro, todos del signo del importe y la suma EXACTA del
 * importe. Es la misma regla que la base impone al confirmar (`asiento_de_saldo_verificar_distribucion`): decirlo antes evita el error recién al `COMMIT`.
 */
export function distribucionValida(importe: Importe, reparto: readonly Reparto[]): boolean {
  if (reparto.length === 0 || importe.unidades === 0n) return false;
  const centros = new Set<CentroDeCosto>();
  let suma = importeCero(importe.moneda);
  for (const r of reparto) {
    if (centros.has(r.centroDeCosto) || r.importe.moneda !== importe.moneda) return false;
    centros.add(r.centroDeCosto);
    if (r.importe.unidades === 0n || r.importe.unidades > 0n !== importe.unidades > 0n)
      return false;
    suma = sumar(suma, r.importe);
  }
  return suma.unidades === importe.unidades;
}
