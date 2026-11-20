import type { IdDeDato } from "../datos/registro";
import type { ClaveAccionDePlataforma } from "../permisos/plataforma";
import type { ClaveDeTexto } from "../vocabulario/catalogo";
import type { ClaveDeTextoDePlataforma } from "../vocabulario/textos-de-plataforma";

/**
 * LA FICHA DE LA PANTALLA «PLANES» DE LA CONSOLA DE PLATAFORMA (toda pantalla nueva nace con ficha). Declara lo que la pantalla ofrece: rutas y archivos, el acceso, los campos con su dato, los botones con la acción de permiso
 * que cada uno envía, los modales, los estados y cada texto con SUS usos y SU fuente. Misma idea que `ficha-de-impresoras.ts`, con acciones de PLATAFORMA (la consola no usa las de empresa): la comprueba
 * `test/web/ficha-de-planes-de-consola.test.ts` contra el catálogo de textos, el de permisos, el registro de datos y el código. No crea acciones ni permisos: declara los que ya existen.
 * Previene: un botón, un campo o un texto que nadie aprobó, y una ruta o un archivo que se mueve sin que la ficha lo note. Fuente: brief `Pedernal-docs 11-especificaciones/briefs/plataforma/PR-planes-consola.md` y maqueta `planes.html`.
 */

type BotonDeFichaDeConsola = Readonly<{
  id: string;
  texto: ClaveDeTextoDePlataforma;
  hace:
    | Readonly<{ navega: string }>
    | Readonly<{ envia: ClaveAccionDePlataforma }>
    | Readonly<{ abre: string }>;
  /** Qué se ve sin el permiso: AUSENTE (SOPORTE no ve crear, editar ni publicar). Decide siempre el servidor. */
  sinPermiso: "AUSENTE";
}>;

export type FichaDePantallaDeConsola = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  titulo: ClaveDeTextoDePlataforma;
  /** La acción que exige cada consulta de la pantalla y la fila del menú. */
  acceso: ClaveAccionDePlataforma;
  menu: Readonly<{ clave: string; texto: ClaveDeTextoDePlataforma; href: string }>;
  campos: readonly Readonly<{ dato: IdDeDato; archivo: string }>[];
  botones: readonly BotonDeFichaDeConsola[];
  modales: readonly Readonly<{
    id: string;
    titulo: ClaveDeTextoDePlataforma;
    botones: readonly string[];
  }>[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado. */
  estados: Readonly<Record<"ERROR" | "SIN_PERMISO", ClaveDeTextoDePlataforma | "GENERICO">>;
  /** Los textos de ESTA pantalla (el catálogo de la consola es uno solo y lo comparten todas: cada ficha declara los suyos). */
  textos: Readonly<
    Partial<
      Record<
        ClaveDeTextoDePlataforma,
        Readonly<{ usos: readonly string[]; fuente: Readonly<{ decision: `DEC-${number}` }> }>
      >
    >
  >;
  /** Textos ya aprobados del núcleo (conexión, envío y estados) que la pantalla reusa: existen en el catálogo común. */
  textosDelNucleo: readonly ClaveDeTexto[];
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const deLaMaqueta = (...usos: readonly string[]) => ({
  usos,
  fuente: { decision: "DEC-0805" } as const,
});

export const FICHA_DE_PLANES_DE_CONSOLA = {
  archivos: [
    "apps/plataforma/app/planes/page.tsx",
    "apps/plataforma/app/planes/[id]/page.tsx",
    "apps/plataforma/app/planes/[id]/version/[versionId]/page.tsx",
    "apps/plataforma/app/planes/[id]/borrador/page.tsx",
    "apps/plataforma/pantallas/lista-de-planes.tsx",
    "apps/plataforma/pantallas/nuevo-plan.cliente.tsx",
    "apps/plataforma/pantallas/ficha-de-plan.tsx",
    "apps/plataforma/pantallas/vista-de-version.tsx",
    "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
    "apps/plataforma/pantallas/publicar-version.cliente.tsx",
  ],
  rutas: ["/planes", "/planes/[id]", "/planes/[id]/version/[versionId]", "/planes/[id]/borrador"],
  titulo: "plataforma.planes.titulo",
  acceso: "planes.ver",
  menu: { clave: "planes", texto: "plataforma.menu.planes", href: "/planes" },
  campos: [
    { dato: "codigo-de-plan", archivo: "apps/plataforma/pantallas/nuevo-plan.cliente.tsx" },
    {
      dato: "nombre-comercial-de-plan",
      archivo: "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    },
    { dato: "modulo-de-plan", archivo: "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx" },
    {
      dato: "perilla-de-plan",
      archivo: "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
    },
    {
      dato: "limite-de-perilla-de-plan",
      archivo: "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
    },
    { dato: "motivo-de-plan", archivo: "apps/plataforma/pantallas/publicar-version.cliente.tsx" },
  ],
  botones: [
    {
      id: "nuevo-plan",
      texto: "plataforma.planes.nuevo_plan",
      hace: { abre: "nuevo-plan" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "crear-plan",
      texto: "plataforma.planes.crear_plan",
      hace: { envia: "planes.crear" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "nueva-version",
      texto: "plataforma.planes.nueva_version",
      hace: { navega: "/planes/[id]/borrador" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "editar-borrador",
      texto: "plataforma.planes.editar_borrador",
      hace: { navega: "/planes/[id]/borrador" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar",
      texto: "plataforma.planes.guardar",
      hace: { envia: "planes.editar_borrador" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "publicar-abrir",
      texto: "plataforma.planes.publicar_abrir",
      hace: { abre: "publicar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "publicar",
      texto: "plataforma.planes.publicar",
      hace: { envia: "planes.publicar_version" },
      sinPermiso: "AUSENTE",
    },
  ],
  modales: [
    { id: "nuevo-plan", titulo: "plataforma.planes.nuevo_plan", botones: ["crear-plan"] },
    { id: "publicar", titulo: "plataforma.planes.publicar_titulo", botones: ["publicar"] },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "plataforma.planes.no_permitido" },
  textos: {
    "plataforma.menu.planes": deLaMaqueta("apps/plataforma/pantallas/armazon-de-consola.tsx"),
    "plataforma.planes.titulo": deLaMaqueta(
      "apps/plataforma/app/planes/[id]/borrador/page.tsx",
      "apps/plataforma/app/planes/[id]/page.tsx",
      "apps/plataforma/app/planes/[id]/version/[versionId]/page.tsx",
      "apps/plataforma/app/planes/page.tsx",
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
      "apps/plataforma/pantallas/lista-de-planes.tsx",
      "apps/plataforma/pantallas/vista-de-version.tsx",
    ),
    "plataforma.planes.nuevo_plan": deLaMaqueta("apps/plataforma/pantallas/nuevo-plan.cliente.tsx"),
    "plataforma.planes.crear_plan": deLaMaqueta("apps/plataforma/pantallas/nuevo-plan.cliente.tsx"),
    "plataforma.planes.campo_codigo": deLaMaqueta(
      "apps/plataforma/pantallas/nuevo-plan.cliente.tsx",
    ),
    "plataforma.planes.ayuda_codigo": deLaMaqueta(
      "apps/plataforma/pantallas/nuevo-plan.cliente.tsx",
    ),
    "plataforma.planes.col_plan": deLaMaqueta("apps/plataforma/pantallas/lista-de-planes.tsx"),
    "plataforma.planes.col_ultima": deLaMaqueta("apps/plataforma/pantallas/lista-de-planes.tsx"),
    "plataforma.planes.col_borrador": deLaMaqueta("apps/plataforma/pantallas/lista-de-planes.tsx"),
    "plataforma.planes.col_clientes": deLaMaqueta("apps/plataforma/pantallas/lista-de-planes.tsx"),
    "plataforma.planes.col_estado": deLaMaqueta(
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
      "apps/plataforma/pantallas/lista-de-planes.tsx",
    ),
    "plataforma.planes.col_version": deLaMaqueta("apps/plataforma/pantallas/ficha-de-plan.tsx"),
    "plataforma.planes.col_clientes_version": deLaMaqueta(
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
    ),
    "plataforma.planes.col_valor": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.col_origen": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.col_incluido": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.col_perilla": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.col_modulo": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.sin_planes": deLaMaqueta("apps/plataforma/app/planes/page.tsx"),
    "plataforma.planes.hay_borrador": deLaMaqueta("apps/plataforma/pantallas/lista-de-planes.tsx"),
    "plataforma.planes.ninguna": deLaMaqueta("apps/plataforma/pantallas/lista-de-planes.tsx"),
    "plataforma.planes.estado_activo": deLaMaqueta(
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
      "apps/plataforma/pantallas/lista-de-planes.tsx",
    ),
    "plataforma.planes.estado_retirado": deLaMaqueta(
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
      "apps/plataforma/pantallas/lista-de-planes.tsx",
    ),
    "plataforma.planes.version_borrador": deLaMaqueta(
      "apps/plataforma/app/planes/[id]/borrador/page.tsx",
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
    ),
    "plataforma.planes.version_publicada": deLaMaqueta(
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
      "apps/plataforma/pantallas/vista-de-version.tsx",
    ),
    "plataforma.planes.versiones": deLaMaqueta("apps/plataforma/pantallas/ficha-de-plan.tsx"),
    "plataforma.planes.nueva_version": deLaMaqueta("apps/plataforma/pantallas/ficha-de-plan.tsx"),
    "plataforma.planes.nueva_version_sin_base": deLaMaqueta(
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
    ),
    "plataforma.planes.editar_borrador": deLaMaqueta("apps/plataforma/pantallas/ficha-de-plan.tsx"),
    "plataforma.planes.nombre_comercial": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
    ),
    "plataforma.planes.modulos": deLaMaqueta(
      "apps/plataforma/pantallas/ficha-de-plan.tsx",
      "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
      "apps/plataforma/pantallas/vista-de-version.tsx",
    ),
    "plataforma.planes.perillas": deLaMaqueta(
      "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
      "apps/plataforma/pantallas/vista-de-version.tsx",
    ),
    "plataforma.planes.siempre_incluido": deLaMaqueta(
      "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
    ),
    "plataforma.planes.requiere": deLaMaqueta(
      "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
    ),
    "plataforma.planes.lo_pide_otro": deLaMaqueta(
      "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
    ),
    "plataforma.planes.en_desarrollo": deLaMaqueta(
      "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx",
    ),
    "plataforma.planes.advertencia_perilla": deLaMaqueta(
      "apps/plataforma/logica/editor-de-plan.ts",
    ),
    "plataforma.planes.revisar_antes": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    ),
    "plataforma.planes.que_cambia": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    ),
    "plataforma.planes.que_cambio": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.dif_suma": deLaMaqueta("apps/plataforma/logica/editor-de-plan.ts"),
    "plataforma.planes.dif_quita": deLaMaqueta("apps/plataforma/logica/editor-de-plan.ts"),
    "plataforma.planes.dif_perilla": deLaMaqueta("apps/plataforma/logica/editor-de-plan.ts"),
    "plataforma.planes.sin_cambios": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
      "apps/plataforma/pantallas/vista-de-version.tsx",
    ),
    "plataforma.planes.guardar": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    ),
    "plataforma.planes.borrador_guardado": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    ),
    "plataforma.planes.publicar": deLaMaqueta(
      "apps/plataforma/pantallas/publicar-version.cliente.tsx",
    ),
    "plataforma.planes.publicar_abrir": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    ),
    "plataforma.planes.publicar_titulo": deLaMaqueta(
      "apps/plataforma/pantallas/publicar-version.cliente.tsx",
    ),
    "plataforma.planes.publicar_resumen": deLaMaqueta(
      "apps/plataforma/pantallas/publicar-version.cliente.tsx",
    ),
    "plataforma.planes.motivo": deLaMaqueta(
      "apps/plataforma/pantallas/publicar-version.cliente.tsx",
    ),
    "plataforma.planes.motivo_ayuda": deLaMaqueta(
      "apps/plataforma/pantallas/publicar-version.cliente.tsx",
    ),
    "plataforma.planes.publicada_aviso": deLaMaqueta("apps/plataforma/pantallas/ficha-de-plan.tsx"),
    "plataforma.planes.ficha_aviso": deLaMaqueta("apps/plataforma/pantallas/ficha-de-plan.tsx"),
    "plataforma.planes.sin_borrador": deLaMaqueta("apps/plataforma/logica/errores-de-planes.ts"),
    "plataforma.planes.falta_nombre": deLaMaqueta(
      "apps/plataforma/logica/errores-de-planes.ts",
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    ),
    "plataforma.planes.falta_motivo": deLaMaqueta(
      "apps/plataforma/logica/errores-de-planes.ts",
      "apps/plataforma/pantallas/publicar-version.cliente.tsx",
    ),
    "plataforma.planes.codigo_invalido": deLaMaqueta(
      "apps/plataforma/logica/errores-de-planes.ts",
      "apps/plataforma/pantallas/nuevo-plan.cliente.tsx",
    ),
    "plataforma.planes.version_vieja": deLaMaqueta("apps/plataforma/logica/errores-de-planes.ts"),
    "plataforma.planes.no_permitido": deLaMaqueta(
      "apps/plataforma/app/planes/[id]/borrador/page.tsx",
      "apps/plataforma/logica/errores-de-planes.ts",
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
      "apps/plataforma/pantallas/publicar-version.cliente.tsx",
    ),
    "plataforma.planes.clientes_con_version": deLaMaqueta(
      "apps/plataforma/pantallas/vista-de-version.tsx",
    ),
    "plataforma.planes.sin_clientes": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.volver": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    ),
    "plataforma.planes.cancelar": deLaMaqueta(
      "apps/plataforma/pantallas/nuevo-plan.cliente.tsx",
      "apps/plataforma/pantallas/publicar-version.cliente.tsx",
    ),
    "plataforma.planes.si": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.no": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.valor_encendida": deLaMaqueta("apps/plataforma/logica/editor-de-plan.ts"),
    "plataforma.planes.valor_apagada": deLaMaqueta("apps/plataforma/logica/editor-de-plan.ts"),
    "plataforma.planes.origen_base": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.origen_plan": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.version_inmutable": deLaMaqueta(
      "apps/plataforma/pantallas/vista-de-version.tsx",
    ),
    "plataforma.planes.publicada_por": deLaMaqueta(
      "apps/plataforma/pantallas/vista-de-version.tsx",
    ),
    "plataforma.planes.motivo_de": deLaMaqueta("apps/plataforma/pantallas/vista-de-version.tsx"),
    "plataforma.planes.copiada_de": deLaMaqueta(
      "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx",
    ),
    "plataforma.planes.plan_creado": deLaMaqueta("apps/plataforma/pantallas/ficha-de-plan.tsx"),
    "plataforma.planes.plan_ya_existia": deLaMaqueta("apps/plataforma/pantallas/ficha-de-plan.tsx"),
  },
  textosDelNucleo: ["conexion.no_se_puede_enviar", "conexion.verificando", "estado.error_titulo"],
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantallaDeConsola;
