import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  precioUnitarioDesdeTexto,
  type PrecioUnitario,
} from "../../../primitivas/dinero/precio-unitario";

/**
 * PRECIO ABIERTO (decisiones 169 y 179; E4 §3.4): un producto sin precio cargado se vende escribiendo el importe en la venta. Lo escribe quien
 * agrega la línea (los tres roles), se guarda como `precio_unitario` con origen `ABIERTO`, con quién y cuándo en la auditoría. El servidor
 * manda: si el catálogo trae precio (de la empresa o de la sucursal), un importe enviado por el cliente se RECHAZA; si no trae y no se envió
 * nada, no se vende. El importe es dinero exacto: dígitos y hasta 2 decimales con punto, sin signo, de hasta 9 enteros (cota de la base); el
 * 0 es válido y pasa por la confirmación de venta a $0 (decisión 155).
 * Códigos: `IMPORTE_INVALIDO`, `PRECIO_ABIERTO_NO_PERMITIDO`, `PRODUCTO_SIN_PRECIO`.
 */
// fuente-unica: ajeno — coincide con un largo de 9 de otra primitiva; son los enteros máximos de un importe (cota 1.000.000.000 de la base), dato sin relación
const FORMA_DEL_IMPORTE = /^[0-9]{1,9}(\.[0-9]{1,2})?$/;

export type ErrorDePrecioAbierto =
  "IMPORTE_INVALIDO" | "PRECIO_ABIERTO_NO_PERMITIDO" | "PRODUCTO_SIN_PRECIO";

export function importeDePrecioAbierto(
  texto: string,
): Resultado<PrecioUnitario, "IMPORTE_INVALIDO"> {
  return FORMA_DEL_IMPORTE.test(texto)
    ? ok(precioUnitarioDesdeTexto(texto))
    : err("IMPORTE_INVALIDO");
}

export type PrecioDeLaLinea = Readonly<{
  origen: "CATALOGO" | "ABIERTO";
  precioUnitario: PrecioUnitario;
}>;

/**
 * Qué precio lleva la línea. `precioCotizado` es el del catálogo (`null` si el producto está en precio abierto); `precioAbierto` es lo que
 * escribió quien vende (`undefined` si no escribió nada).
 */
export function decidirPrecioDeLaLinea(
  entrada: Readonly<{
    precioCotizado: PrecioUnitario | null;
    precioAbierto: string | undefined;
  }>,
): Resultado<PrecioDeLaLinea, ErrorDePrecioAbierto> {
  if (entrada.precioCotizado !== null) {
    return entrada.precioAbierto === undefined
      ? ok({ origen: "CATALOGO", precioUnitario: entrada.precioCotizado })
      : err("PRECIO_ABIERTO_NO_PERMITIDO");
  }
  if (entrada.precioAbierto === undefined) return err("PRODUCTO_SIN_PRECIO");
  const importe = importeDePrecioAbierto(entrada.precioAbierto);
  return importe.ok ? ok({ origen: "ABIERTO", precioUnitario: importe.valor }) : importe;
}
