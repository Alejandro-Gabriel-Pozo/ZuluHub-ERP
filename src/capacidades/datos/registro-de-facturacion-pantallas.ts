import type { DefinicionDeDato } from "./tipos-de-datos";

/**
 * Datos de las pantallas del facturador (filtros del listado y renglones de «Emitir») que no estaban en `registro-de-facturacion.ts`: fragmento propio para no tocar
 * las mismas líneas que otras ramas. `ponerPor` es la acción del caso de uso o consulta que respalda la pantalla (`comprobantes.ver` filtra el listado;
 * `comprobantes.emitir` emite) y `requiere` el módulo `facturacion` (`src/capacidades/modulos/catalogo.ts`); `estadoDeEmpresa` solo `ACTIVE` (supuesto DEC-0062).
 */

const REQUIERE_FACTURACION = { modulo: "facturacion", estadoDeEmpresa: ["ACTIVE"] } as const;

export const DATOS_DE_FACTURACION_PANTALLAS = {
  "estado-de-comprobante": {
    ficha: "src/modulos/fiscal/dominio/estados-de-comprobante.ts",
    propositos: [
      {
        para: "Estado del comprobante como filtro del listado (Todos, Autorizada, Validando, Confirmando, Rechazada).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 1: Listado de comprobantes»",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/FormularioDeFiltros.cliente.tsx"],
    ponerPor: ["comprobantes.ver"],
    requiere: REQUIERE_FACTURACION,
  },
  "letra-de-comprobante": {
    ficha: "src/modulos/fiscal/dominio/letra-de-comprobante.ts",
    propositos: [
      {
        para: "Letra del comprobante (A, B o C) como filtro del listado.",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 1: Listado de comprobantes»",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/FormularioDeFiltros.cliente.tsx"],
    ponerPor: ["comprobantes.ver"],
    requiere: REQUIERE_FACTURACION,
  },
  "punto-de-venta-de-comprobante": {
    ficha: "src/modulos/fiscal/dominio/punto-de-venta.ts",
    propositos: [
      {
        para: "Punto de venta como filtro del listado (la lista sale de los puntos de venta de la sucursal).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 1: Listado de comprobantes»",
      },
      {
        para: "Punto de venta con el que se emite una factura cuando la sucursal tiene más de uno activo (se elige en el paso 3).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura»",
      },
    ],
    consumidores: [
      "apps/web/ui/plantillas/facturacion/FormularioDeFiltros.cliente.tsx",
      "apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx",
    ],
    ponerPor: ["comprobantes.ver", "comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "descripcion-de-renglon": {
    ficha: "src/modulos/fiscal/dominio/comprobante-nuevo.ts",
    propositos: [
      {
        para: "Descripción de cada renglón al emitir una factura (paso 2).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura»",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "alicuota-de-iva-de-renglon": {
    ficha: "src/modulos/fiscal/dominio/alicuota.ts",
    propositos: [
      {
        para: "Alícuota de IVA de cada renglón al emitir una factura, cuando corresponde (paso 2).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura»",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
