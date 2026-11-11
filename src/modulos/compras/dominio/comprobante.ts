import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import type { CondicionIva } from "../../../primitivas/identificacion-fiscal/condicion-iva";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";
import {
  MAXIMO_DE_UNIDADES_EXACTAS,
  UNO_DE_CANTIDAD,
  UNO_DE_IMPORTE,
  UNO_DE_PRECIO,
  leerCantidadPositiva,
  leerImporte,
  leerPrecioPositivo,
  textoDeImporte,
} from "./decimal";

/**
 * El comprobante del proveedor (E9 §3.3 y §3.4; `e9-arca-datos-de-compras-panorama.md`): tipos, letras, alícuotas, tributos y las cuentas del Libro
 * de IVA Digital (neto gravado, no gravado, exento, IVA por alícuota, tributos y crédito fiscal computable aparte). Pura, con `bigint`: sin `number`
 * para importes, sin reloj ni azar. No calcula retenciones ni decide nada contable (PC-1 a PC-5 siguen abiertas).
 *
 * Los nueve tipos y las ocho alícuotas viven en `fiscal/dominio` y la regla de módulos impide importarlos (D-E9-9): acá hay una COPIA y la prueba
 * `test/arquitectura/compras-fuente-unica.test.ts` falla si difieren. El IVA se calcula POR LÍNEA, redondeado una vez con la política vigente (PC-5,
 * supuesto). El crédito fiscal computable sigue la regla inicial del PC-4 (a confirmar con el contador): igual al IVA en una Factura A y cero en
 * las demás. En una B o C (sin IVA discriminado) el importe de la línea es el neto y no hay alícuota.
 */
export const TIPOS_DE_COMPROBANTE_DE_PROVEEDOR = [
  "FACTURA_A",
  "FACTURA_B",
  "FACTURA_C",
  "NOTA_DEBITO_A",
  "NOTA_DEBITO_B",
  "NOTA_DEBITO_C",
  "NOTA_CREDITO_A",
  "NOTA_CREDITO_B",
  "NOTA_CREDITO_C",
] as const;
export type TipoDeComprobanteDeProveedor = (typeof TIPOS_DE_COMPROBANTE_DE_PROVEEDOR)[number];

export type LetraDeComprobante = "A" | "B" | "C";
export type ClaseDeComprobante = "FACTURA" | "NOTA_DE_DEBITO" | "NOTA_DE_CREDITO";

type FichaDeTipo = Readonly<{
  letra: LetraDeComprobante;
  clase: ClaseDeComprobante;
  /** El código de ARCA (WSFE). */
  codigo: number;
}>;

export const FICHA_DE_TIPO_DE_COMPROBANTE: Readonly<
  Record<TipoDeComprobanteDeProveedor, FichaDeTipo>
> = {
  FACTURA_A: { letra: "A", clase: "FACTURA", codigo: 1 },
  NOTA_DEBITO_A: { letra: "A", clase: "NOTA_DE_DEBITO", codigo: 2 },
  NOTA_CREDITO_A: { letra: "A", clase: "NOTA_DE_CREDITO", codigo: 3 },
  FACTURA_B: { letra: "B", clase: "FACTURA", codigo: 6 },
  NOTA_DEBITO_B: { letra: "B", clase: "NOTA_DE_DEBITO", codigo: 7 },
  NOTA_CREDITO_B: { letra: "B", clase: "NOTA_DE_CREDITO", codigo: 8 },
  FACTURA_C: { letra: "C", clase: "FACTURA", codigo: 11 },
  NOTA_DEBITO_C: { letra: "C", clase: "NOTA_DE_DEBITO", codigo: 12 },
  NOTA_CREDITO_C: { letra: "C", clase: "NOTA_DE_CREDITO", codigo: 13 },
};

export function esTipoDeComprobanteDeProveedor(
  texto: string,
): texto is TipoDeComprobanteDeProveedor {
  return (TIPOS_DE_COMPROBANTE_DE_PROVEEDOR as readonly string[]).includes(texto);
}

export const ALICUOTAS_DE_COMPRA = [
  "0",
  "2.5",
  "5",
  "10.5",
  "21",
  "27",
  "EXENTO",
  "NO_GRAVADO",
] as const;
export type AlicuotaDeCompra = (typeof ALICUOTAS_DE_COMPRA)[number];

export function esAlicuotaDeCompra(texto: string): texto is AlicuotaDeCompra {
  return (ALICUOTAS_DE_COMPRA as readonly string[]).includes(texto);
}

/** Punto de venta de 1 a 99998 y número de 1 a 99999999 (E9 §4, «Validación»). */
export const PUNTO_DE_VENTA_MINIMO = 1;
export const PUNTO_DE_VENTA_MAXIMO = 99998;
export const NUMERO_DE_COMPROBANTE_MINIMO = 1;
export const NUMERO_DE_COMPROBANTE_MAXIMO = 99999999;

export const esPuntoDeVentaValido = (n: number): boolean =>
  Number.isInteger(n) && n >= PUNTO_DE_VENTA_MINIMO && n <= PUNTO_DE_VENTA_MAXIMO;
export const esNumeroDeComprobanteValido = (n: number): boolean =>
  Number.isInteger(n) && n >= NUMERO_DE_COMPROBANTE_MINIMO && n <= NUMERO_DE_COMPROBANTE_MAXIMO;

/**
 * La letra que se espera de un proveedor según su condición frente al IVA (D110, S-15): inscripto → A, monotributo → C; el resto, `null` («se elige a
 * mano»). SUPUESTO (E9-T5): solo `MONOTRIBUTO` (no el social ni el promovido) da C; el resto queda a mano. Costo de revertir: bajo (una entrada).
 */
export function letraEsperadaDesdeCondicion(
  condicion: CondicionIva | null,
): LetraDeComprobante | null {
  if (condicion === "RESPONSABLE_INSCRIPTO") return "A";
  if (condicion === "MONOTRIBUTO") return "C";
  return null;
}

/** El aviso de D112: la letra del comprobante no es la esperada (no frena; sin letra esperada no hay nada que avisar). */
export function esLetraNoEsperada(
  esperada: LetraDeComprobante | null,
  tipo: TipoDeComprobanteDeProveedor,
): boolean {
  return esperada !== null && FICHA_DE_TIPO_DE_COMPROBANTE[tipo].letra !== esperada;
}

export const claseDeTipoDeComprobante = (tipo: TipoDeComprobanteDeProveedor): ClaseDeComprobante =>
  FICHA_DE_TIPO_DE_COMPROBANTE[tipo].clase;

// ---- tributos ---------------------------------------------------------------------------------

export const TIPOS_DE_TRIBUTO = [
  "PERCEPCION_IVA",
  "PERCEPCION_OTROS_NACIONALES",
  "PERCEPCION_INGRESOS_BRUTOS",
  "PERCEPCION_MUNICIPAL",
  "IMPUESTO_INTERNO",
  "OTRO_TRIBUTO",
  "PERCEPCION_SIN_CLASIFICAR",
] as const;
export type TipoDeTributo = (typeof TIPOS_DE_TRIBUTO)[number];

/** La descripción de un «otro tributo» (`Desc` del WSFE, id 99): una línea de hasta 80 caracteres. */
// fuente-unica: ajeno — el 80 de la descripción de «otro tributo» del WSFE es otro dato que el nombre de cocina
export const LARGO_MAXIMO_DE_LA_DESCRIPCION_DE_TRIBUTO = 80;

export type EntradaDeTributo = Readonly<{
  tipo: string;
  descripcion?: string | null;
  baseImponible?: string | null;
  /** Porcentaje de 0 a 100 con hasta 2 decimales (`numeric(5,2)`). */
  alicuota?: string | null;
  importe: string;
}>;

export type TributoValido = Readonly<{
  tipo: TipoDeTributo;
  descripcion: string | null;
  baseImponible: string | null;
  alicuota: string | null;
  importe: string;
}>;

// ---- el comprobante completo --------------------------------------------------------------------

export type EntradaDeLineaDeComprobante = Readonly<{
  /** Texto decimal de hasta 4 decimales, mayor que cero. */
  cantidadFacturada: string;
  /** Texto decimal de hasta 6 decimales, mayor que cero. */
  precioNeto: string;
  /** Una de las ocho; `null` en una B o C (no discriminan IVA) y obligatoria en una A. */
  alicuota: string | null;
}>;

export type EntradaDeComprobante = Readonly<{
  tipo: string;
  lineas: readonly EntradaDeLineaDeComprobante[];
  tributos?: readonly EntradaDeTributo[];
  totalSegunFactura: string;
}>;

export type LineaCalculada = Readonly<{
  netoDeLinea: string;
  ivaDeLinea: string;
  alicuota: AlicuotaDeCompra | null;
}>;

export type ImportePorAlicuota = Readonly<{
  alicuota: AlicuotaDeCompra;
  neto: string;
  iva: string;
}>;

export type ComprobanteCalculado = Readonly<{
  tipo: TipoDeComprobanteDeProveedor;
  lineas: readonly LineaCalculada[];
  importesPorAlicuota: readonly ImportePorAlicuota[];
  netoGravado: string;
  noGravado: string;
  exento: string;
  iva: string;
  tributos: readonly TributoValido[];
  tributosTotal: string;
  creditoFiscalComputable: string;
  totalCalculado: string;
  totalSegunFactura: string;
  /** `true` si los dos totales difieren a lo sumo en un centavo (la tolerancia del WSFE). */
  totalCoincide: boolean;
}>;

export type ErrorDeComprobante =
  | "TIPO_DE_COMPROBANTE_INVALIDO"
  | "LINEAS_REQUERIDAS"
  | "CANTIDAD_INVALIDA"
  | "PRECIO_INVALIDO"
  | "ALICUOTA_INVALIDA"
  | "ALICUOTA_REQUERIDA"
  | "ALICUOTA_NO_DISCRIMINADA"
  | "TRIBUTO_INVALIDO"
  | "TOTAL_INVALIDO"
  | "FUERA_DE_RANGO";

type R<T> = Resultado<T, ErrorDeComprobante>;

/** La tolerancia entre el total calculado y el de la factura: un centavo (0,01, la de ARCA, códigos 10029 y 10048 del WSFE). */
export const TOLERANCIA_DEL_TOTAL_EN_CENTAVOS = 1n;

export function totalCoincide(calculado: bigint, segunFactura: bigint): boolean {
  // Stryker disable next-line EqualityOperator: con diferencia cero el orden de la resta no cambia el resultado
  const diferencia = calculado > segunFactura ? calculado - segunFactura : segunFactura - calculado;
  return diferencia <= TOLERANCIA_DEL_TOTAL_EN_CENTAVOS;
}

/** El 100 % en las unidades mínimas de un porcentaje (la escala sale de la primitiva). */
const CIEN_POR_CIENTO = porcentajeDesdeTexto("100").unidades;

/** El IVA de una línea: `neto × porcentaje`, redondeado una vez (PC-5). `neto` en centavos; el porcentaje en centésimas de punto (`porcentajeDesdeTexto`). */
function ivaDeLinea(neto: bigint, alicuota: AlicuotaDeCompra): bigint {
  if (alicuota === "EXENTO" || alicuota === "NO_GRAVADO") return 0n;
  const porcentaje = porcentajeDesdeTexto(alicuota).unidades;
  return dividirRedondeando(neto * porcentaje, CIEN_POR_CIENTO, POLITICA_VIGENTE);
}

/** El neto de una línea en centavos: `precio × cantidad`, redondeado una vez. */
function netoDeLinea(precio: bigint, cantidad: bigint): bigint {
  return dividirRedondeando(
    precio * cantidad * UNO_DE_IMPORTE,
    UNO_DE_PRECIO * UNO_DE_CANTIDAD,
    POLITICA_VIGENTE,
  );
}

function leerTributo(entrada: EntradaDeTributo): TributoValido | null {
  const tipo = entrada.tipo;
  if (!(TIPOS_DE_TRIBUTO as readonly string[]).includes(tipo)) return null;
  const importe = leerImporte(entrada.importe);
  if (importe === null || importe < 0n) return null;
  let descripcion: string | null = null;
  const texto = entrada.descripcion ?? null;
  if (texto !== null && texto.trim() !== "") {
    const valida = textoDeUnaLineaDesdeTexto(texto, {
      maximo: LARGO_MAXIMO_DE_LA_DESCRIPCION_DE_TRIBUTO,
      exigirUnaLetra: true,
    });
    if (!valida.ok) return null;
    descripcion = valida.valor;
  }
  if (tipo === "OTRO_TRIBUTO" && descripcion === null) return null;
  const base = entrada.baseImponible ?? null;
  if (base !== null) {
    const unidades = leerImporte(base);
    if (unidades === null || unidades < 0n) return null;
  }
  const alicuota = entrada.alicuota ?? null;
  if (alicuota !== null) {
    const unidades = leerImporte(alicuota);
    if (unidades === null || unidades < 0n || unidades > 100n * UNO_DE_IMPORTE) return null;
  }
  return {
    tipo: tipo as TipoDeTributo,
    descripcion,
    baseImponible: base,
    alicuota,
    importe: textoDeImporte(importe),
  };
}

/**
 * Las cuentas del comprobante. El primer error, en el orden: tipo, líneas, cada línea (cantidad, precio, alícuota), tributos y total según la factura.
 * Los dos totales (el calculado y el que dice el papel) se devuelven siempre y su diferencia NO frena la carga (`compras.md D-64`): `totalCoincide` solo informa.
 */
export function calcularComprobante(entrada: EntradaDeComprobante): R<ComprobanteCalculado> {
  if (!esTipoDeComprobanteDeProveedor(entrada.tipo)) return err("TIPO_DE_COMPROBANTE_INVALIDO");
  const tipo = entrada.tipo;
  if (entrada.lineas.length === 0) return err("LINEAS_REQUERIDAS");
  const discrimina = FICHA_DE_TIPO_DE_COMPROBANTE[tipo].letra === "A";

  const lineas: LineaCalculada[] = [];
  // La clave `null` (B y C) no sale: el resultado recorre solo las ocho alícuotas.
  const porAlicuota = new Map<AlicuotaDeCompra | null, { neto: bigint; iva: bigint }>();
  let netoGravado = 0n;
  let noGravado = 0n;
  let exento = 0n;
  let iva = 0n;
  for (const linea of entrada.lineas) {
    const cantidad = leerCantidadPositiva(linea.cantidadFacturada);
    if (cantidad === null) return err("CANTIDAD_INVALIDA");
    const precio = leerPrecioPositivo(linea.precioNeto);
    if (precio === null) return err("PRECIO_INVALIDO");
    let alicuota: AlicuotaDeCompra | null = null;
    if (discrimina) {
      if (linea.alicuota === null) return err("ALICUOTA_REQUERIDA");
      if (!esAlicuotaDeCompra(linea.alicuota)) return err("ALICUOTA_INVALIDA");
      alicuota = linea.alicuota;
    } else if (linea.alicuota !== null) {
      return err("ALICUOTA_NO_DISCRIMINADA");
    }
    const neto = netoDeLinea(precio, cantidad);
    const ivaLinea = alicuota === null ? 0n : ivaDeLinea(neto, alicuota);
    lineas.push({
      netoDeLinea: textoDeImporte(neto),
      ivaDeLinea: textoDeImporte(ivaLinea),
      alicuota,
    });
    iva += ivaLinea;
    if (alicuota === "NO_GRAVADO") noGravado += neto;
    else if (alicuota === "EXENTO") exento += neto;
    else netoGravado += neto;
    const previo = porAlicuota.get(alicuota) ?? { neto: 0n, iva: 0n };
    porAlicuota.set(alicuota, { neto: previo.neto + neto, iva: previo.iva + ivaLinea });
  }

  const tributos: TributoValido[] = [];
  let tributosTotal = 0n;
  for (const crudo of entrada.tributos ?? []) {
    const tributo = leerTributo(crudo);
    if (tributo === null) return err("TRIBUTO_INVALIDO");
    tributos.push(tributo);
    tributosTotal += leerImporte(tributo.importe) ?? 0n;
  }

  const segun = leerImporte(entrada.totalSegunFactura);
  if (segun === null || segun < 0n) return err("TOTAL_INVALIDO");

  const total = netoGravado + noGravado + exento + iva + tributosTotal;
  if (total > MAXIMO_DE_UNIDADES_EXACTAS) return err("FUERA_DE_RANGO");
  return ok({
    tipo,
    lineas,
    importesPorAlicuota: ALICUOTAS_DE_COMPRA.flatMap((alicuota) => {
      const suma = porAlicuota.get(alicuota);
      return suma === undefined
        ? []
        : [{ alicuota, neto: textoDeImporte(suma.neto), iva: textoDeImporte(suma.iva) }];
    }),
    netoGravado: textoDeImporte(netoGravado),
    noGravado: textoDeImporte(noGravado),
    exento: textoDeImporte(exento),
    iva: textoDeImporte(iva),
    tributos,
    tributosTotal: textoDeImporte(tributosTotal),
    creditoFiscalComputable: textoDeImporte(tipo === "FACTURA_A" ? iva : 0n),
    totalCalculado: textoDeImporte(total),
    totalSegunFactura: textoDeImporte(segun),
    totalCoincide: totalCoincide(total, segun),
  });
}
