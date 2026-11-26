import {
  cantidadATexto,
  cantidadDesdeTexto,
  DECIMALES_DE_CANTIDAD,
  type Cantidad,
} from "../cantidad/cantidad";
import { ErrorDeValor } from "../cantidad/errores";
import { MAXIMO_DE_CUENTAS_POR_ITEMS } from "./limites-de-division";
import { importeATexto } from "../dinero/importe";
import { ARS } from "../dinero/moneda";
import { multiplicarPrecioPorCantidad } from "../dinero/monto-exacto";
import { precioUnitarioDesdeTexto, type PrecioUnitario } from "../dinero/precio-unitario";
import { POLITICA_VIGENTE, redondear } from "../dinero/redondeo";
import { err, ok, type Resultado } from "../resultado/resultado";
import { repartirItemCompartido } from "./reparto";

/**
 * DIVIDIR LA CUENTA POR ÍTEMS (E7 §3.9, D90 y D117). Por cada línea vigente, UNA de tres formas: `ENTERO` (la línea completa a una cuenta),
 * `POR_UNIDADES` (las unidades se reparten, cada cantidad múltiplo del paso congelado y la suma es la cantidad de la línea) o `COMPARTIDO` (el
 * importe se reparte en partes iguales entre las cuentas elegidas; el centavo que sobra va a la de menor número). La validación es COMPLETA antes de
 * escribir (D117): nada sin asignar, las unidades suman, ninguna cuenta queda vacía. Devuelve la lista de copias a hacer (`copiarLineaEnTx`, X3).
 * Previene: una división a medias (un plato que desaparece o se cobra dos veces) y el centavo que nadie se lleva. Puro: sin reloj ni azar.
 */
export type LineaADividir = Readonly<{
  lineaId: string;
  /** Texto decimal exacto (hasta 4 decimales). */
  cantidad: string;
  pasoDeCantidad: string;
  /** Precio unitario congelado (hasta 6 decimales). */
  precioUnitario: string;
}>;

export type Asignacion = Readonly<{ lineaId: string }> &
  (
    | Readonly<{ forma: "ENTERO"; parte: number }>
    /** Una cantidad por cuenta (la de la posición `i` es para la Cuenta `i + 1`); `"0"` = nada para esa cuenta. */
    | Readonly<{ forma: "POR_UNIDADES"; cantidades: readonly string[] }>
    | Readonly<{ forma: "COMPARTIDO"; partes: readonly number[] }>
  );

export type ModoDeCopia = "COMPLETA" | "POR_UNIDADES" | "COMPARTIDA";

export type CopiaAHacer = Readonly<{
  lineaOrigenId: string;
  /** La cuenta hija (1 hasta el máximo de cuentas por ítems). */
  parte: number;
  modo: ModoDeCopia;
  /** Texto decimal exacto: la cantidad de la copia (en `COMPARTIDA`, la de la línea original). */
  cantidad: string;
  /** Solo en `COMPARTIDA`: lo que le toca de la línea, en pesos con 2 decimales. */
  importeFijo?: string;
}>;

export type ErrorDeDivision =
  | "PARTES_INVALIDAS"
  | "DIVISION_INCOMPLETA"
  | "PARTE_VACIA"
  | "UNIDADES_NO_SUMAN"
  | "CANTIDAD_INVALIDA";

export const MINIMO_DE_CUENTAS_POR_ITEMS = 2;

function leerCantidad(texto: string): Cantidad | null {
  try {
    return cantidadDesdeTexto(texto);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

function leerPrecio(texto: string): PrecioUnitario | null {
  try {
    return precioUnitarioDesdeTexto(texto);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

const parteValida = (n: number, partes: number): boolean =>
  Number.isSafeInteger(n) && n >= 1 && n <= partes;

export function planDeDivision(
  entrada: Readonly<{
    partes: number;
    lineas: readonly LineaADividir[];
    asignaciones: readonly Asignacion[];
  }>,
): Resultado<readonly CopiaAHacer[], ErrorDeDivision> {
  const { partes, lineas, asignaciones } = entrada;
  if (
    !Number.isSafeInteger(partes) ||
    partes < MINIMO_DE_CUENTAS_POR_ITEMS ||
    partes > MAXIMO_DE_CUENTAS_POR_ITEMS
  ) {
    return err("PARTES_INVALIDAS");
  }
  // Una asignación por línea, ni una de más ni una de menos: con las líneas distintas y tantas asignaciones como líneas, una ajena o repetida deja
  // otra línea sin asignación, y eso lo corta la búsqueda de más abajo (nada sin asignar, nada repetido ni ajeno).
  if (
    lineas.length === 0 ||
    new Set(lineas.map((l) => l.lineaId)).size !== lineas.length ||
    asignaciones.length !== lineas.length
  ) {
    return err("DIVISION_INCOMPLETA");
  }
  const copias: CopiaAHacer[] = [];
  for (const linea of lineas) {
    const asignacion = asignaciones.find((a) => a.lineaId === linea.lineaId);
    if (asignacion === undefined) return err("DIVISION_INCOMPLETA");
    const cantidad = leerCantidad(linea.cantidad);
    const paso = leerCantidad(linea.pasoDeCantidad);
    const precio = leerPrecio(linea.precioUnitario);
    if (cantidad === null || paso === null || precio === null || paso.unidades === 0n) {
      return err("CANTIDAD_INVALIDA");
    }
    if (asignacion.forma === "ENTERO") {
      if (!parteValida(asignacion.parte, partes)) return err("PARTES_INVALIDAS");
      copias.push({
        lineaOrigenId: linea.lineaId,
        parte: asignacion.parte,
        modo: "COMPLETA",
        cantidad: cantidadATexto(cantidad),
      });
    } else if (asignacion.forma === "POR_UNIDADES") {
      if (asignacion.cantidades.length !== partes) return err("UNIDADES_NO_SUMAN");
      let suma = 0n;
      const desde = copias.length;
      for (const [i, texto] of asignacion.cantidades.entries()) {
        const parcial = leerCantidad(texto);
        if (parcial === null) return err("CANTIDAD_INVALIDA");
        if (parcial.unidades % paso.unidades !== 0n) return err("UNIDADES_NO_SUMAN");
        suma += parcial.unidades;
        if (parcial.unidades > 0n) {
          copias.push({
            lineaOrigenId: linea.lineaId,
            parte: i + 1,
            modo: "POR_UNIDADES",
            cantidad: cantidadATexto(parcial),
          });
        }
      }
      if (suma !== cantidad.unidades) return err("UNIDADES_NO_SUMAN");
      // Todas las unidades a UNA sola cuenta es pasar la línea entera (la base pide dos partes o más para repartir por unidades).
      if (copias.length - desde === 1) {
        const unica = copias[desde] as CopiaAHacer;
        copias[desde] = { ...unica, modo: "COMPLETA" };
      }
    } else {
      if (!asignacion.partes.every((p) => parteValida(p, partes))) return err("PARTES_INVALIDAS");
      const exacto = multiplicarPrecioPorCantidad(ARS, precio, cantidad);
      const importe = importeATexto(redondear(exacto, POLITICA_VIGENTE));
      const reparto = repartirItemCompartido(importe, asignacion.partes);
      if (!reparto.ok) return err("PARTES_INVALIDAS");
      for (const r of reparto.valor) {
        copias.push({
          lineaOrigenId: linea.lineaId,
          parte: r.parte,
          modo: "COMPARTIDA",
          cantidad: cantidadATexto(cantidad),
          importeFijo: r.importe,
        });
      }
    }
  }
  for (let parte = 1; parte <= partes; parte++) {
    if (!copias.some((c) => c.parte === parte)) return err("PARTE_VACIA");
  }
  return ok(copias);
}

/**
 * Lo que suma cada cuenta hija de un plan (`planDeDivision`), con la MISMA cuenta que el servidor (precio por cantidad redondeado; lo compartido, su importe fijo): la usa la pantalla para mostrar los totales antes de
 * confirmar. El de la posición `i` es el de la Cuenta `i + 1`, como texto decimal de 2 decimales. Una línea o un precio que no se leen dan `null` (nunca un total a medias).
 */
export function totalesDeLaDivision(
  partes: number,
  lineas: readonly LineaADividir[],
  copias: readonly CopiaAHacer[],
): readonly string[] | null {
  const totales: bigint[] = Array.from({ length: partes }, () => 0n);
  for (const c of copias) {
    const linea = lineas.find((l) => l.lineaId === c.lineaOrigenId);
    const cantidad = leerCantidad(c.cantidad);
    const precio = linea === undefined ? null : leerPrecio(linea.precioUnitario);
    if (linea === undefined || cantidad === null || precio === null) return null;
    const texto =
      c.importeFijo ??
      importeATexto(
        redondear(multiplicarPrecioPorCantidad(ARS, precio, cantidad), POLITICA_VIGENTE),
      );
    const indice = c.parte - 1;
    if (indice < 0 || indice >= partes) return null;
    totales[indice] = (totales[indice] ?? 0n) + BigInt(texto.replace(".", ""));
  }
  return totales.map((t) => {
    const digitos = t.toString().padStart(3, "0");
    return `${digitos.slice(0, -2)}.${digitos.slice(-2)}`;
  });
}

/** Cuántos pasos de cantidad tiene una línea (3 gaseosas con paso 1 → 3); `null` si no es un múltiplo entero del paso o no se lee. Es lo que se reparte al dividir «por unidades». */
export function pasosDeLaLinea(cantidad: string, paso: string): number | null {
  const c = leerCantidad(cantidad);
  const p = leerCantidad(paso);
  if (c === null || p === null || p.unidades === 0n || c.unidades % p.unidades !== 0n) return null;
  const pasos = c.unidades / p.unidades;
  return pasos <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(pasos) : null;
}

/** La cantidad de `pasos` pasos (2 pasos de «0.5» → «1»), como texto decimal exacto; `null` si no se lee. Sin `number` de por medio: la cuenta es de enteros escalados. */
export function cantidadPorPasos(paso: string, pasos: number): string | null {
  const p = leerCantidad(paso);
  if (p === null || !Number.isSafeInteger(pasos) || pasos < 0) return null;
  const digitos = (p.unidades * BigInt(pasos)).toString().padStart(DECIMALES_DE_CANTIDAD + 1, "0");
  const total = leerCantidad(
    `${digitos.slice(0, -DECIMALES_DE_CANTIDAD)}.${digitos.slice(-DECIMALES_DE_CANTIDAD)}`,
  );
  return total === null ? null : cantidadATexto(total);
}
