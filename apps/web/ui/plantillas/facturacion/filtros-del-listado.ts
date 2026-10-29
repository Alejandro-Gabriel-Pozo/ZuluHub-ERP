import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearPuntoDeVenta } from "./formato-fiscal";

/**
 * Los filtros del listado de comprobantes (contrato de la pantalla 1) y cómo viajan por la dirección: un formulario GET, así
 * que anda sin JavaScript y la dirección se puede compartir o recargar. Puro y solo con cadenas (sin `Date` ni `Number`: la
 * traducción del período a fechas necesita el reloj y vive en `apps/web/pantallas/entrada-del-listado.ts`).
 *
 * Previene: que una dirección armada a mano (un estado inventado, un punto de venta con letras) llegue a la consulta o rompa la
 * pantalla: lo que no es de la lista cerrada vuelve al valor por defecto. Chequeo: `test/web/listado-filtros.test.ts`.
 */

/** Adónde apunta el módulo: el listado. Lo usan la barra inferior, el formulario y la elección de sucursal. */
export const RUTA_DEL_LISTADO = "/facturacion/comprobantes";

/** El enlace al detalle de un comprobante (su id es un uuid que sale de la consulta, nunca de un texto libre). */
export const direccionDelDetalle = (id: string): string => `${RUTA_DEL_LISTADO}/${id}`;

const PERIODOS = ["hoy", "7dias", "mes", "todo", "personalizado"] as const;
type Periodo = (typeof PERIODOS)[number];

/**
 * Los siete estados que ofrece el filtro, con el nombre que usa la consulta (que acepta los siete). Fuente: D-52 de
 * `facturador-contratos-de-pantalla.md`, confirmada por el dueño el 2026-10-29: el filtro ofrece «Todos» y los siete estados.
 */
export const ESTADOS_DEL_FILTRO = [
  "AUTORIZADO",
  "EN_VALIDACION",
  "INCIERTO",
  "RECHAZADO",
  "PENDIENTE",
  "CONFLICTO",
  "DESCARTADO",
] as const;
type EstadoDelFiltro = (typeof ESTADOS_DEL_FILTRO)[number];

const LETRAS_DEL_FILTRO = ["A", "B", "C"] as const;
type LetraDelFiltro = (typeof LETRAS_DEL_FILTRO)[number];

/** Vacío es «sin filtrar» (CONTRATO: Todos / Todas / No filtra). */
export type FiltrosDelListado = Readonly<{
  periodo: Periodo;
  estado: EstadoDelFiltro | "";
  letra: LetraDelFiltro | "";
  /** El número del punto de venta, en dígitos. */
  puntoDeVenta: string;
  texto: string;
  /** Solo con el período «Personalizado»: `AAAA-MM-DD`. */
  desde: string;
  hasta: string;
}>;

/** CONTRATO: el período siempre tiene valor y por defecto es «Este mes». */
export const FILTROS_POR_DEFECTO: FiltrosDelListado = {
  periodo: "mes",
  estado: "",
  letra: "",
  puntoDeVenta: "",
  texto: "",
  desde: "",
  hasta: "",
};

type ParametrosDeLaDireccion = Readonly<Record<string, string | readonly string[] | undefined>>;

const primero = (params: ParametrosDeLaDireccion, nombre: string): string => {
  const valor = params[nombre];
  return (
    (Array.isArray(valor) ? (valor[0] as string | undefined) : (valor as string | undefined)) ?? ""
  );
};

const deLaLista = <T extends string>(valor: string, lista: readonly T[]): T | "" =>
  lista.find((permitido) => permitido === valor) ?? "";

const FECHA_CIVIL = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const NUMERO_DE_PUNTO_DE_VENTA = /^[0-9]{1,5}$/;

/** Los filtros de la dirección, con lo inválido vuelto al valor por defecto. */
export function leerLosFiltros(params: ParametrosDeLaDireccion): FiltrosDelListado {
  const periodo = deLaLista(primero(params, "periodo"), PERIODOS) || FILTROS_POR_DEFECTO.periodo;
  const personalizado = periodo === "personalizado";
  const desde = primero(params, "desde");
  const hasta = primero(params, "hasta");
  const puntoDeVenta = primero(params, "puntoDeVenta");
  return {
    periodo,
    estado: deLaLista(primero(params, "estado"), ESTADOS_DEL_FILTRO),
    letra: deLaLista(primero(params, "letra"), LETRAS_DEL_FILTRO),
    puntoDeVenta: NUMERO_DE_PUNTO_DE_VENTA.test(puntoDeVenta) ? puntoDeVenta : "",
    texto: primero(params, "texto").trim(),
    // Las fechas solo cuentan con el período «Personalizado»: con otro, quedarían colgadas en la dirección.
    desde: personalizado && FECHA_CIVIL.test(desde) ? desde : "",
    hasta: personalizado && FECHA_CIVIL.test(hasta) ? hasta : "",
  };
}

/**
 * Los filtros sin un punto de venta que no es de la sucursal elegida (una dirección vieja o armada a mano): se ve «Todos» y la
 * consulta tampoco lo filtra, así lo que se ve y lo que se pidió coinciden.
 */
export function conPuntoDeVentaDe(
  filtros: FiltrosDelListado,
  numeros: readonly number[],
): FiltrosDelListado {
  return numeros.some((numero) => String(numero) === filtros.puntoDeVenta)
    ? filtros
    : { ...filtros, puntoDeVenta: "" };
}

/** La clave de la página que sigue, tal como la dio la consulta; `null` en la primera página. */
export function leerLaPagina(params: ParametrosDeLaDireccion): string | null {
  const valor = primero(params, "despues");
  return valor === "" ? null : valor;
}

/** Cuántos filtros del panel se apartan del valor por defecto: lo que dice «Filtros (n)». La búsqueda queda afuera: no es un filtro del panel «Filtros (n)». */
export function cantidadDeFiltrosActivos(filtros: FiltrosDelListado): number {
  return [
    filtros.periodo !== FILTROS_POR_DEFECTO.periodo,
    filtros.estado !== "",
    filtros.letra !== "",
    filtros.puntoDeVenta !== "",
  ].filter(Boolean).length;
}

/** La dirección del listado con estos filtros (solo los que se apartan del valor por defecto) y, si sigue, la página. */
export function direccionDelListado(filtros: FiltrosDelListado, despues: string | null): string {
  const pares: [string, string][] = [];
  if (filtros.periodo !== FILTROS_POR_DEFECTO.periodo) pares.push(["periodo", filtros.periodo]);
  if (filtros.estado !== "") pares.push(["estado", filtros.estado]);
  if (filtros.letra !== "") pares.push(["letra", filtros.letra]);
  if (filtros.puntoDeVenta !== "") pares.push(["puntoDeVenta", filtros.puntoDeVenta]);
  if (filtros.texto !== "") pares.push(["texto", filtros.texto]);
  if (filtros.desde !== "") pares.push(["desde", filtros.desde]);
  if (filtros.hasta !== "") pares.push(["hasta", filtros.hasta]);
  if (despues !== null) pares.push(["despues", despues]);
  return pares.length === 0
    ? RUTA_DEL_LISTADO
    : `${RUTA_DEL_LISTADO}?${new URLSearchParams(pares).toString()}`;
}

type OpcionDeLista = Readonly<{ valor: string; etiqueta: string }>;

/** Lo que el formulario de filtros necesita, con todos los textos ya resueltos (un componente de cliente no arma textos). */
export type FiltrosArmados = Readonly<{
  accion: string;
  valores: FiltrosDelListado;
  activos: number;
  textos: Readonly<{
    filtros: string;
    periodo: string;
    desde: string;
    hasta: string;
    estado: string;
    letra: string;
    puntoDeVenta: string;
    buscar: string;
    aplicar: string;
    limpiar: string;
    todos: string;
    todas: string;
  }>;
  periodos: readonly OpcionDeLista[];
  estados: readonly OpcionDeLista[];
  letras: readonly OpcionDeLista[];
  puntosDeVenta: readonly OpcionDeLista[];
  /** Adónde lleva «Limpiar»: el listado sin filtros. */
  direccionDeLimpiar: string;
}>;

const CLAVE_DE_PERIODO = {
  hoy: "fiscal.pantalla.listado_periodo_hoy",
  "7dias": "fiscal.pantalla.listado_periodo_ultimos_7_dias",
  mes: "fiscal.pantalla.listado_periodo_este_mes",
  todo: "fiscal.pantalla.listado_periodo_todo",
  personalizado: "fiscal.pantalla.listado_periodo_personalizado",
} as const satisfies Record<Periodo, Parameters<typeof texto>[1]>;

const CLAVE_DE_ESTADO_DEL_FILTRO = {
  AUTORIZADO: "fiscal.pantalla.estado_autorizado",
  EN_VALIDACION: "fiscal.pantalla.estado_en_validacion",
  INCIERTO: "fiscal.pantalla.estado_incierto",
  RECHAZADO: "fiscal.pantalla.estado_rechazado",
  PENDIENTE: "fiscal.pantalla.estado_pendiente",
  CONFLICTO: "fiscal.pantalla.estado_conflicto",
  DESCARTADO: "fiscal.pantalla.estado_descartado",
} as const satisfies Record<EstadoDelFiltro, Parameters<typeof texto>[1]>;

export function armarLosFiltros(
  filtros: FiltrosDelListado,
  puntosDeVenta: readonly number[],
  d: DiccionarioResuelto = {},
): FiltrosArmados {
  return {
    accion: RUTA_DEL_LISTADO,
    valores: filtros,
    activos: cantidadDeFiltrosActivos(filtros),
    textos: {
      filtros: texto(d, "fiscal.pantalla.listado_filtros", {
        cantidad: String(cantidadDeFiltrosActivos(filtros)),
      }),
      periodo: texto(d, "fiscal.pantalla.listado_rotulo_periodo"),
      desde: texto(d, "fiscal.pantalla.listado_rotulo_desde"),
      hasta: texto(d, "fiscal.pantalla.listado_rotulo_hasta"),
      estado: texto(d, "fiscal.pantalla.listado_rotulo_estado"),
      letra: texto(d, "fiscal.pantalla.listado_rotulo_letra"),
      puntoDeVenta: texto(d, "fiscal.pantalla.rotulo_punto_de_venta"),
      buscar: texto(d, "fiscal.pantalla.listado_rotulo_buscar"),
      aplicar: texto(d, "fiscal.pantalla.listado_aplicar"),
      limpiar: texto(d, "fiscal.pantalla.listado_limpiar"),
      todos: texto(d, "fiscal.pantalla.listado_todos"),
      todas: texto(d, "fiscal.pantalla.listado_todas"),
    },
    periodos: PERIODOS.map((p) => ({ valor: p, etiqueta: texto(d, CLAVE_DE_PERIODO[p]) })),
    estados: ESTADOS_DEL_FILTRO.map((e) => ({
      valor: e,
      etiqueta: texto(d, CLAVE_DE_ESTADO_DEL_FILTRO[e]),
    })),
    // Letra (CONTRATO-LISTADO: «Letra (Todas, A, B, C)»). PROPUESTA sin fuente verificable, pendiente del dueño: que cada opción se
    // vea «Factura A», «Factura B», «Factura C» (el contrato dice solo A, B, C).
    letras: LETRAS_DEL_FILTRO.map((letra) => ({
      valor: letra,
      etiqueta: texto(d, "fiscal.pantalla.comprobante_sin_numero", {
        tipo: texto(d, "fiscal.pantalla.tipo_factura"),
        letra,
      }),
    })),
    puntosDeVenta: puntosDeVenta.map((numero) => ({
      valor: String(numero),
      etiqueta: formatearPuntoDeVenta(numero),
    })),
    direccionDeLimpiar: RUTA_DEL_LISTADO,
  };
}
