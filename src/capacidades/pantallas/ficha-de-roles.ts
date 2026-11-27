import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «ROLES» (H4b T6; DDD:174: toda pantalla nueva nace con ficha). Tres rutas: la lista de roles propios (`/cuenta/roles`), el alta (`/cuenta/roles/nuevo`) y la ficha de un rol
 * (`/cuenta/roles/[rolId]`), solo para el gerente (`roles.ver`). Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba `test/web/ficha-de-roles.test.ts` contra el
 * catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. No crea acciones ni permisos: declara los que ya existen (`roles.ver`, `roles.crear`, `roles.editar` y `roles.archivar`).
 *
 * PASOS Y CAMPOS: alta = nombre (`nombre-de-rol`), «Empezar desde» (`origen-de-rol`: sin acciones, Administrador, Empleado o copiar otro rol) y, si copia, el rol de origen (`rol-de-origen`); ficha = nombre
 * (`nombre-de-rol`) y una casilla por acción agrupadas por módulo (`acciones-de-rol`). Una acción de piso «solo el gerente» o de un módulo fuera del plan se muestra cerrada con su nota; las de piso
 * «todos los roles» van tildadas y cerradas.
 * BOTONES: «Nuevo rol» (navega al alta), «Guardar» del alta (crea) y de la ficha (edita), «Archivar» y «Reactivar». Sin permiso ningún botón se dibuja (`AUSENTE`); es solo una ayuda, el servidor vuelve a exigir cada
 * permiso. Archivar no pide confirmación aparte: es reversible (se reactiva) y el servidor lo rechaza si el rol tiene personas. MODALES: ninguno. HISTORIAL (B3b, DEC-IDE-005): bloque al pie de la ficha de un rol, solo lectura y sin campos ni botones; cada fila dice cuándo, quién y qué (si fue una edición, el nombre anterior y las acciones agregadas o quitadas); lo ve quien tiene `roles.ver` (solo el gerente). ESTADOS: lista vacía («Todavía no hay roles propios»), rol archivado
 * (insignia «Archivado») y, ante cualquier falla o sin permiso, el mensaje genérico, sin filas.
 *
 * Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

/** Lo que el dueño aprobó el 26/11/2026 (Excel de roles propios, hojas Acciones y Otras decisiones); DEC-IDE-002 lo asienta. */
const APROBADO_POR_EL_DUENO = {
  decidio:
    "el dueño, 26/11/2026 («esta aprobado todo el excel y las decisiones»: Excel de roles propios, hojas Acciones y Otras decisiones); DEC-IDE-002",
  donde:
    "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md (respuesta del 26/11/2026, Excel de roles propios, hojas Acciones y Otras decisiones)",
} as const;

/** Las etiquetas simples que el dueño delegó (fila 173, DDD:173) y quedaron asentadas el 26/11/2026; DEC-IDE-003. */
const ETIQUETA_DELEGADA = {
  decidio:
    "el dueño, por la delegación de textos del 15/11/2026 (DDD:173, aceptada el 26/11/2026; etiqueta simple, sin dinero, permisos ni fiscal); DEC-IDE-003",
  donde:
    "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila 173 (delegación de textos); inventario de textos de la pantalla Roles",
} as const;

/** Los ocho textos del bloque «Historial» de la ficha de un rol que el orquestador aceptó por delegación (fila 173, 26/11/2026); DEC-IDE-005. */
const HISTORIAL_DELEGADO = {
  decidio:
    "el dueño, por la delegación de textos del 15/11/2026 (DDD:173, aceptada el 26/11/2026; etiqueta simple, sin dinero, permisos ni fiscal); DEC-IDE-005",
  donde:
    "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila 173 (delegación de textos); ficha de B3b: el historial de un rol propio",
} as const;

/** Un texto que ya existía en el catálogo y se reusa sin cambios (una regla, un lugar). */
const REUSADO = {
  decidio: "el dueño (texto ya aprobado y en uso en el catálogo, reutilizado sin cambios)",
  donde:
    "Pedernal-docs 10-ux-ui y decisiones-del-dueno-2026-11.md (textos ya aprobados de Caja y del núcleo)",
} as const;

const USO_DE_LA_LISTA = "modelo-de-roles.ts (armarLaListaDeRoles)";
const USO_DEL_ALTA = "modelo-de-roles.ts (armarElFormularioDeAlta)";
const USO_DE_LA_FICHA = "modelo-de-roles.ts (armarLaFichaDeRol)";
const USO_DEL_HISTORIAL = "modelo-de-roles.ts (armarElHistorialDelRol)";

const MODULOS = {
  "roles.modulo.administracion": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.caja": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.catalogo": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.cierre": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.clientes": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.comandas": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.compras": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.cuenta_corriente": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.facturacion": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.produccion": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.salon": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.stock": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.ventas": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
  "roles.modulo.vidriera": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
} as const;

export const FICHA_DE_ROLES = {
  archivos: [
    "apps/web/app/s/app/(operacion)/cuenta/roles/page.tsx",
    "apps/web/app/s/app/(operacion)/cuenta/roles/nuevo/page.tsx",
    "apps/web/app/s/app/(operacion)/cuenta/roles/[rolId]/page.tsx",
    "apps/web/app/s/app/acciones-de-roles.ts",
    "apps/web/servidor/roles.ts",
    "apps/web/ui/plantillas/roles/PantallaDeListaDeRoles.tsx",
    "apps/web/ui/plantillas/roles/FormularioDeAltaDeRol.cliente.tsx",
    "apps/web/ui/plantillas/roles/FormularioDeFichaDeRol.cliente.tsx",
    "apps/web/ui/plantillas/roles/AccionDeEstadoDeRol.cliente.tsx",
    "apps/web/ui/plantillas/roles/HistorialDelRol.tsx",
    "apps/web/ui/plantillas/roles/modelo-de-roles.ts",
    "src/composicion/roles-web.ts",
    "src/composicion/entradas-de-roles.ts",
  ],
  rutas: ["/cuenta/roles", "/cuenta/roles/nuevo", "/cuenta/roles/[rolId]"],
  titulo: "roles.lista.titulo",
  acceso: "roles.ver",
  botones: [
    {
      id: "nuevo",
      texto: "roles.lista.nuevo",
      hace: { navega: "/cuenta/roles/nuevo" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar-alta",
      texto: "caja.accion.guardar",
      hace: { envia: "roles.crear" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar",
      texto: "caja.accion.guardar",
      hace: { envia: "roles.editar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "archivar",
      texto: "roles.boton.archivar",
      hace: { envia: "roles.archivar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "reactivar",
      texto: "caja.accion.reactivar",
      hace: { envia: "roles.editar" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "roles.lista.titulo": {
      usos: [
        "título de la pantalla, del alta y de la ficha",
        "fila del menú de Cuenta (solo gerente)",
      ],
      fuente: APROBADO_POR_EL_DUENO,
    },
    "roles.formulario.que_puede_hacer": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
    "roles.accion_nota.solo_gerente": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
    "roles.accion_nota.fuera_del_plan": { usos: [USO_DE_LA_FICHA], fuente: APROBADO_POR_EL_DUENO },
    "roles.lista.nuevo": { usos: [USO_DE_LA_LISTA, "título del alta"], fuente: ETIQUETA_DELEGADA },
    "roles.lista.vacia": { usos: [USO_DE_LA_LISTA], fuente: ETIQUETA_DELEGADA },
    "roles.lista.personas": { usos: [USO_DE_LA_LISTA], fuente: ETIQUETA_DELEGADA },
    "roles.lista.persona": { usos: [USO_DE_LA_LISTA], fuente: ETIQUETA_DELEGADA },
    "roles.estado.archivado": {
      usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA],
      fuente: ETIQUETA_DELEGADA,
    },
    "roles.boton.archivar": { usos: [USO_DE_LA_FICHA], fuente: ETIQUETA_DELEGADA },
    "roles.formulario.origen": { usos: [USO_DEL_ALTA], fuente: ETIQUETA_DELEGADA },
    "roles.formulario.origen_vacio": { usos: [USO_DEL_ALTA], fuente: ETIQUETA_DELEGADA },
    "roles.formulario.origen_rol": { usos: [USO_DEL_ALTA], fuente: ETIQUETA_DELEGADA },
    "roles.historial.titulo": { usos: [USO_DEL_HISTORIAL], fuente: HISTORIAL_DELEGADO },
    "roles.historial.creado": { usos: [USO_DEL_HISTORIAL], fuente: HISTORIAL_DELEGADO },
    "roles.historial.editado": { usos: [USO_DEL_HISTORIAL], fuente: HISTORIAL_DELEGADO },
    "roles.historial.archivado": { usos: [USO_DEL_HISTORIAL], fuente: HISTORIAL_DELEGADO },
    "roles.historial.reactivado": { usos: [USO_DEL_HISTORIAL], fuente: HISTORIAL_DELEGADO },
    "roles.historial.agregadas": { usos: [USO_DEL_HISTORIAL], fuente: HISTORIAL_DELEGADO },
    "roles.historial.quitadas": { usos: [USO_DEL_HISTORIAL], fuente: HISTORIAL_DELEGADO },
    "roles.historial.nombre_anterior": { usos: [USO_DEL_HISTORIAL], fuente: HISTORIAL_DELEGADO },
    "caja.campo.nombre": { usos: [USO_DEL_ALTA, USO_DE_LA_FICHA], fuente: REUSADO },
    "caja.accion.guardar": { usos: [USO_DEL_ALTA, USO_DE_LA_FICHA], fuente: REUSADO },
    "caja.accion.cancelar": { usos: [USO_DEL_ALTA, USO_DE_LA_FICHA], fuente: REUSADO },
    "caja.accion.reactivar": { usos: [USO_DE_LA_FICHA], fuente: REUSADO },
    "rol.administrador.nombre": { usos: [USO_DEL_ALTA], fuente: REUSADO },
    "rol.operador.nombre": { usos: [USO_DEL_ALTA], fuente: REUSADO },
    ...MODULOS,
  },
  estadoDeLaFicha: "TERMINADA",
} as const satisfies FichaDePantalla;
