/** Parte 2 de 7 de `TEXTOS_DE_FISCAL_PANTALLAS` (`catalogo-fiscal-pantallas.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_PANTALLAS_2 = {
  // Rótulos de los datos. PROTO: «Fecha», «CAE», «Cliente», «Renglones», «Total» y «CAE … · vence 24/10/2026». «Punto de
  // venta»: CONTRATO («Punto de venta y origen» entre lo que se ve). No hay rótulo «Número»: ya está en el título.
  "fiscal.pantalla.rotulo_fecha": {
    porDefecto: "Fecha",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "datosDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.rotulo_cae": {
    porDefecto: "CAE",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "datosDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.cae_con_vencimiento": {
    porDefecto: "{cae} · vence {vencimiento}",
    marcadores: ["cae", "vencimiento"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "armarLaHoja",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "datosDe",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.rotulo_cliente": {
    porDefecto: "Cliente",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "receptorDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "clienteDeLaRevision",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosPasos",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "datosDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.rotulo_punto_de_venta": {
    porDefecto: "Punto de venta",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/filtros-del-listado.ts",
        nombre: "armarLosFiltros",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision-de-un-ticket.ts",
        nombre: "vistaDeLaRevisionDeUnTicket",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLaRevision",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "datosDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.rotulo_renglones": {
    porDefecto: "Renglones",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision-de-un-ticket.ts",
        nombre: "vistaDeLaRevisionDeUnTicket",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLaRevision",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosPasos",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "armarElDetalle",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.rotulo_total": {
    porDefecto: "Total",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "totalesDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision-de-un-ticket.ts",
        nombre: "vistaDeLaRevisionDeUnTicket",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLaRevision",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-detalle.ts",
        nombre: "armarElDetalle",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "armarElListado",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
