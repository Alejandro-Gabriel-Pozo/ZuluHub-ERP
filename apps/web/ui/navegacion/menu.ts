import {
  CATALOGO_DE_MODULOS,
  type ClaveAccion,
  type ClaveModulo,
} from "../../../../src/capacidades/modulos/catalogo";
import type { ClaveDeTexto } from "../../../../src/capacidades/vocabulario/catalogo";
import type { ClaveDeIcono } from "../iconos/catalogo";
import { RUTAS_DE_CAJA } from "../plantillas/caja/lista-de-caja";
import { RUTA_DE_PRODUCTOS } from "../plantillas/catalogo/filtros-de-productos";
import { RUTAS_DE_CONFIGURACION } from "../plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { RUTA_DEL_LISTADO } from "../plantillas/facturacion/filtros-del-listado";
import { RUTAS_DE_CUENTA } from "../plantillas/sesion/rutas-de-cuenta";

/**
 * EL MENÚ POR ÁREAS: una sola tabla declarativa (área → grupo → pantalla), una fila por pantalla. Es la ÚNICA fuente de qué hay en el
 * menú, en qué área y grupo, qué módulo y qué acción exige: mover una pantalla de grupo o de área es cambiar UNA fila, y sumar un rubro es
 * sumar un área y sus filas (dueño, 12/11/2026: «siempre tiene que estar presente la escalabilidad o el posible cambio de rumbo al tema
 * de la organización de la pantalla», `decisiones-del-dueno-2026-11.md`, fila «Menú por áreas, versión 4»). Estructura «B: por módulo»
 * (12/11/2026): Ventas, Catálogo, Compras y Cuenta; maqueta `10-ux-ui/prototipos-gastronomia/menu-por-areas.html` (versión 5).
 *
 * Solo entra una fila con RUTA real y texto aprobado: una pantalla sin construir no se declara (una fila sin ruta daría un 404 a quien
 * tenga el permiso) y un rótulo sin aprobar no se inventa. Las pantallas de la maqueta que todavía no existen se suman con su fila cuando
 * existan. Previene: componentes que fijan áreas o grupos a mano (`test/arquitectura/menu-por-areas.test.ts`).
 */

/** Las áreas, en el orden en que se ofrecen. `Cuenta` es fija: no ocupa lugar entre las áreas de la barra. */
export const AREAS_DEL_MENU = [
  // Los nombres de las áreas los aprobó el dueño «por ahora» el 12/11/2026 (`decisiones-del-dueno-2026-11.md`, fila «Menú por áreas,
  // versión 4»). Íconos: SUPUESTO (DEC-0359), se reutilizan los que ya existen (la maqueta deja los íconos por definir); revertirlo es cambiar una fila.
  { clave: "ventas", etiqueta: "navegacion.area.ventas", icono: "comprobantes", fija: false },
  { clave: "catalogo", etiqueta: "navegacion.area.catalogo", icono: "secciones", fija: false },
  { clave: "cuenta", etiqueta: "navegacion.cuenta", icono: "cuenta", fija: true },
] as const satisfies readonly Readonly<{
  clave: string;
  etiqueta: ClaveDeTexto;
  icono: ClaveDeIcono;
  fija: boolean;
}>[];
export type ClaveDeArea = (typeof AREAS_DEL_MENU)[number]["clave"];

/**
 * Los grupos. Un grupo con `etiqueta: null` se muestra sin encabezado (maqueta v5: «un grupo con una sola pantalla que se llama igual se
 * muestra como una fila, sin encabezado repetido»).
 */
export const GRUPOS_DEL_MENU = [
  { clave: "comprobantes", etiqueta: null },
  { clave: "productos", etiqueta: null },
  { clave: "empresa", etiqueta: "navegacion.empresa" },
  { clave: "sucursal", etiqueta: "sucursal.etiqueta" },
  { clave: "salir", etiqueta: null },
] as const satisfies readonly Readonly<{ clave: string; etiqueta: ClaveDeTexto | null }>[];
type ClaveDeGrupo = (typeof GRUPOS_DEL_MENU)[number]["clave"];

type BaseDeFila = Readonly<{
  area: ClaveDeArea;
  grupo: ClaveDeGrupo;
  /** Clave del texto en el catálogo del vocabulario: solo textos aprobados por el dueño. */
  etiqueta: ClaveDeTexto;
}>;

/** Una pantalla: el módulo del catálogo y la acción que su consulta exige al guard (la misma): sin ellas no se ofrece. */
export type FilaDePantalla = BaseDeFila &
  Readonly<{
    tipo: "pantalla";
    clave: "comprobantes" | "productos" | "configuracion-fiscal" | "medios-de-pago" | "contacto";
    modulo: ClaveModulo;
    accion: ClaveAccion;
    href: string;
    /**
     * COLUMNA RESERVADA: el departamento (unidad de negocio) al que pertenece la fila; `null` = vale para todos. Hoy ninguna fila lo usa y
     * solo las de Ventas pueden llevarlo (dueño, 13/11/2026: el selector filtra solo Ventas). Lo usará el selector de contexto (A2c).
     */
    departamento: string | null;
  }>;

/** Una acción del menú que no es una pantalla (no lleva ruta): «Cerrar sesión». */
export type FilaDeAccion = BaseDeFila &
  Readonly<{ tipo: "accion"; clave: "cerrar-sesion"; departamento: null }>;

export type FilaDelMenu = FilaDePantalla | FilaDeAccion;
export type ClaveDeFila = FilaDelMenu["clave"];

/**
 * LA TABLA. El orden de las filas es el orden de aparición. «Medios de pago» nace declarado y cerrado: su módulo (`caja`) está «en
 * desarrollo» y no da permisos a nadie. Su rótulo es el título aprobado de la pantalla, «Medios de pago» (`caja.medios.titulo`); la
 * maqueta dice «Medios de pago y cajas», que no tiene clave: va a preguntas pendientes.
 */
export const FILAS_DEL_MENU: readonly FilaDelMenu[] = [
  {
    tipo: "pantalla",
    clave: "comprobantes",
    area: "ventas",
    grupo: "comprobantes",
    modulo: "facturacion",
    accion: "comprobantes.ver",
    href: RUTA_DEL_LISTADO,
    etiqueta: "fiscal.pantalla.listado_titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "productos",
    area: "catalogo",
    grupo: "productos",
    modulo: "catalogo",
    accion: "productos.ver",
    href: RUTA_DE_PRODUCTOS,
    etiqueta: "catalogo.lista.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "configuracion-fiscal",
    area: "cuenta",
    grupo: "empresa",
    modulo: "administracion",
    accion: "datos_fiscales.editar",
    href: RUTAS_DE_CONFIGURACION.lista,
    etiqueta: "fiscal.pantalla.config_titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "medios-de-pago",
    area: "cuenta",
    grupo: "empresa",
    modulo: "caja",
    accion: "medios_de_pago.editar",
    href: RUTAS_DE_CAJA.medios,
    etiqueta: "caja.medios.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "contacto",
    area: "cuenta",
    grupo: "sucursal",
    modulo: "administracion",
    accion: "sucursales.editar",
    href: RUTAS_DE_CUENTA.contactoDeLaSucursal,
    etiqueta: "sucursal.contacto_titulo",
    departamento: null,
  },
  {
    tipo: "accion",
    clave: "cerrar-sesion",
    area: "cuenta",
    grupo: "salir",
    etiqueta: "cuenta.cerrar_sesion",
    departamento: null,
  },
];

/** Lo que el menú necesita saber de los permisos de la persona (lo calcula el servidor: `permisosDelActor`). */
export type PermisosParaElMenu = Readonly<{
  acciones: readonly string[];
  modulos: Readonly<{ activos: readonly string[]; enSoloLectura: readonly string[] }>;
}>;

export type ItemDelMenu = Readonly<{
  tipo: FilaDelMenu["tipo"];
  clave: ClaveDeFila;
  etiqueta: ClaveDeTexto;
  /** La ruta de la pantalla; `null` en una acción. */
  href: string | null;
}>;
type GrupoDelMenu = Readonly<{
  clave: ClaveDeGrupo;
  etiqueta: ClaveDeTexto | null;
  items: readonly ItemDelMenu[];
}>;
export type AreaDelMenu = Readonly<{
  clave: ClaveDeArea;
  etiqueta: ClaveDeTexto;
  icono: ClaveDeIcono;
  fija: boolean;
  grupos: readonly GrupoDelMenu[];
}>;

/**
 * Todo nace cerrado: una pantalla se muestra solo si su módulo está `disponible` en el catálogo (uno «en desarrollo» no da permisos a
 * nadie), la empresa lo tiene activo o en solo lectura y la persona tiene la acción según `permisosDelActor`. SUPUESTO (DEC-0059): en
 * solo lectura SÍ se muestra (las pantallas del menú solo consultan; el guard rechaza lo que escribe). Sin permisos leídos (`null`) no se
 * muestra nada. Las acciones («Cerrar sesión») aparecen siempre que se leyeron los permisos. Con un departamento declarado en la fila,
 * la fila se muestra solo si ese es el elegido; sin departamento elegido no se asume «todos». Un grupo aparece solo si le queda un ítem y
 * un área solo si le queda un grupo. Ocultar no es autorizar: cada pantalla vuelve a pasar por el guard.
 */
export function armarElMenu(
  filas: readonly FilaDelMenu[],
  permisos: PermisosParaElMenu | null,
  departamentoElegido: string | null,
): readonly AreaDelMenu[] {
  if (permisos === null) return [];
  const sePuedeVer = (f: FilaDelMenu): boolean => {
    if (f.departamento !== null && f.departamento !== departamentoElegido) return false;
    if (f.tipo === "accion") return true;
    return (
      CATALOGO_DE_MODULOS[f.modulo].estado === "disponible" &&
      permisos.acciones.includes(f.accion) &&
      (permisos.modulos.activos.includes(f.modulo) ||
        permisos.modulos.enSoloLectura.includes(f.modulo))
    );
  };
  const visibles = filas.filter(sePuedeVer);
  const areas: AreaDelMenu[] = [];
  for (const area of AREAS_DEL_MENU) {
    const grupos: GrupoDelMenu[] = [];
    for (const grupo of GRUPOS_DEL_MENU) {
      const items = visibles
        .filter((f) => f.area === area.clave && f.grupo === grupo.clave)
        .map((f): ItemDelMenu => ({
          tipo: f.tipo,
          clave: f.clave,
          etiqueta: f.etiqueta,
          href: f.tipo === "pantalla" ? f.href : null,
        }));
      if (items.length > 0) grupos.push({ clave: grupo.clave, etiqueta: grupo.etiqueta, items });
    }
    if (grupos.length > 0) areas.push({ ...area, grupos });
  }
  return areas;
}

/**
 * Los problemas de una tabla (vacío = bien). Lo usa `test/arquitectura/menu-por-areas.test.ts` sobre la tabla real y sobre violaciones
 * inyectadas. Toda fila tiene área y grupo declarados, clave única, módulo y acción reales del catálogo (la acción es del módulo
 * declarado), ruta propia que empieza con `/` y no se repite, y solo Ventas puede llevar departamento. Un área o grupo declarado sin filas
 * es una reserva válida: no aparece (todo nace cerrado).
 */
export function problemasDelMenu(
  filas: readonly FilaDelMenu[],
  areas: readonly Readonly<{ clave: string; fija: boolean }>[],
  grupos: readonly Readonly<{ clave: string }>[],
  maximoDeAreas: number,
): readonly string[] {
  const problemas: string[] = [];
  const deLaBarra = areas.filter((a) => !a.fija);
  if (deLaBarra.length > maximoDeAreas)
    problemas.push(`hay ${deLaBarra.length} áreas en la barra y el tope es ${maximoDeAreas}`);
  if (areas.filter((a) => a.fija).length > 1) problemas.push("hay más de un área fija");
  const listas: readonly (readonly [string, readonly string[]])[] = [
    ["área", areas.map((a) => a.clave)],
    ["grupo", grupos.map((g) => g.clave)],
    ["fila", filas.map((f) => f.clave)],
  ];
  for (const [nombre, lista] of listas) {
    for (const clave of lista) {
      if (lista.indexOf(clave) !== lista.lastIndexOf(clave))
        problemas.push(`${nombre} repetido: ${clave}`);
    }
  }
  const rutas = new Set<string>();
  for (const f of filas) {
    if (!areas.some((a) => a.clave === f.area))
      problemas.push(`${f.clave}: el área ${f.area} no está declarada`);
    if (!grupos.some((g) => g.clave === f.grupo))
      problemas.push(`${f.clave}: el grupo ${f.grupo} no está declarado`);
    if (f.departamento !== null && f.area !== "ventas")
      problemas.push(`${f.clave}: solo Ventas puede llevar departamento`);
    if (f.tipo === "pantalla") {
      const acciones: Readonly<Record<string, unknown>> = Object.hasOwn(
        CATALOGO_DE_MODULOS,
        f.modulo,
      )
        ? CATALOGO_DE_MODULOS[f.modulo].acciones
        : {};
      if (!Object.hasOwn(acciones, f.accion))
        problemas.push(`${f.clave}: la acción ${f.accion} no es del módulo ${f.modulo}`);
      if (!f.href.startsWith("/")) problemas.push(`${f.clave}: la ruta tiene que empezar con /`);
      if (rutas.has(f.href)) problemas.push(`${f.clave}: la ruta ${f.href} está repetida`);
      rutas.add(f.href);
    }
  }
  return problemas;
}
