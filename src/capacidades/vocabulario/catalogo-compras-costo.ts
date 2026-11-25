/**
 * El texto de «Tomar el costo de la factura» (prefijo `compras.`, Compras 4, PR C). Es el botón y el título de la hoja que toma el costo de una línea recibida de la factura que la cubre; lo aprobó el dueño
 * el 25/11/2026 (pregunta 2 de Compras 4, «b chica»; DEC-0903). Va en su archivo porque `catalogo-compras.ts` está en el tope de 400 líneas (hallazgo: ese tope obliga a abrir una parte nueva por cada
 * texto que se agregue al módulo). Sus demás textos («Precio neto», «Cancelar», «Cerrar») ya existen y se reutilizan.
 */
export const TEXTOS_DE_COMPRAS_COSTO = {
  "compras.factura.tomar_costo": {
    porDefecto: "Tomar el costo de la factura",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/facturas/textos-de-facturas.ts",
        nombre: "textosDeFacturas",
      },
    ],
    fuente: { decision: "DEC-0903" },
  },
} as const;
