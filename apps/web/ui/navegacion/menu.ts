import { type ClavePerilla } from "../../../../src/capacidades/planes/perillas";
import {
  CATALOGO_DE_MODULOS,
  type ClaveAccion,
  type ClaveModulo,
} from "../../../../src/capacidades/modulos/catalogo";
import { seOfrece } from "../../../../src/capacidades/integracion/ofrecer";
import type { ClaveDeTexto } from "../../../../src/capacidades/vocabulario/catalogo";
import type { ClaveDeIcono } from "../iconos/catalogo";
import { RUTAS_DE_CAJA, RUTA_DE_LA_CAJA } from "../plantillas/caja/lista-de-caja";
import { RUTA_DE_PRODUCTOS } from "../plantillas/catalogo/filtros-de-productos";
import { RUTA_DE_CLASIFICACION } from "../plantillas/catalogo/modelo-de-clasificacion";
import { RUTA_DEL_CIERRE } from "../plantillas/cierre/ruta-del-cierre";
import { RUTA_DE_SECCIONES } from "../plantillas/catalogo/modelo-de-secciones";
import { RUTA_DE_IMPRESORAS } from "../plantillas/salon/modelo-de-impresoras";
import { RUTA_DE_MESAS } from "../plantillas/salon/modelo-de-mesas";
import { RUTAS_DE_CONFIGURACION } from "../plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { RUTA_DEL_LISTADO } from "../plantillas/facturacion/filtros-del-listado";
import { RUTA_DE_COMPRAS } from "../plantillas/compras/rutas-de-compras";
import { RUTA_DE_PRODUCCION } from "../plantillas/produccion/filtros-de-ordenes";
import { RUTAS_DE_CUENTA } from "../plantillas/sesion/rutas-de-cuenta";
import { RUTA_DE_LA_VENTA, RUTA_DE_TICKETS_DEL_DIA } from "../plantillas/venta/rutas-de-venta";
import { RUTAS_DE_STOCK } from "../plantillas/stock/rutas-de-stock";

/**
 * EL MENÚ POR ÁREAS: una sola tabla declarativa (área → grupo → pantalla), una fila por pantalla. Es la ÚNICA fuente de qué hay en el menú, en qué área y grupo, qué módulo y
 * qué acción exige: mover una pantalla de grupo o de área es cambiar UNA fila, y sumar un rubro es sumar un área y sus filas (dueño, 12/11/2026: «siempre tiene que estar
 * presente la escalabilidad o el posible cambio de rumbo al tema de la organización de la pantalla», `decisiones-del-dueno-2026-11.md`, fila «Menú por áreas, versión 4»).
 * Estructura «B: por módulo» (12/11/2026): Ventas, Catálogo, Compras y Cuenta; maqueta `10-ux-ui/prototipos-gastronomia/menu-por-areas.html` (versión 5).
 *
 * Solo entra una fila con RUTA real y texto aprobado: una pantalla sin construir no se declara (una fila sin ruta daría un 404 a quien tenga el permiso) y un rótulo sin
 * aprobar no se inventa. Las pantallas de la maqueta que todavía no existen se suman con su fila cuando existan. Previene: componentes que fijan áreas o grupos a mano
 * (`test/arquitectura/menu-por-areas.test.ts`).
 */

/** Las áreas, en el orden en que se ofrecen. `Cuenta` es fija: no ocupa lugar entre las áreas de la barra. */
export const AREAS_DEL_MENU = [
  // Los nombres de las áreas los aprobó el dueño «por ahora» el 12/11/2026 (`decisiones-del-dueno-2026-11.md`, fila «Menú por áreas, versión 4»). Íconos: SUPUESTO (DEC-0359), se reutilizan los que ya existen (la maqueta deja los íconos por definir); revertirlo es cambiar una fila.
  { clave: "ventas", etiqueta: "navegacion.area.ventas", icono: "comprobantes", fija: false },
  { clave: "catalogo", etiqueta: "navegacion.area.catalogo", icono: "secciones", fija: false },
  // Compras: «Compras» como área lo aprobó el dueño (DDD fila 110) y se reusa su texto, `compras.compra.compras` (`pantallas-de-compras-inventario.md` §5). Ícono: SUPUESTO (DEC-0359), el de «empresa», que ya existe; revertirlo es cambiar esta fila. Es el tercer y último lugar de la barra (`MAXIMO_DE_DESTINOS_DE_MODULOS`).
  { clave: "compras", etiqueta: "compras.compra.compras", icono: "empresa", fija: false },
  { clave: "cuenta", etiqueta: "navegacion.cuenta", icono: "cuenta", fija: true },
] as const satisfies readonly Readonly<{
  clave: string;
  etiqueta: ClaveDeTexto;
  icono: ClaveDeIcono;
  fija: boolean;
}>[];
export type ClaveDeArea = (typeof AREAS_DEL_MENU)[number]["clave"];

/** Los grupos. Un grupo con `etiqueta: null` se muestra sin encabezado (maqueta v5: una sola pantalla que se llama igual se muestra como una fila). */
export const GRUPOS_DEL_MENU = [
  { clave: "mostrador", etiqueta: "navegacion.grupo.mostrador" },
  { clave: "comprobantes", etiqueta: null },
  { clave: "caja", etiqueta: null },
  { clave: "productos", etiqueta: null },
  { clave: "salon", etiqueta: "salon.texto.grupo_salon" },
  // Una reserva por pantalla de Clientes y proveedores y de Compras: sin filas no aparecen (todo nace cerrado); cada pantalla suma su fila.
  { clave: "clientes", etiqueta: null },
  { clave: "proveedores", etiqueta: null },
  { clave: "compras", etiqueta: null },
  { clave: "carta", etiqueta: "navegacion.grupo.carta" },
  { clave: "stock", etiqueta: null },
  { clave: "produccion", etiqueta: null },
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
    clave: string;
    modulo: ClaveModulo;
    accion: ClaveAccion;
    /** La función de pago (perilla) que tiene que estar encendida para ofrecerla; `null` = ninguna. Tiene que ser del mismo módulo de la fila. */
    perilla: ClavePerilla | null;
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

/**
 * LA TABLA. El orden de las filas es el orden de aparición. «Medios de pago» nace declarado y cerrado: su módulo (`caja`) está «en desarrollo» y no da permisos a nadie. Su
 * rótulo es el título aprobado de la pantalla, «Medios de pago» (`caja.medios.titulo`); la maqueta dice «Medios de pago y cajas», que no tiene clave: va a preguntas
 * pendientes.
 */
export const FILAS_DEL_MENU = [
  {
    tipo: "pantalla",
    clave: "venta-rapida",
    area: "ventas",
    grupo: "mostrador",
    modulo: "ventas",
    accion: "ventas.ver",
    perilla: null,
    href: RUTA_DE_LA_VENTA,
    etiqueta: "ventas.venta.menu",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "tickets-del-dia",
    area: "ventas",
    grupo: "mostrador",
    modulo: "ventas",
    accion: "ventas.ver",
    perilla: null,
    href: RUTA_DE_TICKETS_DEL_DIA,
    etiqueta: "ventas.tickets.menu",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "comprobantes",
    area: "ventas",
    grupo: "comprobantes",
    modulo: "facturacion",
    accion: "comprobantes.ver",
    perilla: null,
    href: RUTA_DEL_LISTADO,
    etiqueta: "fiscal.pantalla.listado_titulo",
    departamento: null,
  },
  // «Caja» (maqueta `menu-por-areas.html`: grupo «Caja» con «Caja» y «Cierre del día»). El grupo se muestra sin encabezado (`etiqueta: null`). Nace cerrada: cada fila se ofrece solo a quien tiene la acción de su módulo.
  {
    tipo: "pantalla",
    clave: "caja",
    area: "ventas",
    grupo: "caja",
    modulo: "caja",
    accion: "cajas.ver",
    perilla: null,
    href: RUTA_DE_LA_CAJA,
    etiqueta: "caja.pantalla.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "cierre-del-dia",
    area: "ventas",
    grupo: "caja",
    modulo: "cierre",
    accion: "jornadas.ver",
    perilla: null,
    href: RUTA_DEL_CIERRE,
    etiqueta: "cierre.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "productos",
    area: "catalogo",
    grupo: "productos",
    modulo: "catalogo",
    accion: "productos.ver",
    perilla: null,
    href: RUTA_DE_PRODUCTOS,
    etiqueta: "catalogo.lista.titulo",
    departamento: null,
  }, // Clasificación comercial (A14): solo gerente y administrador (`productos.editar`; maqueta `clasificacion.html`: el operador no ve la entrada). Su rótulo es el título aprobado «Clasificación comercial».
  {
    tipo: "pantalla",
    clave: "clasificacion",
    area: "catalogo",
    grupo: "productos",
    modulo: "catalogo",
    accion: "productos.editar",
    perilla: null,
    href: RUTA_DE_CLASIFICACION,
    etiqueta: "catalogo.clasificacion.titulo",
    departamento: null,
  },

  // «Secciones» (A8; dueño, 13/11/2026, `decisiones-del-dueno-2026-11.md` línea 110): en Catálogo, grupo «Carta». Módulo `catalogo` y acción `productos.ver`, las de su consulta (S7 de la ficha: la celda de la maqueta del menú dice `vidriera` y `vidrieras.ver`, pero el servidor resuelve estas).
  {
    tipo: "pantalla",
    clave: "secciones",
    area: "catalogo",
    grupo: "carta",
    modulo: "catalogo",
    accion: "productos.ver",
    perilla: null,
    href: RUTA_DE_SECCIONES,
    etiqueta: "catalogo.seccion.titulo",
    departamento: null,
  },
  // «Mesas» (S-1; `menu-por-areas.html`: «Mesas», pantalla dentro del grupo Salón del área Ventas): módulo `salon` (hoy en desarrollo: la entrada no se muestra) y acción `mesas.ver`.
  {
    tipo: "pantalla",
    clave: "mesas",
    area: "ventas",
    grupo: "salon",
    modulo: "salon",
    accion: "mesas.ver",
    perilla: "salon",
    href: RUTA_DE_MESAS,
    etiqueta: "salon.texto.admin_mesas",
    departamento: null,
  },
  // «Impresoras» (S-2; `menu-por-areas.html`, grupo Salón del área Ventas): módulo `comandas` (disponible desde S-0r) y acción `impresoras.ver`.
  {
    tipo: "pantalla",
    clave: "impresoras",
    area: "ventas",
    grupo: "salon",
    modulo: "comandas",
    accion: "impresoras.ver",
    perilla: null,
    href: RUTA_DE_IMPRESORAS,
    etiqueta: "comandas.texto.imprimir_impresoras",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "stock",
    area: "catalogo",
    grupo: "stock",
    modulo: "stock",
    accion: "stock.ver",
    perilla: null,
    href: RUTAS_DE_STOCK.entrada,
    etiqueta: "stock.pantalla.stock",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "produccion",
    area: "catalogo",
    grupo: "produccion",
    modulo: "produccion",
    accion: "transformaciones.ver",
    perilla: null,
    href: RUTA_DE_PRODUCCION,
    etiqueta: "produccion.pantalla.produccion",
    departamento: null,
  },
  // «Compras» (Compras PR 3): la lista de compras de la sucursal, solo lectura. Módulo `compras` y la acción de su consulta (`recepciones.ver`, los tres roles); nace cerrada: sin la acción no se ofrece.
  {
    tipo: "pantalla",
    clave: "compras",
    area: "compras",
    grupo: "compras",
    modulo: "compras",
    accion: "recepciones.ver",
    perilla: null,
    href: RUTA_DE_COMPRAS,
    etiqueta: "compras.compra.compras",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "configuracion-fiscal",
    area: "cuenta",
    grupo: "empresa",
    modulo: "administracion",
    accion: "datos_fiscales.editar",
    perilla: null,
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
    perilla: null,
    href: RUTAS_DE_CAJA.medios,
    etiqueta: "caja.medios.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "usuarios",
    area: "cuenta",
    grupo: "empresa",
    modulo: "administracion",
    accion: "usuarios.ver",
    perilla: null,
    href: RUTAS_DE_CUENTA.usuarios,
    etiqueta: "usuarios.lista.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "contacto",
    area: "cuenta",
    grupo: "sucursal",
    modulo: "administracion",
    accion: "sucursales.editar",
    perilla: null,
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
] as const satisfies readonly FilaDelMenu[];

/** Las claves de las filas de la tabla: salen de ella (sumar una pantalla es una sola edición, la fila). */
export type ClaveDeFila = (typeof FILAS_DEL_MENU)[number]["clave"];

/** Lo que el menú necesita saber de los permisos de la persona (lo calcula el servidor: `permisosDelActor`). */
export type PermisosParaElMenu = Readonly<{
  acciones: readonly string[];
  modulos: Readonly<{ activos: readonly string[]; enSoloLectura: readonly string[] }>;
  /** Las funciones de pago encendidas; sin definir = no se leyeron (lo que pide función no se ofrece). */
  funcionesEncendidas?: readonly string[];
}>;

export type ItemDelMenu<C extends string = ClaveDeFila> = Readonly<{
  tipo: FilaDelMenu["tipo"];
  clave: C;
  etiqueta: ClaveDeTexto;
  /** La ruta de la pantalla; `null` en una acción. */
  href: string | null;
}>;
type GrupoDelMenu<C extends string = ClaveDeFila> = Readonly<{
  clave: ClaveDeGrupo;
  etiqueta: ClaveDeTexto | null;
  items: readonly ItemDelMenu<C>[];
}>;
export type AreaDelMenu<C extends string = ClaveDeFila> = Readonly<{
  clave: ClaveDeArea;
  etiqueta: ClaveDeTexto;
  icono: ClaveDeIcono;
  fija: boolean;
  grupos: readonly GrupoDelMenu<C>[];
}>;

/**
 * Todo nace cerrado: una pantalla se muestra solo si su módulo está `disponible` en el catálogo (uno «en desarrollo» no da permisos a nadie), la empresa lo tiene activo o en
 * solo lectura y la persona tiene la acción según `permisosDelActor`. SUPUESTO (DEC-0059): en solo lectura SÍ se muestra (las pantallas del menú solo consultan; el guard
 * rechaza lo que escribe). Sin permisos leídos (`null`) no se muestra nada. Las acciones («Cerrar sesión») aparecen siempre que se leyeron los permisos. Con un departamento
 * declarado en la fila, la fila se muestra solo si ese es el elegido; sin departamento elegido no se asume «todos». Un grupo aparece solo si le queda un ítem y un área solo
 * si le queda un grupo. Ocultar no es autorizar: cada pantalla vuelve a pasar por el guard.
 */
export function armarElMenu<F extends FilaDelMenu>(
  filas: readonly F[],
  permisos: PermisosParaElMenu | null,
  departamentoElegido: string | null,
): readonly AreaDelMenu<F["clave"]>[] {
  if (permisos === null) return [];
  const sePuedeVer = (f: F): boolean => {
    if (f.departamento !== null && f.departamento !== departamentoElegido) return false;
    if (f.tipo === "accion") return true;
    const { modulo, accion, perilla } = f;
    return seOfrece(CATALOGO_DE_MODULOS, permisos, { modulo, accion, perilla });
  };
  const visibles = filas.filter(sePuedeVer);
  const areas: AreaDelMenu<F["clave"]>[] = [];
  for (const area of AREAS_DEL_MENU) {
    const grupos: GrupoDelMenu<F["clave"]>[] = [];
    for (const grupo of GRUPOS_DEL_MENU) {
      const items = visibles
        .filter((f) => f.area === area.clave && f.grupo === grupo.clave)
        .map((f): ItemDelMenu<F["clave"]> => ({
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
