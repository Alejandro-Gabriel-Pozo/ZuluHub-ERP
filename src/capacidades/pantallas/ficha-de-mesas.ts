import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «MESAS» (S-1; DDD:174: toda pantalla nueva nace con ficha). Declara lo que la pantalla ofrece: rutas y archivos, el acceso, los botones con la acción de permiso
 * que cada uno envía, los estados y cada texto con SU uso y SU fuente. Hoy es solo una declaración (todavía no existen los tipos comunes ni el analizador de fichas, `ficha-de-pantalla-diseno.md`
 * tramos T1 a T4): esta ficha lleva su propio tipo local y la comprueba `ficha-de-mesas.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase.
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
    "el dueño, 09/11/2026 (aprobó la maqueta `mesas.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta mesas.html (tabla «Textos nuevos») y e7-salon-e-impresion-especificacion.md §10, fila «Mesas (administración)»",
};
const USO_DEL_FORMULARIO = "FormularioDeMesa.cliente.tsx";
const USO_DE_LA_LISTA = "modelo-de-mesas.ts (lista)";

export const FICHA_DE_MESAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/salon/mesas/page.tsx",
    "apps/web/app/s/app/(operacion)/salon/mesas/nueva/page.tsx",
    "apps/web/app/s/app/(operacion)/salon/mesas/[id]/page.tsx",
    "apps/web/ui/plantillas/salon/PantallaDeListaDeMesas.tsx",
    "apps/web/ui/plantillas/salon/FormularioDeMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/FormularioDeEstadoDeMesa.cliente.tsx",
  ],
  rutas: ["/salon/mesas", "/salon/mesas/nueva", "/salon/mesas/[id]"],
  titulo: "salon.texto.admin_mesas",
  acceso: "mesas.ver",
  botones: [
    {
      id: "agregar",
      texto: "salon.texto.admin_agregar_mesa",
      hace: { navega: "/salon/mesas/nueva" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "editar",
      texto: "salon.texto.admin_editar_mesa",
      hace: { navega: "/salon/mesas/[id]" },
      sinPermiso: "APAGADO",
    },
    {
      id: "desactivar",
      texto: "salon.texto.admin_desactivar",
      hace: { envia: "mesas.desactivar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "reactivar",
      texto: "salon.texto.admin_reactivar",
      hace: { envia: "mesas.reactivar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar-alta",
      texto: "salon.texto.admin_guardar",
      hace: { envia: "mesas.crear" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar-edicion",
      texto: "salon.texto.admin_guardar",
      hace: { envia: "mesas.editar" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "salon.texto.admin_mesas": {
      usos: ["título de la pantalla", "fila del menú"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_agregar_mesa": {
      usos: [USO_DE_LA_LISTA, "título del alta"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_editar_mesa": {
      usos: [USO_DE_LA_LISTA, "título de la edición"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_mesa_numero": {
      usos: [USO_DE_LA_LISTA],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (maqueta `mesas.html`, rótulo de cada tarjeta; el mismo «Mesa 5» del papel de la comanda)",
        donde: "Pedernal-docs 10-ux-ui, maqueta mesas.html, función `vLista`",
      },
    },
    "salon.texto.admin_numero": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "salon.texto.admin_forma": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "salon.texto.admin_redonda": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_LISTA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_cuadrada": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_LISTA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_larga": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_LISTA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_tamano": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "salon.texto.admin_chica": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_LISTA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_mediana": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_LISTA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_grande": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_LISTA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_columna": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_LISTA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_fila": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_LISTA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_guardar": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "salon.texto.admin_desactivar": { usos: [USO_DE_LA_LISTA], fuente: MAQUETA_APROBADA },
    "salon.texto.admin_reactivar": { usos: [USO_DE_LA_LISTA], fuente: MAQUETA_APROBADA },
    "salon.texto.admin_desactivada": { usos: [USO_DE_LA_LISTA], fuente: MAQUETA_APROBADA },
    "salon.texto.admin_escribi_un_numero_del_1_al_99": {
      usos: ["error del servidor (SALON_NUMERO_DE_MESA_INVALIDO)"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_ya_existe_una_mesa_con_ese_numero": {
      usos: ["error del servidor (SALON_NUMERO_DE_MESA_EN_USO)"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.admin_queda_fuera_del_salon": {
      usos: ["error del servidor (SALON_MESA_FUERA_DEL_SALON)"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.error.se_superpone_con_la_mesa": {
      usos: ["error del servidor (SALON_MESA_SUPERPUESTA)"],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (maqueta `mesas.html`: «Se superpone con la mesa» seguido del número de la mesa que se pisa)",
        donde: "Pedernal-docs 10-ux-ui, maqueta mesas.html, función `validar`",
      },
    },
    "salon.texto.grupo_salon": {
      usos: ["grupo «Salón» del menú (área Ventas)"],
      fuente: {
        decidio: "el dueño, 13/11/2026 (nombres de grupos del menú por áreas aprobados)",
        donde: "Pedernal-docs 10-ux-ui, maqueta menu-por-areas.html, texto `p.salon` (ap: true)",
      },
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
