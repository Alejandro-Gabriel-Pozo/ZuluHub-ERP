import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «MOVIMIENTOS» DE STOCK (STK-B1, FP-STK-03; DDD:174: toda pantalla tiene su ficha). Declara lo que la pantalla ofrece: ruta y archivos, el acceso, los botones, los estados y cada texto
 * con SU uso y SU fuente. Misma forma que `ficha-de-mesas.ts` y la comprueba `ficha-de-existencias-y-movimientos.test.ts` contra el catálogo de textos y la tabla del menú, para que no se desfase.
 * Es el libro del depósito en solo lectura: la tarjeta no dibuja «Anular» todavía (llega con la escritura de Stock, y el servidor ya decide `anulable`). El depósito se elige con enlaces (DEC-1023). Solo
 * se rotulan las clases y los motivos con texto aprobado; el ajuste por conteo se rotula «Ajuste» (DEC-1023). Los nombres de las unidades salen del catálogo de unidades de medida. Previene: un botón o un texto que nadie aprobó.
 */

const MAQUETA_DE_STOCK = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `stock.html`; decisión D125 de Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta stock.html (tabla «Textos nuevos», filas «Pantallas», «Acciones» y «Motivos»)",
} as const;
const CLASES_DE_DEC_1022 = {
  decidio:
    "por delegación del dueño (fila 173) el orquestador aceptó los rótulos de clase N-10, N-11 y N-12; «Anulado» lo aprobó el dueño como T4 el 15/11/2026 (DEC-1022)",
  donde:
    "Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md (N-10, N-11, N-12 y «Anulado»); arquitectura/decisiones/registro/DEC-1022.json",
} as const;
const SUPUESTO_DE_LA_SESION = {
  decidio:
    "supuesto de la sesión de Stock, pendiente de OK del dueño (DEC-1023): el único texto nuevo es «Siguiente»",
  donde:
    "arquitectura/decisiones/registro/DEC-1023.json; Pedernal-docs 11-especificaciones/dia-uno-stock-fichas-de-pantalla-2026-11-25.md (FP-STK-03)",
} as const;
const USO_DE_LA_TARJETA = "modelo-de-movimientos.ts (rótulo de la tarjeta)";

export const FICHA_DE_MOVIMIENTOS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/movimientos/page.tsx",
    "apps/web/ui/plantillas/stock/movimientos/PantallaDeMovimientos.tsx",
    "apps/web/ui/plantillas/stock/movimientos/modelo-de-movimientos.ts",
    "apps/web/ui/plantillas/stock/lectura/SelectorDeDeposito.tsx",
    "apps/web/ui/plantillas/stock/lectura/modelo-de-lectura.ts",
  ],
  rutas: ["/stock/movimientos"],
  titulo: "stock.pantalla.movimientos",
  acceso: "stock.ver",
  botones: [],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.pantalla.movimientos": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.pantalla.depositos": {
      usos: ["rótulo del selector de depósitos (enlaces)", "título de la pestaña Depósitos"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.entrada": {
      usos: [USO_DE_LA_TARJETA + " (clase Entrada)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.salida": {
      usos: [USO_DE_LA_TARJETA + " (clase Salida)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.clase.transferencia": { usos: [USO_DE_LA_TARJETA], fuente: CLASES_DE_DEC_1022 },
    "stock.clase.ajuste": {
      usos: [USO_DE_LA_TARJETA + " (también el ajuste por conteo)"],
      fuente: CLASES_DE_DEC_1022,
    },
    "stock.clase.anulacion": { usos: [USO_DE_LA_TARJETA], fuente: CLASES_DE_DEC_1022 },
    "stock.estado.anulado": {
      usos: ["PantallaDeMovimientos.tsx (marca de un movimiento anulado)"],
      fuente: CLASES_DE_DEC_1022,
    },
    "stock.motivo.compra": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.carga_inicial": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.devolucion_de_cliente": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.otra_entrada": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.consumo_interno": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.merma": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.rotura": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.vencimiento": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.otra_salida": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.motivo.correccion": { usos: [USO_DE_LA_TARJETA], fuente: MAQUETA_DE_STOCK },
    "stock.lista.siguiente": {
      usos: ["PantallaDeMovimientos.tsx (enlace a la página que sigue)"],
      fuente: SUPUESTO_DE_LA_SESION,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
