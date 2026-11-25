import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «DEPÓSITOS» DE STOCK (STK-A; DDD:174: toda pantalla tiene su ficha). Declara lo que la pantalla ofrece: rutas y archivos, el acceso, los botones con la acción de permiso que
 * cada uno envía, los estados y cada texto con SU uso y SU fuente. Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba `ficha-de-depositos.test.ts`
 * contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. No crea acciones ni permisos: declara los que ya existen (módulo `stock`).
 * Qué se ve sin el permiso: «Editar», «Desactivar» y «Reactivar» de cada fila no se dibujan (maqueta `stock-depositos-gestion.html`: «el operador ve la lista pero no ve Editar, Desactivar ni Reactivar»,
 * DEC-1020); «Agregar depósito» y «Guardar» salen apagados. Todo rechazo sin texto propio sale con el genérico. Previene: un botón o un texto que nadie aprobó, y una ruta que se mueve sin que la ficha lo note.
 */

const MAQUETA_DE_STOCK = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `stock.html`; decisión D125 de Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta stock.html (tabla «Textos nuevos», filas «Pantallas», «Depósitos» y «Errores y avisos»)",
} as const;
const YA_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 y 12/11/2026 (maqueta de productos aprobada, con la regla «manda la maqueta»); por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta productos.html y presentaciones.html; 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md §1.7",
} as const;
const GESTION_APROBADA = {
  decidio:
    "el dueño, 25/11/2026 (aprobó los textos de dinero, permisos o decisiones previas del inventario, fila 449, y la maqueta `stock-depositos-gestion.html`, fila 444); N-23 lo aceptó el orquestador por delegación (fila 173)",
  donde:
    "Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md §3 (N-20, N-21 y N-23) y decisiones-del-dueno-2026-11.md filas 444 y 449",
} as const;
const USO_DE_LA_LISTA = "PantallaDeDepositos.tsx (lista)";
const USO_DEL_ALTA = "FormularioDeDeposito.cliente.tsx";
const USO_DE_LA_EDICION = "FormularioDeEditarDeposito.cliente.tsx";

export const FICHA_DE_DEPOSITOS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/depositos/page.tsx",
    "apps/web/app/s/app/(operacion)/stock/depositos/nuevo/page.tsx",
    "apps/web/app/s/app/(operacion)/stock/depositos/[id]/editar/page.tsx",
    "apps/web/ui/plantillas/stock/depositos/PantallaDeDepositos.tsx",
    "apps/web/ui/plantillas/stock/depositos/FormularioDeDeposito.cliente.tsx",
    "apps/web/ui/plantillas/stock/depositos/FormularioDeEditarDeposito.cliente.tsx",
    "apps/web/ui/plantillas/stock/depositos/FormularioDeEstadoDeDeposito.cliente.tsx",
    "apps/web/ui/plantillas/stock/depositos/modelo-de-depositos.ts",
  ],
  rutas: ["/stock/depositos", "/stock/depositos/nuevo", "/stock/depositos/[id]/editar"],
  titulo: "stock.pantalla.depositos",
  acceso: "stock.ver",
  botones: [
    {
      id: "agregar",
      texto: "stock.deposito.agregar",
      hace: { navega: "/stock/depositos/nuevo" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar-alta",
      texto: "stock.deposito.agregar",
      hace: { envia: "depositos.crear" },
      sinPermiso: "APAGADO",
    },
    {
      id: "editar",
      texto: "catalogo.accion.editar",
      hace: { navega: "/stock/depositos/[id]/editar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar-edicion",
      texto: "catalogo.accion.guardar",
      hace: { envia: "depositos.editar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "desactivar",
      texto: "catalogo.accion.desactivar",
      hace: { envia: "depositos.desactivar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "reactivar",
      texto: "catalogo.accion.reactivar",
      hace: { envia: "depositos.reactivar" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.pantalla.depositos": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.deposito.agregar": {
      usos: [USO_DE_LA_LISTA, "título y botón del alta"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.deposito.normal": { usos: [USO_DE_LA_LISTA, USO_DEL_ALTA], fuente: MAQUETA_DE_STOCK },
    "stock.deposito.cuarentena": {
      usos: [USO_DE_LA_LISTA, USO_DEL_ALTA],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.deposito.rechazo": { usos: [USO_DE_LA_LISTA, USO_DEL_ALTA], fuente: MAQUETA_DE_STOCK },
    "stock.deposito.de_venta": {
      usos: [USO_DE_LA_LISTA, USO_DEL_ALTA, USO_DE_LA_EDICION],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.deposito.uso": { usos: [USO_DEL_ALTA, USO_DE_LA_EDICION], fuente: MAQUETA_DE_STOCK },
    "catalogo.dato.nombre": { usos: [USO_DEL_ALTA, USO_DE_LA_EDICION], fuente: YA_APROBADO },
    "catalogo.accion.editar": { usos: ["botón de cada tarjeta activa"], fuente: YA_APROBADO },
    "catalogo.accion.guardar": { usos: ["botón de la edición"], fuente: YA_APROBADO },
    "catalogo.accion.cancelar": { usos: [USO_DEL_ALTA, USO_DE_LA_EDICION], fuente: YA_APROBADO },
    "catalogo.accion.desactivar": {
      usos: ["botón de cada tarjeta activa"],
      fuente: YA_APROBADO,
    },
    "catalogo.accion.reactivar": {
      usos: ["botón de cada tarjeta desactivada"],
      fuente: YA_APROBADO,
    },
    "catalogo.estado.desactivado": {
      usos: ["marca de la tarjeta de un depósito desactivado"],
      fuente: YA_APROBADO,
    },
    "stock.error.nombre_duplicado": {
      usos: ["alta y edición con un nombre ya usado en la sucursal"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.error.conteo_en_curso": {
      usos: ["desactivar un depósito con un conteo abierto (se reutiliza)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.error.deposito_con_existencia": {
      usos: ["desactivar un depósito con existencia"],
      fuente: GESTION_APROBADA,
    },
    "stock.error.es_el_de_venta": {
      usos: ["desactivar el depósito de venta"],
      fuente: GESTION_APROBADA,
    },
    "stock.error.deposito_desactualizado": {
      usos: ["guardar con una versión que otra persona ya cambió"],
      fuente: GESTION_APROBADA,
    },
    "stock.error.sin_permiso": {
      usos: ["todo otro rechazo"],
      fuente: MAQUETA_DE_STOCK,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
