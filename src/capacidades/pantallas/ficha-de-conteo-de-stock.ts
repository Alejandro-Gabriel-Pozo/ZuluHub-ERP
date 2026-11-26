import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LAS FICHAS DE LA PESTAÑA «CONTEO» DE STOCK (STK-D, FP-STK-10 a FP-STK-12, maqueta `stock-conteo.html`; DDD:174: toda pantalla tiene su ficha): la carga del conteo físico de un depósito y su revisión/aplicado. Misma forma
 * que `ficha-de-mesas.ts`; la comprueba `ficha-de-existencias-y-movimientos.test.ts` contra el catálogo de textos. El conteo es A CIEGAS: quien solo cuenta no ve lo que el sistema creía ni la diferencia (el servidor no se lo manda).
 * Los botones salen apagados sin el permiso (el servidor igual decide). Cada artículo se guarda al salir del campo; la hora del conteo es opcional (vacía vale la de la carga). Sin importes: no hay valorización de la diferencia.
 * Quedan para un PR chico posterior «Ver detalle» y la marca «Ya había ocurrido cuando contaste» (no se usan acá). Previene: un botón o un texto que nadie aprobó, o la diferencia mostrada a quien cuenta.
 */

const MAQUETA_DE_STOCK = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `stock.html`; decisión D125 de Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta stock.html (tabla «Textos nuevos», filas «Pantallas», «Acciones», «Motivos» y «Errores y avisos»)",
} as const;
const CONTEO_CON_HORA = {
  decidio:
    "el dueño, 14/11/2026 (aprobó los seis textos del conteo con hora; mensaje del dueño del 14/11/2026)",
  donde:
    "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md (fila del 14/11/2026, punto 2) y maqueta stock-conteo.html",
} as const;
const YA_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 y 12/11/2026 (maqueta de productos aprobada); por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde: "Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md §1.7",
} as const;

const USO_DE_CARGA = "CargaDeConteo.cliente.tsx";
const USO_DE_APLICAR = "FormularioDeAplicarConteo.cliente.tsx";
const MOTIVO_DE_DIFERENCIA = (clave: string) =>
  ({
    usos: ["modelo-de-conteo.ts (motivo de una diferencia, " + clave + ")"],
    fuente: MAQUETA_DE_STOCK,
  }) as const;

export const FICHA_DE_CONTEO_DE_STOCK = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/conteo/page.tsx",
    "apps/web/ui/plantillas/stock/conteo/CargaDeConteo.cliente.tsx",
    "apps/web/ui/plantillas/stock/conteo/FormularioDeCancelarConteo.cliente.tsx",
    "apps/web/ui/plantillas/stock/lectura/SelectorDeDeposito.tsx",
  ],
  rutas: ["/stock/conteo"],
  titulo: "stock.pantalla.conteo",
  acceso: "conteos.registrar",
  botones: [
    {
      id: "abrir",
      texto: "stock.conteo.abrir",
      hace: { envia: "conteos.abrir" },
      sinPermiso: "APAGADO",
    },
    {
      id: "aplicar",
      texto: "stock.conteo.aplicar",
      hace: { navega: "/stock/conteo/revisar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cancelar-conteo",
      texto: "stock.conteo.cancelar",
      hace: { envia: "conteos.cancelar" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.pantalla.conteo": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.pantalla.depositos": {
      usos: ["page.tsx (rótulo del selector de depósitos)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.conteo.abrir": { usos: ["page.tsx (botón)"], fuente: MAQUETA_DE_STOCK },
    "stock.conteo.contado": {
      usos: [USO_DE_CARGA + " (rótulo de la cantidad contada de cada artículo)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.conteo.hora": {
      usos: [USO_DE_CARGA + " (rótulo de la hora del conteo, opcional; vacía vale la de la carga)"],
      fuente: CONTEO_CON_HORA,
    },
    "stock.conteo.aplicar": {
      usos: ["page.tsx (botón que lleva a la revisión)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.conteo.cancelar": {
      usos: ["FormularioDeCancelarConteo.cliente.tsx (botón)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.detalle": {
      usos: ["FormularioDeCancelarConteo.cliente.tsx (motivo de la cancelación)"],
      fuente: MAQUETA_DE_STOCK,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;

export const FICHA_DE_REVISION_DE_CONTEO_DE_STOCK = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/conteo/revisar/page.tsx",
    "apps/web/ui/plantillas/stock/conteo/FormularioDeAplicarConteo.cliente.tsx",
    "apps/web/ui/plantillas/stock/conteo/ListaDeConteoAplicado.tsx",
    "apps/web/ui/plantillas/stock/conteo/modelo-de-conteo.ts",
  ],
  rutas: ["/stock/conteo/revisar"],
  titulo: "stock.pantalla.conteo",
  acceso: "conteos.aplicar",
  botones: [
    {
      id: "aplicar",
      texto: "stock.conteo.aplicar",
      hace: { envia: "conteos.aplicar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cancelar",
      texto: "catalogo.accion.cancelar",
      hace: { navega: "/stock/conteo" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.pantalla.conteo": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.conteo.aplicar": { usos: [USO_DE_APLICAR + " (botón)"], fuente: MAQUETA_DE_STOCK },
    "stock.conteo.aplicado": {
      usos: ["page.tsx (título del resultado de un conteo aplicado)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.conteo.contado": {
      usos: [USO_DE_APLICAR + " y ListaDeConteoAplicado.tsx (lo contado de cada artículo)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.conteo.sistema_a_esa_hora": {
      usos: [
        USO_DE_APLICAR +
          " (lo que el sistema creía a la hora del conteo; solo con permiso de aplicar)",
      ],
      fuente: CONTEO_CON_HORA,
    },
    "stock.conteo.movido_desde": {
      usos: [
        "modelo-de-conteo.ts (lo movido desde la hora del conteo; lleva la hora de ese artículo)",
      ],
      fuente: CONTEO_CON_HORA,
    },
    "stock.conteo.diferencia": {
      usos: [USO_DE_APLICAR + " y ListaDeConteoAplicado.tsx (la diferencia de cada artículo)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.motivo": {
      usos: [USO_DE_APLICAR + " y ListaDeConteoAplicado.tsx (motivo de la diferencia)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.detalle": {
      usos: [USO_DE_APLICAR + " (detalle cuando el motivo es «otra»)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "catalogo.accion.cancelar": {
      usos: [USO_DE_APLICAR + " (volver a la carga)"],
      fuente: YA_APROBADO,
    },
    "stock.conteo.motivo_venta_no_registrada": MOTIVO_DE_DIFERENCIA("faltante"),
    "stock.motivo.consumo_interno": MOTIVO_DE_DIFERENCIA("faltante"),
    "stock.motivo.merma": MOTIVO_DE_DIFERENCIA("faltante"),
    "stock.motivo.rotura": MOTIVO_DE_DIFERENCIA("faltante"),
    "stock.motivo.vencimiento": MOTIVO_DE_DIFERENCIA("faltante"),
    "stock.motivo.otra_salida": MOTIVO_DE_DIFERENCIA("faltante"),
    "stock.motivo.devolucion_de_cliente": MOTIVO_DE_DIFERENCIA("sobrante"),
    "stock.motivo.otra_entrada": MOTIVO_DE_DIFERENCIA("sobrante"),
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
