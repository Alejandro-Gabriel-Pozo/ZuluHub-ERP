import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «SUCURSALES» (DDD:174: toda pantalla nueva nace con ficha). Dos rutas: la lista de sucursales activas (`/cuenta/sucursales`) y el alta (`/cuenta/sucursales/nueva`), para quien tiene `sucursales.ver`
 * (gerente y administrador). Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba `test/web/ficha-de-sucursales.test.ts` contra el catálogo de textos, el de permisos y la tabla
 * del menú, para que no se desfase. No crea acciones ni permisos: declara los que ya existen (`sucursales.ver` y `sucursales.crear`).
 *
 * PASOS Y CAMPOS: alta = nombre (`nombre-de-sucursal`). Nada más: el contacto se carga después en «Contacto de la sucursal».
 * BOTONES: «Nueva sucursal» (navega al alta) y «Guardar» (crea). Sin permiso ningún botón se dibuja (`AUSENTE`); es solo una ayuda, el servidor vuelve a exigir el permiso. «Cancelar» es un enlace de vuelta a la lista.
 * MODALES: ninguno. ESTADOS: la lista muestra solo las sucursales activas, sin estados ni insignias; repetir el alta con el mismo nombre devuelve la misma sucursal (vuelve a la lista sin error); un nombre igual al de
 * una sucursal desactivada, cualquier otra falla y la falta de permiso salen con el mensaje genérico.
 * SUPUESTO (DEC-IDE-006, declarado, reversible): los permisos de crear quedan como están (gerente y administrador). Casa Central no lleva marca de «no vende»: es una sucursal más.
 *
 * Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

/** La etiqueta simple que el dueño delegó (fila 173) y quedó asentada el 27/11/2026; DEC-IDE-006. */
const ETIQUETA_DELEGADA = {
  decidio:
    "el dueño, por la delegación de textos del 15/11/2026 (DDD:173, aceptada el 27/11/2026; etiqueta simple, sin dinero, permisos ni fiscal); DEC-IDE-006",
  donde:
    "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila 173 (delegación de textos); inventario de textos de la pantalla Sucursales",
} as const;

/** Un texto que ya existía en el catálogo y se reusa sin cambios (una regla, un lugar). */
const REUSADO = {
  decidio: "el dueño (texto ya aprobado y en uso en el catálogo, reutilizado sin cambios)",
  donde:
    "Pedernal-docs 10-ux-ui y decisiones-del-dueno-2026-11.md (textos ya aprobados de Usuarios y de Caja)",
} as const;

const USO_DE_LA_LISTA = "modelo-de-sucursales.ts (armarLaListaDeSucursales)";
const USO_DEL_ALTA = "modelo-de-sucursales.ts (armarElFormularioDeAltaDeSucursal)";

export const FICHA_DE_SUCURSALES = {
  archivos: [
    "apps/web/app/s/app/(operacion)/cuenta/sucursales/page.tsx",
    "apps/web/app/s/app/(operacion)/cuenta/sucursales/nueva/page.tsx",
    "apps/web/app/s/app/acciones-de-sucursales.ts",
    "apps/web/servidor/sucursales.ts",
    "apps/web/ui/plantillas/sucursales/PantallaDeListaDeSucursales.tsx",
    "apps/web/ui/plantillas/sucursales/FormularioDeAltaDeSucursal.cliente.tsx",
    "apps/web/ui/plantillas/sucursales/modelo-de-sucursales.ts",
    "src/composicion/sucursales-web.ts",
    "src/composicion/entradas-de-sucursal.ts",
  ],
  rutas: ["/cuenta/sucursales", "/cuenta/sucursales/nueva"],
  titulo: "usuarios.campo.sucursales",
  acceso: "sucursales.ver",
  botones: [
    {
      id: "nueva",
      texto: "sucursales.lista.nueva",
      hace: { navega: "/cuenta/sucursales/nueva" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar",
      texto: "caja.accion.guardar",
      hace: { envia: "sucursales.crear" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "usuarios.campo.sucursales": {
      usos: ["título de la pantalla y del alta", "fila del menú de Cuenta (grupo empresa)"],
      fuente: REUSADO,
    },
    "sucursales.lista.nueva": {
      usos: [USO_DE_LA_LISTA, "título del alta"],
      fuente: ETIQUETA_DELEGADA,
    },
    "caja.campo.nombre": { usos: [USO_DEL_ALTA], fuente: REUSADO },
    "caja.accion.guardar": { usos: [USO_DEL_ALTA], fuente: REUSADO },
    "caja.accion.cancelar": { usos: [USO_DEL_ALTA], fuente: REUSADO },
  },
  estadoDeLaFicha: "TERMINADA",
} as const satisfies FichaDePantalla;
