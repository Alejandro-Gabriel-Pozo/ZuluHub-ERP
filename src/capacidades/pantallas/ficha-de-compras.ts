import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LAS FICHAS DE «COMPRAS» Y «COMPRA» (DDD:174: toda pantalla nueva nace con ficha; Compras PR 3). Dos rutas, las dos de SOLO LECTURA: la lista de compras de la sucursal (`/compras`) y la ficha de una compra
 * (`/compras/[id]`). Es solo una declaración: la comprueba `test/web/ficha-de-compras.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`compra-corregir-anular.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño, DDD:294):
 *  1. Sin los chips «Por recibir», «Pedida» y «Recibida parcial» ni «Notas de crédito»: son de N3 y N4, que no se alcanzan hoy y están pausados (fase 5); no es una decisión de diseño.
 *  2. La lista es la de N1 y N2 de `compra-corregir-anular.html` y no la de `compra.html` (dibujada para N3): es la que muestra el nombre de la factura y «Sin precio» en la fila.
 *  3. Chips «Todas» y «Sin facturar» con «Aplicar filtros» y dos fechas: la maqueta de la lista no los dibuja; siguen la decisión del dueño para los filtros del directorio y del listado de facturación (DDD:294).
 *  4. La fila es un ENLACE a la ficha, no un botón: la ficha tiene su ruta y lo que navega es un enlace (teclado, lector de pantalla, abrir en otra pestaña); se ve y se toca igual (la misma diferencia de «Tickets del día»).
 *  5. Sin «con IVA» en el total de la factura («Total con IVA» no tiene clave ni texto aprobado): se rotula «Total» y es el total según la factura.
 *  6. Sin la tarjeta del pago ni «Corregido por…»: las suman PR 8 y PR 10. Sin «Corregir» ni «Anular».
 *  7. «Costo por unidad de stock» muestra el importe sin el « por kg» de la maqueta (la palabra «por» sola no tiene texto aprobado), y no se muestra en una línea ya corregida (su costo nuevo lo calcula la corrección con el IVA que entra al costo y no se guarda).
 *  8. El correo ausente no dibuja la línea de «quién y cuándo» (sin texto nuevo, como «Tickets del día»).
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }> | "aplica-el-filtro";
  /** La pantalla no esconde ni apaga por permiso (Interfaz sobria): decide el servidor y su respuesta se muestra. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeCompras = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  /** Ninguno de acción: solo navegar y aplicar el filtro. */
  botones: readonly BotonDeFicha[];
  estados: Readonly<
    Record<
      "LISTA_CON_COMPRAS" | "VACIA" | "SIN_PERMISO" | "ERROR" | "FICHA" | "FICHA_ANULADA",
      ClaveDeTexto
    >
  >;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DE_LA_MAQUETA: FuenteDeTexto = {
  decidio:
    "el dueño: textos del prototipo aprobado de compras (09/11/2026, compra.html) y la maqueta compra-corregir-anular.html aceptada por delegación (DDD:187); los reusados de otro módulo tienen el mismo texto aprobado en su clave (DDD:388)",
  donde:
    "Pedernal-docs 10-ux-ui, maquetas compra-corregir-anular.html (vLista, vFicha) y compra.html; 11-especificaciones/briefs/compras/PR-3-lista-y-ficha-de-compra.md §6",
};
const DE_LA_EXPORTACION: FuenteDeTexto = {
  decidio:
    "el orquestador, por la delegación de la fila 173 (DEC-0905): el texto del enlace «Exportar» lo propuso el plan de la exportación y el dueño aprobó el 25/11/2026 todas las recomendaciones de ese plan («Sí a todas tus recomendaciones»)",
  donde:
    "Pedernal-docs 11-especificaciones/plan-exportacion-de-compras-2026-11-25.md §2, §5.1 y §6; decisiones-del-dueno-2026-11.md, filas del 25/11/2026",
};
const USO = "apps/web/ui/plantillas/compras/";

export const FICHA_DE_COMPRAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/[id]/page.tsx",
    "apps/web/servidor/compras.ts",
    "apps/web/ui/plantillas/compras/rutas-de-compras.ts",
    "apps/web/ui/plantillas/compras/textos-de-compras.ts",
    "apps/web/ui/plantillas/compras/lista/PantallaDeListaDeCompras.tsx",
    "apps/web/ui/plantillas/compras/lista/FormularioDeFiltrosDeCompras.cliente.tsx",
    "apps/web/ui/plantillas/compras/lista/modelo-de-lista-de-compras.ts",
    "apps/web/ui/plantillas/compras/ficha/PantallaDeFichaDeCompra.tsx",
    "apps/web/ui/plantillas/compras/ficha/modelo-de-ficha-de-compra.ts",
    "src/composicion/compras-lista-web.ts",
    "src/composicion/entradas-de-compras.ts",
    "apps/web/app/s/app/(operacion)/compras/exportar/route.ts",
    "src/composicion/compras-exportacion-web.ts",
  ],
  rutas: ["/compras", "/compras/[id]"],
  botones: [
    {
      id: "nueva-compra",
      texto: "compras.compra.nueva_compra",
      hace: { navega: "/compras/nueva" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "exportar",
      texto: "compras.exportacion.exportar",
      hace: { navega: "/compras/exportar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "aplicar-filtros",
      texto: "fiscal.pantalla.listado_aplicar",
      hace: "aplica-el-filtro",
      sinPermiso: "APAGADO",
    },
    {
      id: "pagina-siguiente",
      texto: "fiscal.pantalla.listado_pagina_siguiente",
      hace: { navega: "/compras" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "ver-todas",
      texto: "compras.ficha.ver_todas",
      hace: { navega: "/compras" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "volver-a-la-lista",
      texto: "ventas.ticket.volver",
      hace: { navega: "/compras" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: {
    LISTA_CON_COMPRAS: "compras.compra.recibida_sin_facturar",
    VACIA: "catalogo.lista.sin_resultados",
    SIN_PERMISO: "compras.error.sin_permiso",
    ERROR: "compras.error.sin_permiso",
    FICHA: "compras.compra.entra_a_tu_stock",
    FICHA_ANULADA: "compras.orden.anulada",
  },
  textos: {
    "compras.compra.nueva_compra": {
      usos: [
        "enlace de la lista hacia «Nueva compra» (Compras PR 6b), solo con permiso de registrar",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "compras.exportacion.exportar": {
      usos: [
        "enlace de la lista que baja el archivo de Excel del período aplicado (Desde y Hasta); solo con `compras.exportar` y `costos.ver`, y solo con el período completo",
      ],
      fuente: DE_LA_EXPORTACION,
    },
    "compras.compra.compras": {
      usos: [`${USO}textos-de-compras.ts`, "título de la lista y entrada del menú Compras"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.compra": {
      usos: ["palabra antes del número en la fila y en el título de la ficha"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.sin_facturar": { usos: ["chip del filtro"], fuente: DE_LA_MAQUETA },
    "fiscal.pantalla.listado_todas": { usos: ["chip del filtro"], fuente: DE_LA_MAQUETA },
    "compras.compra.recibida_sin_facturar": {
      usos: ["segunda línea de la fila sin factura"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.tipo_factura": {
      usos: ["nombre de la factura en la fila y en la tarjeta de la ficha"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.comprobante_con_numero": {
      usos: ["«Factura A 00004-00005678»"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.orden.anulada": {
      usos: ["« · Anulada» en la fila y marca de la ficha anulada"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.precio.sin_precio": {
      usos: ["total de la fila, de la línea y de la ficha sin precio"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.listado_rotulo_desde": { usos: ["campo del filtro"], fuente: DE_LA_MAQUETA },
    "fiscal.pantalla.listado_rotulo_hasta": { usos: ["campo del filtro"], fuente: DE_LA_MAQUETA },
    "fiscal.pantalla.listado_rotulo_estado": {
      usos: ["rótulo del estado del filtro"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.listado_aplicar": { usos: ["botón del filtro"], fuente: DE_LA_MAQUETA },
    "fiscal.pantalla.listado_pagina_siguiente": {
      usos: ["enlace al pie de la lista, solo si hay otra página"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.lista.sin_resultados": { usos: ["lista vacía"], fuente: DE_LA_MAQUETA },
    "compras.ficha.ver_todas": { usos: ["lista vacía"], fuente: DE_LA_MAQUETA },
    "ventas.ticket.volver": { usos: ["«Volver» de la ficha"], fuente: DE_LA_MAQUETA },
    "ventas.ticket.motivo": { usos: ["motivo de la compra anulada"], fuente: DE_LA_MAQUETA },
    "compras.recepcion.remito_del_proveedor": {
      usos: ["remito de la ficha"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.sin_remito": { usos: ["ficha sin remito"], fuente: DE_LA_MAQUETA },
    "compras.compra.entra_a_tu_stock": { usos: ["línea de la ficha"], fuente: DE_LA_MAQUETA },
    "compras.compra.costo_por_unidad_de_stock": {
      usos: ["línea de la ficha con precio"],
      fuente: DE_LA_MAQUETA,
    },
    "fiscal.pantalla.rotulo_total": {
      usos: ["total de la ficha y de la tarjeta de la factura"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.control.vence": {
      usos: ["vencimiento de la tarjeta de la factura"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.error.sin_permiso": {
      usos: ["cualquier error de la lista o de la ficha (el genérico, interfaz sobria)"],
      fuente: DE_LA_MAQUETA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeCompras;
