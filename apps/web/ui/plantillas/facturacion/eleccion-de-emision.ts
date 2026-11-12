import { domicilioLibreDesdeTexto } from "../../../../../src/primitivas/domicilio/domicilio-libre";
import { numeroDeDocumentoDesdeTexto } from "../../../../../src/primitivas/identificacion-fiscal/documento";
import { nombreODenominacionDesdeTexto } from "../../../../../src/primitivas/texto/nombre-o-razon-social";
import { partirTipeado } from "../../../../../src/capacidades/experiencia/importe-tipeado";
import { cantidadDesdeTexto } from "../../../../../src/primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../../../src/primitivas/cantidad/errores";
import {
  exactoDeImporte,
  multiplicarPrecioPorCantidad,
  sumarExactos,
} from "../../../../../src/primitivas/dinero/monto-exacto";
import { importeATexto, importeCero } from "../../../../../src/primitivas/dinero/importe";
import { ARS } from "../../../../../src/primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../../../src/primitivas/dinero/precio-unitario";
import { prorratear } from "../../../../../src/primitivas/dinero/prorrateo";
import { POLITICA_VIGENTE, redondear } from "../../../../../src/primitivas/dinero/redondeo";
import type { TipoDeDocumentoVisible } from "./modelo-del-detalle";

/**
 * Lo que la persona escribe en «Emitir una factura» (8B, por pasos) y lo que se calcula con eso. Puro: sin React ni servidor. Todo el
 * dinero es TEXTO decimal y se opera con las primitivas (ADR-006), nunca con `number`. Es una sola emisión de productos, con el
 * precio de cada renglón con IVA incluido y sin descuento (D-84, D-85).
 *
 * Previene: mostrar un total distinto del que registra el servidor (la persona lo ve en «Revisar» y emite sobre esa cifra) y mandar
 * un importe que no es dinero. Chequeo: `test/web/emitir-calculo.test.ts` compara este cálculo con `calcularRenglones` del dominio
 * (el mismo algoritmo de ADR-006: cada renglón exacto, el total redondeado UNA vez y prorrateado entre los renglones).
 */

/** Quién recibe la factura (D-24): el consumidor final sin identificar, o un receptor escrito a mano. */
export type DocumentoElegido = "SIN_IDENTIFICAR" | TipoDeDocumentoVisible;

/** Los tipos de documento que se ofrecen: los del dominio (`TIPOS_DE_DOCUMENTO`); lo comprueba `test/web/emitir-modelo.test.ts`. */
export const DOCUMENTOS_PARA_ELEGIR: readonly TipoDeDocumentoVisible[] = [
  "CUIT",
  "CUIL",
  "CDI",
  "DNI",
  "PASAPORTE",
];

/** El documento que corresponde a un valor del selector, o `null` si no es ninguno de los que se ofrecen. */
export function documentoElegidoDe(valor: string): DocumentoElegido | null {
  if (valor === "SIN_IDENTIFICAR") return valor;
  return DOCUMENTOS_PARA_ELEGIR.find((d) => d === valor) ?? null;
}

export type ClienteEscrito = Readonly<{
  documento: DocumentoElegido;
  /** El número en su forma canónica (solo dígitos, o el pasaporte en mayúsculas; el campo da el formato): el servidor lo vuelve a validar (`primitivas/identificacion-fiscal/documento`). */
  numero: string;
  nombre: string;
  /** Una línea libre; solo se pide y se manda si el cliente no es el consumidor final. */
  domicilio: string;
  /** El nombre de la condición frente al IVA del receptor, o `""` si todavía no se eligió. */
  condicionIva: string;
}>;

export const clienteInicial: ClienteEscrito = {
  documento: "SIN_IDENTIFICAR",
  numero: "",
  nombre: "",
  domicilio: "",
  condicionIva: "",
};

export function conDocumento(c: ClienteEscrito, documento: DocumentoElegido): ClienteEscrito {
  // Cada tipo escribe y da formato distinto a su número: al cambiar de tipo se limpia (recortar un CUIT a DNI dejaría un documento válido pero equivocado).
  return { ...c, documento, numero: "" };
}

/** El consumidor final no escribe nada más: se manda sin documento ni nombre y con su condición (D-24). */
export const esConsumidorFinal = (c: ClienteEscrito): boolean => c.documento === "SIN_IDENTIFICAR";

/**
 * Qué campos del cliente no cumplen la regla de su dato (las MISMAS primitivas que usa el servidor: una sola fuente, no una copia). Solo
 * mira la forma de lo escrito; si el domicilio falta, o si la condición no corresponde, lo decide el servidor al emitir (D-24; interfaz
 * sobria: no se replican las reglas de negocio en la pantalla). El consumidor final sin identificar no escribe nada: nada que marcar.
 * Previene el fallo real de la primera prueba en Preview: un nombre numérico y un CUIT escrito como nombre pasaban hasta el final.
 */
export type CamposDelClienteInvalidos = Readonly<{
  numero: boolean;
  nombre: boolean;
  domicilio: boolean;
}>;

export function camposDelClienteInvalidos(c: ClienteEscrito): CamposDelClienteInvalidos {
  if (c.documento === "SIN_IDENTIFICAR") return { numero: false, nombre: false, domicilio: false };
  return {
    numero: !numeroDeDocumentoDesdeTexto(c.documento, c.numero.trim()).ok,
    nombre: !nombreODenominacionDesdeTexto(c.nombre.trim()).ok,
    domicilio: !domicilioLibreDesdeTexto(c.domicilio).ok,
  };
}

/** Un renglón tal como se está escribiendo. `id` identifica la fila al agregar y quitar (no viaja al servidor). */
export type RenglonEscrito = Readonly<{
  id: number;
  descripcion: string;
  /** Lo tipeado (coma decimal, como en es-AR): `cantidadCanonica` da el texto decimal. */
  cantidad: string;
  /** Texto decimal canónico (`"1234.50"`) que entrega `CampoImporte`, o `""`. */
  precio: string;
  /** El código de la alícuota («21», «10.5», «EXENTO»…), o `""` si todavía no se eligió. Solo se usa si la empresa discrimina IVA. */
  alicuota: string;
}>;

export const renglonVacio = (id: number): RenglonEscrito => ({
  id,
  descripcion: "",
  cantidad: "1",
  precio: "",
  alicuota: "",
});

export function conRenglon(
  renglones: readonly RenglonEscrito[],
  id: number,
  cambios: Partial<Omit<RenglonEscrito, "id">>,
): readonly RenglonEscrito[] {
  return renglones.map((r) => (r.id === id ? { ...r, ...cambios } : r));
}

export function sinRenglon(
  renglones: readonly RenglonEscrito[],
  id: number,
): readonly RenglonEscrito[] {
  return renglones.filter((r) => r.id !== id);
}

/** El número de renglón (desde 1) siguiente a los que hay: no repite el de uno quitado antes. */
export const idSiguiente = (renglones: readonly RenglonEscrito[]): number =>
  renglones.reduce((mayor, r) => (r.id > mayor ? r.id : mayor), 0) + 1;

// ---------------------------------------------------------------------------------------------------------------------
// La cantidad
// ---------------------------------------------------------------------------------------------------------------------

/** `numeric(18,4)`: hasta cuatro decimales y catorce dígitos enteros (`cantidad.ts`, `interno.ts`). */
const DECIMALES_DE_LA_CANTIDAD = 4;
const ENTEROS_DE_LA_CANTIDAD = 14;

/**
 * Lo que queda de lo tipeado en el campo «Cantidad»: dígitos con coma decimal (como el importe: un punto que agrupa de a tres es un
 * separador de miles, no un decimal), hasta cuatro decimales. Lo que no es un número se descarta al escribir.
 * SUPUESTO (DEC-0052) (del ingeniero, sin fuente del dueño): «1.000» es mil, por la convención es-AR de Anular (`partirTipeado`); revertirlo
 * es cambiar `partirTipeado`, que también usa el importe.
 */
export function limpiarCantidad(crudo: string): string {
  const { entera: cruda, decimal } = partirTipeado(crudo);
  if (cruda === "" && decimal === null) return "";
  const entera = cruda.replace(/^0+(?=\d)/, "").slice(0, ENTEROS_DE_LA_CANTIDAD) || "0";
  return decimal === null ? entera : `${entera},${decimal.slice(0, DECIMALES_DE_LA_CANTIDAD)}`;
}

/** El texto decimal de la cantidad (`"1.5"`), o `""` si no hay una cantidad. */
export function cantidadCanonica(tipeado: string): string {
  const limpia = limpiarCantidad(tipeado);
  if (limpia === "") return "";
  const canonica = limpia.replace(",", ".").replace(/\.$/, "");
  try {
    cantidadDesdeTexto(canonica);
    return canonica;
  } catch (error) {
    if (error instanceof ErrorDeValor) return "";
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// El cálculo: lo que se ve en «Revisar»
// ---------------------------------------------------------------------------------------------------------------------

export type CalculoDeLaEmision = Readonly<{
  /** El importe de cada renglón, en el orden de entrada (suman exactamente `total`). */
  importes: readonly string[];
  total: string;
}>;

/**
 * El total y el importe de cada renglón, con el algoritmo del servidor (IVA incluido, sin descuento: D-85): cada renglón se calcula
 * exacto, el total se redondea UNA vez y se prorratea entre los renglones. `null` si algún renglón no tiene una cantidad y un precio
 * que se puedan calcular: sin eso no hay total que mostrar (el servidor valida el resto, el rango del total incluido).
 */
export function calcularLaEmision(renglones: readonly RenglonEscrito[]): CalculoDeLaEmision | null {
  if (renglones.length === 0) return null;
  const datos = renglones.map((r) => ({
    cantidad: cantidadCanonica(r.cantidad),
    precio: r.precio,
  }));
  if (datos.some((d) => d.cantidad === "" || d.precio === "")) return null;
  try {
    const exactos = datos.map((d) =>
      multiplicarPrecioPorCantidad(
        ARS,
        precioUnitarioDesdeTexto(d.precio),
        cantidadDesdeTexto(d.cantidad),
      ),
    );
    const suma = exactos.reduce(sumarExactos, exactoDeImporte(importeCero(ARS)));
    const total = redondear(suma, POLITICA_VIGENTE);
    return {
      importes: prorratear(total, exactos).map(importeATexto),
      total: importeATexto(total),
    };
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}
