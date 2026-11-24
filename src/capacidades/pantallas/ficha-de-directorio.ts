import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «CLIENTES Y PROVEEDORES» (DDD:174: toda pantalla nueva nace con ficha). Declara lo que la pantalla ofrece: rutas y archivos, el acceso, los botones con la acción de
 * permiso que cada uno envía, los estados y cada texto con SU uso y SU fuente. Es solo una declaración (todavía no existen los tipos comunes ni el analizador de fichas): lleva su propio tipo
 * local, como la de «Mesas», y la comprueba `test/web/ficha-de-directorio.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase.
 * No crea acciones ni permisos: declara los que ya existen. Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

type FuenteDeTexto = Readonly<{
  /** Quién lo decidió y cuándo: nunca «lo aprobó el orquestador». */
  decidio: string;
  /** Documento y lugar verificables (repositorio de documentos, Pedernal-docs). */
  donde: string;
}>;

type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;

type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }>;
  /** Qué se ve sin el permiso: el botón apagado (o ausente) es solo una ayuda; decide el servidor. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDePantalla = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  titulo: ClaveDeTexto;
  /** La acción que exige la consulta de la pantalla y la fila del menú. */
  acceso: ClaveAccion;
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado. */
  estados: Readonly<Record<"ERROR" | "SIN_PERMISO", "GENERICO">>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const MAQUETA_APROBADA: FuenteDeTexto = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `directorio.html`, tabla «Textos nuevos»; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md); catálogo cargado por DEC-0566",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta directorio.html (tabla «Textos nuevos», línea 266, y funciones `vLista` y `vForm`) y e9-compras-especificacion.md §10",
};
const REUSO_APROBADO: FuenteDeTexto = {
  decidio:
    "el dueño, 09/11/2026 (la maqueta `directorio.html` dibuja la misma palabra; ya aprobada con clave propia en otra pantalla)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta directorio.html (`vLista` y `vForm`) y 11-especificaciones/pantallas-de-compras-inventario.md §5 (reuso de claves)",
};
const FILTROS_DEL_DUENO: FuenteDeTexto = {
  decidio:
    "el dueño, 18/11/2026 (los filtros se aplican con un botón «Aplicar filtros», no al escribir; «Página siguiente» es el de las demás listas)",
  donde:
    "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila 294; textos ya aprobados de fiscal (`fiscal.pantalla.listado_*`)",
};

const USO_DE_LA_LISTA = "modelo-de-directorio.ts (lista)";
const USO_DE_LOS_FILTROS = "modelo-de-directorio.ts (filtros)";
const USO_DEL_FORMULARIO = "modelo-de-formulario-de-parte.ts";
const USO_DEL_ERROR = "error del servidor (respuesta de clientes)";

const delFormulario = (fuente: FuenteDeTexto = REUSO_APROBADO): TextoDeFicha => ({
  usos: [USO_DEL_FORMULARIO],
  fuente,
});

export const FICHA_DE_DIRECTORIO = {
  archivos: [
    "apps/web/app/s/app/(operacion)/clientes/page.tsx",
    "apps/web/app/s/app/(operacion)/clientes/nuevo/page.tsx",
    "apps/web/app/s/app/(operacion)/clientes/[id]/page.tsx",
    "apps/web/app/s/app/acciones-de-directorio.ts",
    "apps/web/ui/plantillas/clientes/modelo-de-directorio.ts",
    "apps/web/ui/plantillas/clientes/modelo-de-formulario-de-parte.ts",
    "apps/web/ui/plantillas/clientes/PantallaDeListaDelDirectorio.tsx",
    "apps/web/ui/plantillas/clientes/FormularioDeFiltrosDelDirectorio.cliente.tsx",
    "apps/web/ui/plantillas/clientes/FormularioDeParte.cliente.tsx",
    "apps/web/ui/plantillas/clientes/FormularioDeEstadoDeParte.cliente.tsx",
    "apps/web/ui/plantillas/clientes/PantallasDelDirectorio.module.css",
  ],
  rutas: ["/clientes", "/clientes/nuevo", "/clientes/[id]"],
  titulo: "clientes.lista.clientes_y_proveedores",
  acceso: "partes.ver",
  botones: [
    {
      id: "nuevo",
      texto: "clientes.lista.nuevo",
      hace: { navega: "/clientes/nuevo" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar",
      texto: "catalogo.accion.guardar",
      hace: { envia: "partes.crear" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar-edicion",
      texto: "catalogo.accion.guardar",
      hace: { envia: "partes.editar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar-igual",
      texto: "clientes.lista.guardar_igual",
      hace: { envia: "partes.crear" },
      sinPermiso: "APAGADO",
    },
    {
      id: "desactivar",
      texto: "clientes.lista.desactivar",
      hace: { envia: "partes.desactivar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "reactivar",
      texto: "clientes.lista.reactivar",
      hace: { envia: "partes.reactivar" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "clientes.lista.clientes_y_proveedores": {
      usos: ["título de la pantalla", "título de la ficha si no hay nombre"],
      fuente: MAQUETA_APROBADA,
    },
    "clientes.lista.clientes": {
      usos: ["fila «Clientes» del menú (área Ventas)", USO_DE_LOS_FILTROS],
      fuente: MAQUETA_APROBADA,
    },
    "clientes.lista.proveedores": {
      usos: ["fila «Proveedores» del menú (área Compras)", USO_DE_LOS_FILTROS],
      fuente: MAQUETA_APROBADA,
    },
    "clientes.lista.nuevo": {
      usos: [USO_DE_LA_LISTA, "título del alta"],
      fuente: MAQUETA_APROBADA,
    },
    "clientes.lista.mostrar_desactivados": { usos: [USO_DE_LOS_FILTROS], fuente: MAQUETA_APROBADA },
    "clientes.lista.persona": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.lista.empresa": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.lista.razon_social": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.lista.condicion_frente_al_iva": {
      usos: [USO_DEL_FORMULARIO],
      fuente: MAQUETA_APROBADA,
    },
    "clientes.lista.posibles_duplicados": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.lista.guardar_igual": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.lista.desactivar": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.lista.reactivar": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.formulario.apellido": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.formulario.tipo_de_documento": {
      usos: [USO_DEL_FORMULARIO],
      fuente: MAQUETA_APROBADA,
    },
    "clientes.formulario.pais": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.formulario.email": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.formulario.nota": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "clientes.formulario.roles": {
      usos: [
        USO_DEL_FORMULARIO,
        "rótulo del filtro de rol (SUPUESTO (DEC-0837): la maqueta usa pestañas sin rótulo)",
      ],
      fuente: MAQUETA_APROBADA,
    },
    "catalogo.lista.buscar": { usos: [USO_DE_LOS_FILTROS], fuente: REUSO_APROBADO },
    "catalogo.lista.todos": { usos: [USO_DE_LOS_FILTROS], fuente: REUSO_APROBADO },
    "catalogo.lista.sin_resultados": { usos: [USO_DE_LA_LISTA], fuente: REUSO_APROBADO },
    "catalogo.estado.desactivado": { usos: [USO_DE_LA_LISTA], fuente: REUSO_APROBADO },
    "fiscal.pantalla.listado_aplicar": { usos: [USO_DE_LOS_FILTROS], fuente: FILTROS_DEL_DUENO },
    "fiscal.pantalla.listado_pagina_siguiente": {
      usos: [USO_DE_LA_LISTA],
      fuente: FILTROS_DEL_DUENO,
    },
    "fiscal.pantalla.rotulo_cliente": {
      usos: [USO_DE_LA_LISTA, "casilla de rol del formulario"],
      fuente: REUSO_APROBADO,
    },
    "compras.compra.proveedor": {
      usos: [USO_DE_LA_LISTA, "casilla de rol del formulario"],
      fuente: REUSO_APROBADO,
    },
    "catalogo.dato.nombre": delFormulario(),
    "fiscal.pantalla.config_cert_alias": delFormulario(),
    "salon.texto.admin_numero": delFormulario(),
    "sucursal.telefono": delFormulario(),
    "fiscal.pantalla.config_df_domicilio_fiscal": delFormulario(),
    "fiscal.pantalla.config_pv_calle": delFormulario(),
    "fiscal.pantalla.config_pv_numero_de_calle": delFormulario(),
    "fiscal.pantalla.config_pv_localidad": delFormulario(),
    "fiscal.pantalla.config_pv_provincia": delFormulario(),
    "fiscal.pantalla.config_pv_codigo_postal": delFormulario(),
    "catalogo.dato.sin_elegir": delFormulario(),
    "catalogo.accion.guardar": delFormulario(),
    "catalogo.seccion.volver_a_la_lista": delFormulario(),
    "catalogo.campo.opcional": delFormulario(),
    "fiscal.pantalla.documento_cuit": delFormulario(),
    "fiscal.pantalla.documento_cuil": delFormulario(),
    "fiscal.pantalla.documento_cdi": delFormulario(),
    "fiscal.pantalla.documento_dni": delFormulario(),
    "fiscal.pantalla.documento_pasaporte": delFormulario(),
    "fiscal.pantalla.emitir_condicion_responsable_inscripto": delFormulario(),
    "fiscal.pantalla.emitir_condicion_exento": delFormulario(),
    "fiscal.pantalla.emitir_condicion_consumidor_final": delFormulario(),
    "fiscal.pantalla.emitir_condicion_monotributo": delFormulario(),
    "fiscal.pantalla.emitir_condicion_no_categorizado": delFormulario(),
    "fiscal.pantalla.emitir_condicion_proveedor_del_exterior": delFormulario(),
    "fiscal.pantalla.emitir_condicion_cliente_del_exterior": delFormulario(),
    "fiscal.pantalla.emitir_condicion_iva_liberado": delFormulario(),
    "fiscal.pantalla.emitir_condicion_monotributista_social": delFormulario(),
    "fiscal.pantalla.emitir_condicion_iva_no_alcanzado": delFormulario(),
    "fiscal.pantalla.emitir_condicion_monotributo_promovido": delFormulario(),
    "clientes.error.falta_el_nombre": { usos: [USO_DEL_ERROR], fuente: MAQUETA_APROBADA },
    "clientes.error.cuit_invalido": { usos: [USO_DEL_ERROR], fuente: MAQUETA_APROBADA },
    "clientes.error.dni_invalido": { usos: [USO_DEL_ERROR], fuente: MAQUETA_APROBADA },
    "clientes.error.empresa_solo_cuit_o_extranjero": {
      usos: [USO_DEL_ERROR],
      fuente: MAQUETA_APROBADA,
    },
    "clientes.error.documento_ya_registrado": { usos: [USO_DEL_ERROR], fuente: MAQUETA_APROBADA },
    "clientes.error.parte_inactiva_con_ese_documento": {
      usos: [USO_DEL_ERROR],
      fuente: MAQUETA_APROBADA,
    },
    "clientes.error.email_invalido": { usos: [USO_DEL_ERROR], fuente: MAQUETA_APROBADA },
    "clientes.error.telefono_invalido": { usos: [USO_DEL_ERROR], fuente: MAQUETA_APROBADA },
    "clientes.error.sin_permiso": { usos: [USO_DEL_ERROR], fuente: MAQUETA_APROBADA },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
