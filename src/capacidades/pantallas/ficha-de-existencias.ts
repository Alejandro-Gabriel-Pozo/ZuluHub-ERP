import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «EXISTENCIAS» DE STOCK (STK-B1, FP-STK-02; DDD:174: toda pantalla tiene su ficha). Declara lo que la pantalla ofrece: ruta y archivos, el acceso, los botones, los estados y cada texto
 * con SU uso y SU fuente. Misma forma que `ficha-de-mesas.ts` y la comprueba `ficha-de-existencias-y-movimientos.test.ts` contra el catálogo de textos y la tabla del menú, para que no se desfase.
 * Los botones Entrada, Salida, Transferir y Ajustar llevan a su formulario y salen apagados sin el permiso (el servidor igual decide); «Carga inicial» llega con su pantalla. El depósito se elige con
 * enlaces (DEC-1023) y la sucursal la fija el servidor. No muestra costos ni «Disponible». Los nombres de las unidades salen del catálogo de unidades de medida. Previene: un botón o un texto que nadie aprobó.
 */

const MAQUETA_DE_STOCK = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `stock.html`; decisión D125 de Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta stock.html (tabla «Textos nuevos», filas «Pantallas» y «Existencias»)",
} as const;
const SIGUIENTE_YA_APROBADO = {
  decidio:
    "el dueño, 03/11/2026 (cuestionario «Certificado», «Siguiente»); su reutilización la aceptó el orquestador por delegación del dueño (fila 173; DEC-1023)",
  donde:
    "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md (03/11/2026, «Siguiente»); arquitectura/decisiones/registro/DEC-1023.json",
} as const;
const USO_DE_LA_PANTALLA = "PantallaDeExistencias.tsx";

export const FICHA_DE_EXISTENCIAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/existencias/page.tsx",
    "apps/web/ui/plantillas/stock/existencias/PantallaDeExistencias.tsx",
    "apps/web/ui/plantillas/stock/existencias/modelo-de-existencias.ts",
    "apps/web/ui/plantillas/stock/lectura/SelectorDeDeposito.tsx",
    "apps/web/ui/plantillas/stock/lectura/modelo-de-lectura.ts",
  ],
  rutas: ["/stock/existencias"],
  titulo: "stock.pantalla.existencias",
  acceso: "stock.ver",
  botones: [
    {
      id: "entrada",
      texto: "stock.accion.entrada",
      hace: { navega: "/stock/movimientos/entrada" },
      sinPermiso: "APAGADO",
    },
    {
      id: "salida",
      texto: "stock.accion.salida",
      hace: { navega: "/stock/movimientos/salida" },
      sinPermiso: "APAGADO",
    },
    {
      id: "transferir",
      texto: "stock.accion.transferir",
      hace: { navega: "/stock/movimientos/transferir" },
      sinPermiso: "APAGADO",
    },
    {
      id: "ajustar",
      texto: "stock.accion.ajustar",
      hace: { navega: "/stock/movimientos/ajustar" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.pantalla.existencias": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.pantalla.depositos": {
      usos: ["rótulo del selector de depósitos (enlaces)", "título de la pestaña Depósitos"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.entrada": { usos: [USO_DE_LA_PANTALLA + " (botón)"], fuente: MAQUETA_DE_STOCK },
    "stock.accion.salida": { usos: [USO_DE_LA_PANTALLA + " (botón)"], fuente: MAQUETA_DE_STOCK },
    "stock.accion.transferir": {
      usos: [USO_DE_LA_PANTALLA + " (botón)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.ajustar": { usos: [USO_DE_LA_PANTALLA + " (botón)"], fuente: MAQUETA_DE_STOCK },
    "stock.pantalla.negativa": {
      usos: [USO_DE_LA_PANTALLA + " (marca de un saldo bajo cero)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "fiscal.pantalla.config_cert_siguiente": {
      usos: [
        "PantallaDeExistencias.tsx (enlace a la página que sigue; se reutiliza el aprobado en fiscal)",
      ],
      fuente: SIGUIENTE_YA_APROBADO,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
