/** Parte 2 de 2 de `TEXTOS_DE_FISCAL_EMITIR` (`catalogo-fiscal-emitir.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_EMITIR_2 = {
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 9: «Cliente del Exterior».
  "fiscal.pantalla.emitir_condicion_cliente_del_exterior": {
    porDefecto: "Cliente del Exterior",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 10: «IVA Liberado – Ley N° 19.640».
  "fiscal.pantalla.emitir_condicion_iva_liberado": {
    porDefecto: "IVA Liberado – Ley N° 19.640",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 15: «IVA No Alcanzado».
  "fiscal.pantalla.emitir_condicion_iva_no_alcanzado": {
    porDefecto: "IVA No Alcanzado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 5: «Consumidor Final».
  "fiscal.pantalla.emitir_condicion_consumidor_final": {
    porDefecto: "Consumidor Final",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },

  // E1 §10 (`Pedernal-docs/11-especificaciones/e1-facturador-especificacion.md`): textos de facturar un ticket. POR APROBAR por el dueño (S5 §3).
  // «Venta» de `venta-rapida.html:352`; «N.º» de `ticket.html:24`; la combinación («Venta N.º 124») es la de `emitir.html?estado=venta` (prototipos-facturador).
  "fiscal.pantalla.emitir_venta_numero": {
    porDefecto: "Venta N.º {numero}",
    marcadores: ["numero"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision-de-un-ticket.ts",
        nombre: "tituloDelTicket",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-pendientes.ts",
        nombre: "armarLosPendientes",
      },
    ],
    fuente: "HEREDADO",
  },
  // Encargo S5 (`orquestacion-ola-1.md`), decisión 57 (`catalogo-y-niveles-maqueta.md:1333`) y el prototipo `listado.html` (`index.html:11`): el título de la lista y el enlace que lleva a ella.
  "fiscal.pantalla.pendientes_titulo": {
    porDefecto: "Pendientes de facturar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/facturacion/comprobantes/pendientes/page.tsx",
        nombre: "PaginaDePendientesDeFacturar",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "enlaceDePendientes",
      },
    ],
    fuente: "HEREDADO",
  },
  // Decisión 175 (lo menos posible) y el patrón del aviso vacío de `listado.html`; el vacío de comprobantes («Todavía no emitiste comprobantes») sería falso acá.
  "fiscal.pantalla.pendientes_vacio": {
    porDefecto: "No hay ventas pendientes de facturar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-pendientes.ts",
        nombre: "armarLosPendientes",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
