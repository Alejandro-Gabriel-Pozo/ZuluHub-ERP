import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «COMANDAS» DE LA COCINA (SAL-H; DDD:174: toda pantalla nueva nace con ficha). Declara lo que la pantalla ofrece: ruta y archivos, el acceso, los botones con la acción de permiso que cada uno
 * envía, los estados y cada texto con SU uso y SU fuente. Misma forma que `ficha-de-impresoras.ts` (el tipo se importa de `ficha-de-mesas.ts`: una regla, un lugar) y la comprueba `ficha-de-la-cocina.test.ts` contra el
 * catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. No crea acciones ni permisos: declara los que ya existen (módulo `comandas`). «Ver en pantalla» es del navegador (muestra el papel que armó el
 * servidor): no envía una acción de permiso. Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

const MAQUETA_DE_LA_COCINA = {
  decidio:
    "el dueño, 25/11/2026 (aprobó la maqueta `salon-cocina.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila 460; el nombre «Comandas», DDD:125)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta salon-cocina.html y 11-especificaciones/briefs/salon/SAL-H-pantalla-de-cocina.md §6 (textos nuevos: ninguno)",
} as const;
const MAQUETA_DE_IMPRIMIR = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `imprimir.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos); aceptado sin cambios el 17/11/2026 (DEC-0715)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta imprimir.html y 11-especificaciones/briefs/salon/SAL-H-pantalla-de-cocina.md §6",
} as const;
const USO_DEL_MODELO = "modelo-de-la-cocina.ts (lista)";
const USO_DEL_BOTON = "BotonDeImprimir.cliente.tsx";

export const FICHA_DE_LA_COCINA = {
  archivos: [
    "apps/web/app/s/app/(operacion)/salon/comandas/page.tsx",
    "apps/web/ui/plantillas/salon/PantallaDeLaCocina.cliente.tsx",
    "apps/web/ui/plantillas/salon/modelo-de-la-cocina.ts",
    "apps/web/ui/plantillas/salon/ImpresionDelDocumento.cliente.tsx",
    "apps/web/ui/patrones/papel/BotonDeImprimir.cliente.tsx",
  ],
  rutas: ["/salon/comandas"],
  titulo: "comandas.texto.cocina_comandas",
  acceso: "comandas.ver",
  botones: [
    {
      id: "imprimir",
      texto: "comandas.texto.imprimir_imprimir",
      hace: { envia: "impresiones.imprimir" },
      sinPermiso: "APAGADO",
    },
    {
      id: "reintentar",
      texto: "comandas.texto.imprimir_reintentar",
      hace: { envia: "impresiones.imprimir" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "comandas.texto.cocina_comandas": {
      usos: ["título de la pantalla", "fila del menú"],
      fuente: MAQUETA_DE_LA_COCINA,
    },
    "comandas.texto.envio_envio_n": { usos: [USO_DEL_MODELO], fuente: MAQUETA_DE_LA_COCINA },
    "comandas.texto.imprimir_imprimir": { usos: [USO_DEL_BOTON], fuente: MAQUETA_DE_IMPRIMIR },
    "comandas.texto.imprimir_imprimiendo": { usos: [USO_DEL_BOTON], fuente: MAQUETA_DE_IMPRIMIR },
    "comandas.texto.imprimir_impresa": { usos: [USO_DEL_BOTON], fuente: MAQUETA_DE_IMPRIMIR },
    "comandas.texto.imprimir_no_se_pudo_imprimir": {
      usos: [USO_DEL_BOTON],
      fuente: MAQUETA_DE_IMPRIMIR,
    },
    "comandas.texto.imprimir_reintentar": { usos: [USO_DEL_BOTON], fuente: MAQUETA_DE_IMPRIMIR },
    "comandas.texto.imprimir_ver_en_pantalla": {
      usos: [USO_DEL_BOTON],
      fuente: MAQUETA_DE_IMPRIMIR,
    },
    "comandas.texto.imprimir_no_hay_impresora_para_la_comanda_de_cocina": {
      usos: [USO_DEL_BOTON],
      fuente: MAQUETA_DE_IMPRIMIR,
    },
    "comandas.texto.imprimir_configurar_impresoras": {
      usos: ["PantallaDeLaCocina (página)"],
      fuente: MAQUETA_DE_IMPRIMIR,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
