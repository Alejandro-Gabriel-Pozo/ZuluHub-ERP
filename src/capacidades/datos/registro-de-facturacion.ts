import type { DefinicionDeDato } from "./tipos-de-datos";

/**
 * Los datos del módulo facturación del registro de datos (ver `registro.ts`), en su propio archivo para que dos ramas que suman datos de módulos distintos no toquen
 * las mismas líneas: solo cambia la ubicación, ningún dato ni consumidor. Un dato no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

const REQUIERE_FACTURACION = { modulo: "facturacion", estadoDeEmpresa: ["ACTIVE"] } as const;

export const DATOS_DE_FACTURACION = {
  "fecha-civil": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [
      {
        para: "Período personalizado (desde, hasta) del listado de comprobantes.",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 1: Listado de comprobantes»",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/FormularioDeFiltros.cliente.tsx"],
    ponerPor: ["comprobantes.ver"],
    requiere: REQUIERE_FACTURACION,
  },
  importe: {
    ficha: "src/primitivas/dinero/importe.ts",
    propositos: [
      {
        para: "Importe unitario de cada renglón al emitir una factura (importes como texto decimal).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 2, renglones)",
      },
      {
        para: "Importe a anular por alícuota en la anulación parcial (D-69).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 2: Detalle de un comprobante» (anulación por importe) y registro de decisiones D-69",
      },
    ],
    consumidores: [
      "apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx",
      "apps/web/ui/plantillas/facturacion/PantallaDeAnularComprobante.cliente.tsx",
    ],
    ponerPor: ["comprobantes.emitir", "notas_de_credito.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  cantidad: {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      {
        para: "Cantidad de cada renglón al emitir una factura.",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 2, renglones)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "nombre-o-razon-social": {
    ficha: "src/primitivas/texto/nombre-o-razon-social.ts",
    propositos: [
      {
        para: "Nombre o razón social del cliente al emitir una factura (RG 1415 Anexo II A.II: se imprime en la factura).",
        fuente:
          "Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md §1 (decisiones del dueño, 2026-11-06) y facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 1, cliente)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "documento-de-identidad": {
    ficha: "src/primitivas/identificacion-fiscal/documento.ts",
    propositos: [
      {
        para: "Tipo y número de documento del cliente al emitir una factura (CUIT, CUIL, CDI, DNI o pasaporte; la clase A exige CUIT).",
        fuente:
          "Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md §1 (decisiones del dueño, 2026-11-06) y facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 1, cliente)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "domicilio-libre": {
    ficha: "src/primitivas/domicilio/domicilio-libre.ts",
    propositos: [
      {
        para: "Domicilio comercial del cliente al emitir una factura: obligatorio salvo consumidor final (RG 1415 Anexo II A.II).",
        fuente:
          "Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md §1 (decisiones del dueño, 2026-11-06) y facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 1, cliente)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "condicion-iva": {
    ficha: "src/primitivas/identificacion-fiscal/condicion-iva.ts",
    propositos: [
      {
        para: "Condición frente al IVA del cliente al emitir una factura (de ella sale la letra A, B o C).",
        fuente:
          "Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md §1 (decisiones del dueño, 2026-11-06) y facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 1, cliente)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
