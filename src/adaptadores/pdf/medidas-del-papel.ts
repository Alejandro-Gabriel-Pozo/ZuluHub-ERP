/**
 * Las medidas de la hoja que el PDF REPITE de la hoja en pantalla (`apps/web/ui/plantillas/facturacion/impresion/HojaA4.module.css`): tamaños
 * de letra en `pt`, anchos de columna y de la letra del comprobante en `mm`. Viven acá, en un solo lugar del adaptador, y
 * `medidas-del-papel.test.ts` las compara con el CSS de la pantalla: si alguien cambia una de las dos, la prueba falla. Previene: que el PDF
 * y la pantalla dibujen el mismo comprobante con otra tipografía o columnas más anchas sin que nadie lo note. El adaptador no puede importar
 * la web, por eso la fuente de la pantalla (el CSS) no se comparte: se ata con la prueba.
 */

export const ANCHOS_DE_COLUMNA_MM = { cantidad: 18, precio: 30, iva: 22, importe: 30 } as const;
export const ANCHO_DE_LA_LETRA_MM = 24;
export const ANCHO_DEL_QR_MM = 28;

export const LETRA_EN_PT = {
  /** El cuerpo de la hoja (`.hoja`). */
  base: 9,
  /** El aviso de homologación (`.homologacion`). */
  aviso: 12,
  /** La letra grande del comprobante (`.letraGrande`). */
  letra: 30,
  /** «COD. 006», el pie del CAE, la transparencia fiscal y «Hoja k de n». */
  chica: 8,
  /** El nombre de fantasía y de la sucursal, y el tipo de comprobante (`.nombre`, `.rotulo`). */
  nombre: 13,
  /** El número del comprobante (`.numero`). */
  numeroDeComprobante: 11,
  /** La fila del total (`.filaFuerte`). */
  totalFuerte: 11,
} as const;
