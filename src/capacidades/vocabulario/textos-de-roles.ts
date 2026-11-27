import type { FuenteDeTexto, UsoDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos de la pantalla «Roles» de Cuenta (prefijo `roles.`; los nombres de cada acción están aparte, en `catalogo-acciones-de-roles.ts`). Fuentes:
 *  - DEC-IDE-002: lo que el dueño aprobó el 26/11/2026 (Excel de roles propios): el título «Roles» (menú Cuenta, solo gerente), los nombres de módulo de la tabla de acciones, «Qué puede hacer», «Solo el gerente» y «No incluida en el plan».
 *  - DEC-IDE-003: los ocho textos de etiqueta que aceptó el orquestador por delegación (fila 173, 26/11/2026; inventario de textos de la pantalla).
 *  - DEC-IDE-005: los ocho textos del bloque «Historial» de la ficha de un rol (misma delegación, 26/11/2026).
 * Lo que la pantalla ya podía decir con un texto existente NO tiene clave nueva (una regla, un lugar): «Nombre» (`caja.campo.nombre`), «Guardar» (`caja.accion.guardar`), «Cancelar»
 * (`caja.accion.cancelar`), «Reactivar» (`caja.accion.reactivar`) y los roles base (`rol.*.nombre`).
 */
const APROBADO: FuenteDeTexto = { decision: "DEC-IDE-002" };
const ACEPTADO: FuenteDeTexto = { decision: "DEC-IDE-003" };
const ACEPTADO_PARA_EL_HISTORIAL: FuenteDeTexto = { decision: "DEC-IDE-005" };
const MODELO = "apps/web/ui/plantillas/roles/modelo-de-roles.ts";
const usoDe = (nombre: string): readonly [UsoDeTexto] => [
  { como: "FUNCION", archivo: MODELO, nombre },
];

export const TEXTOS_DE_ROLES = {
  "roles.lista.titulo": {
    porDefecto: "Roles",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/cuenta/roles/page.tsx",
        nombre: "PaginaDeRoles",
      },
      { como: "FUNCION", archivo: "apps/web/ui/navegacion/menu.ts", nombre: "FILAS_DEL_MENU" },
    ],
    fuente: APROBADO,
  },
  "roles.formulario.que_puede_hacer": {
    porDefecto: "Qué puede hacer",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.accion_nota.solo_gerente": {
    porDefecto: "Solo el gerente",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.accion_nota.fuera_del_plan": {
    porDefecto: "No incluida en el plan",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.lista.nuevo": {
    porDefecto: "Nuevo rol",
    usos: usoDe("armarLaListaDeRoles"),
    fuente: ACEPTADO,
  },
  "roles.lista.vacia": {
    porDefecto: "Todavía no hay roles propios",
    usos: usoDe("armarLaListaDeRoles"),
    fuente: ACEPTADO,
  },
  "roles.lista.personas": {
    porDefecto: "{n} personas",
    marcadores: ["n"],
    usos: usoDe("armarLaListaDeRoles"),
    fuente: ACEPTADO,
  },
  "roles.lista.persona": {
    porDefecto: "1 persona",
    usos: usoDe("armarLaListaDeRoles"),
    fuente: ACEPTADO,
  },
  "roles.estado.archivado": {
    porDefecto: "Archivado",
    usos: usoDe("armarLaListaDeRoles"),
    fuente: ACEPTADO,
  },
  "roles.boton.archivar": {
    porDefecto: "Archivar",
    usos: usoDe("armarLaListaDeRoles"),
    fuente: ACEPTADO,
  },
  "roles.formulario.origen": {
    porDefecto: "Empezar desde",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: ACEPTADO,
  },
  "roles.formulario.origen_vacio": {
    porDefecto: "Sin acciones",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: ACEPTADO,
  },
  "roles.formulario.origen_rol": {
    porDefecto: "Copiar de otro rol",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: ACEPTADO,
  },
  "roles.modulo.administracion": {
    porDefecto: "Administración",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.caja": {
    porDefecto: "Caja",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.catalogo": {
    porDefecto: "Catálogo",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.cierre": {
    porDefecto: "Cierre del día",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.clientes": {
    porDefecto: "Clientes y proveedores",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.comandas": {
    porDefecto: "Comandas",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.compras": {
    porDefecto: "Compras",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.cuenta_corriente": {
    porDefecto: "Cuenta corriente",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.facturacion": {
    porDefecto: "Facturación",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.produccion": {
    porDefecto: "Producción",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.salon": {
    porDefecto: "Salón",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.stock": {
    porDefecto: "Stock",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.ventas": {
    porDefecto: "Ventas",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.modulo.vidriera": {
    porDefecto: "Vidriera (cartas)",
    usos: usoDe("armarElFormularioDeRol"),
    fuente: APROBADO,
  },
  "roles.historial.titulo": {
    porDefecto: "Historial",
    usos: usoDe("armarElHistorialDelRol"),
    fuente: ACEPTADO_PARA_EL_HISTORIAL,
  },
  "roles.historial.creado": {
    porDefecto: "Rol creado",
    usos: usoDe("armarElHistorialDelRol"),
    fuente: ACEPTADO_PARA_EL_HISTORIAL,
  },
  "roles.historial.editado": {
    porDefecto: "Rol editado",
    usos: usoDe("armarElHistorialDelRol"),
    fuente: ACEPTADO_PARA_EL_HISTORIAL,
  },
  "roles.historial.archivado": {
    porDefecto: "Rol archivado",
    usos: usoDe("armarElHistorialDelRol"),
    fuente: ACEPTADO_PARA_EL_HISTORIAL,
  },
  "roles.historial.reactivado": {
    porDefecto: "Rol reactivado",
    usos: usoDe("armarElHistorialDelRol"),
    fuente: ACEPTADO_PARA_EL_HISTORIAL,
  },
  "roles.historial.agregadas": {
    porDefecto: "Acciones agregadas",
    usos: usoDe("armarElHistorialDelRol"),
    fuente: ACEPTADO_PARA_EL_HISTORIAL,
  },
  "roles.historial.quitadas": {
    porDefecto: "Acciones quitadas",
    usos: usoDe("armarElHistorialDelRol"),
    fuente: ACEPTADO_PARA_EL_HISTORIAL,
  },
  "roles.historial.nombre_anterior": {
    porDefecto: "Nombre anterior",
    usos: usoDe("armarElHistorialDelRol"),
    fuente: ACEPTADO_PARA_EL_HISTORIAL,
  },
} as const;
