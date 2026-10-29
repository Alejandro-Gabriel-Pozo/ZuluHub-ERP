import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  direccionDelDetalle,
  direccionDelListado,
  type FiltrosDelListado,
} from "./filtros-del-listado";
import { formatearFecha, formatearImporte } from "./formato-fiscal";
import {
  anulacionDe,
  documentoDe,
  estadoDe,
  nombreDe,
  type EstadoArmado,
  type EstadoVisible,
  type TipoDeDocumentoVisible,
  type TipoVisible,
} from "./modelo-del-detalle";

/**
 * El modelo de vista del listado de comprobantes (contrato de la pantalla 1): de lo que entrega la consulta, TODO lo que se ve y
 * NADA más. Puro: sin React ni servidor. Es una lista blanca a propósito: el origen (D-33), el ambiente, la cantidad y el total
 * del resultado (D-32) y el número del punto de venta como dato aparte no están en el modelo, así que no pueden aparecer.
 * Previene: mostrar un dato que el dueño no aprobó. El formato (estados, nombre del comprobante, documento, importes y fechas) es
 * el del detalle: está en un solo lugar. Chequeo: `test/web/listado-modelo.test.ts` y `test/web/listado-contrato.test.ts`.
 */

/** Lo que el listado necesita de `ResumenDeComprobante`: un subconjunto estructural (la UI no importa los módulos). */
export type ResumenParaMostrar = Readonly<{
  id: string;
  tipo: TipoVisible;
  numero: string | null;
  fecha: string;
  receptorNombre: string | null;
  receptorDocumento:
    | Readonly<{ tipo: TipoDeDocumentoVisible; numero: string }>
    | Readonly<{ tipo: "SIN_IDENTIFICAR" }>;
  total: string;
  estado: EstadoVisible;
  acreditacion: "NINGUNA" | "PARCIAL" | "TOTAL" | null;
}>;

export type PaginaParaMostrar = Readonly<{
  items: readonly ResumenParaMostrar[];
  /** La clave de la página que sigue (`despues` en la dirección); `null` en la última. */
  siguiente: string | null;
}>;

export type FilaArmada = Readonly<{
  id: string;
  /** El enlace al detalle: tocar la fila lo abre. */
  href: string;
  /** «Factura B 00001-00001234»; sin número («Factura A») mientras no está autorizada. */
  comprobante: string;
  fecha: string;
  cliente: string;
  /** «CUIT 30-71234567-8»; «—» si el cliente no está identificado. */
  documento: string;
  total: string;
  estado: EstadoArmado;
  /** «Anulación parcial» o «Anulación total»; `null` si no hay. */
  anulacion: string | null;
}>;

export type ListadoArmado = Readonly<{
  filas: readonly FilaArmada[];
  /** El texto de «no hay comprobantes»; `null` si hay filas. */
  vacio: string | null;
  siguiente: Readonly<{ href: string; texto: string }> | null;
  columnas: Readonly<{
    fecha: string;
    comprobante: string;
    cliente: string;
    documento: string;
    total: string;
    estado: string;
  }>;
}>;

function filaDe(d: DiccionarioResuelto, r: ResumenParaMostrar): FilaArmada {
  return {
    id: r.id,
    href: direccionDelDetalle(r.id),
    comprobante: nombreDe(d, r.tipo, r.numero),
    fecha: formatearFecha(r.fecha),
    // PROTO-LISTADO: sin nombre, «Consumidor final».
    cliente: r.receptorNombre ?? texto(d, "fiscal.pantalla.consumidor_final"),
    documento:
      documentoDe(d, r.receptorDocumento) ?? texto(d, "fiscal.pantalla.listado_sin_documento"),
    total: formatearImporte(r.total),
    estado: estadoDe(d, r.estado),
    anulacion: anulacionDe(d, r.estado, r.acreditacion),
  };
}

export function armarElListado(
  pagina: PaginaParaMostrar,
  filtros: FiltrosDelListado,
  d: DiccionarioResuelto = {},
): ListadoArmado {
  return {
    filas: pagina.items.map((r) => filaDe(d, r)),
    vacio: pagina.items.length === 0 ? texto(d, "fiscal.pantalla.listado_vacio") : null,
    siguiente:
      pagina.siguiente === null
        ? null
        : {
            href: direccionDelListado(filtros, pagina.siguiente),
            texto: texto(d, "fiscal.pantalla.listado_pagina_siguiente"),
          },
    columnas: {
      fecha: texto(d, "fiscal.pantalla.rotulo_fecha"),
      comprobante: texto(d, "fiscal.pantalla.listado_rotulo_comprobante"),
      cliente: texto(d, "fiscal.pantalla.rotulo_cliente"),
      documento: texto(d, "fiscal.pantalla.listado_rotulo_documento"),
      total: texto(d, "fiscal.pantalla.rotulo_total"),
      estado: texto(d, "fiscal.pantalla.listado_rotulo_estado"),
    },
  };
}

export type SucursalParaMostrar = Readonly<{ id: string; nombre: string; activa: boolean }>;

/** La elección de sucursal con sus textos resueltos (un componente de cliente no arma textos). */
export type EleccionDeSucursalArmada = Readonly<{
  rotulo: string;
  aplicar: string;
  /** Lo que dice el botón mientras envía. */
  enviando: string;
  /** La opción en blanco mientras no hay una elegida (el texto que ya tiene el selector de sucursal del catálogo base). */
  elegir: string;
  /** La invitación a elegir; solo cuando todavía no hay una elegida (D-36). */
  invitacion: string | null;
  elegida: string;
  opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
}>;

/**
 * El selector de sucursal. Con una sola, que el servidor ya tomó, no hay nada que elegir (D-36: «si hay una sola, se elige
 * sola»): `null`. Una sola CERRADA no se toma sola (solo cuentan las abiertas): ahí sí se muestra, para elegirla. Una cerrada se
 * puede elegir y se marca como tal (D-37). `elegida` es la sucursal con la que está trabajando el listado (`""` si ninguna): la
 * invitación a elegir va solo en ese caso.
 */
export function armarLaEleccionDeSucursal(
  sucursales: readonly SucursalParaMostrar[],
  elegida: string,
  d: DiccionarioResuelto = {},
): EleccionDeSucursalArmada | null {
  if (sucursales.length === 0 || (sucursales.length === 1 && elegida !== "")) return null;
  return {
    rotulo: texto(d, "fiscal.pantalla.listado_rotulo_sucursal"),
    aplicar: texto(d, "fiscal.pantalla.listado_aplicar"),
    enviando: texto(d, "conexion.enviando"),
    elegir: texto(d, "sucursal.elegir"),
    invitacion: elegida === "" ? texto(d, "fiscal.pantalla.listado_elegir_sucursal") : null,
    elegida,
    opciones: sucursales.map((s) => ({
      valor: s.id,
      etiqueta: s.activa
        ? s.nombre
        : texto(d, "fiscal.pantalla.listado_sucursal_cerrada", { nombre: s.nombre }),
    })),
  };
}

/**
 * El error de la lista como lo ve la persona. Lo inesperado dice «No pudimos cargar la lista. Probá de nuevo.» (CONTRATO), con su
 * referencia `PD-…`; el resto (sin permiso, módulo en desarrollo, sesión vencida, filtros inválidos, sucursal fuera de alcance)
 * conserva su texto del catálogo. `NO_DISPONIBLE` también es inesperado pero tiene su texto propio («probá en unos minutos»).
 */
export const errorParaElListado = (error: ErrorPublico): ErrorPublico =>
  error.codigo === "ERROR_INTERNO" ? { ...error, clave: "fiscal.pantalla.listado_error" } : error;
