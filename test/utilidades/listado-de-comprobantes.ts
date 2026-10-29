import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type FiltrosArmados,
  armarLosFiltros,
  FILTROS_POR_DEFECTO,
  type FiltrosDelListado,
} from "../../apps/web/ui/plantillas/facturacion/filtros-del-listado";
import {
  type EleccionDeSucursalArmada,
  type ListadoArmado,
  armarElListado,
  armarLaEleccionDeSucursal,
  type PaginaParaMostrar,
  type ResumenParaMostrar,
} from "../../apps/web/ui/plantillas/facturacion/modelo-del-listado";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/** Apoyo de las pruebas del listado de comprobantes: filas de ejemplo y cómo se pinta. No es una prueba. */

/**
 * Las props de la pantalla, escritas acá y no importadas de ella: un `import type` también carga el archivo, y el `tsc` de la raíz (sin
 * DOM) no puede seguirlo hasta `Campo` y `Selector`. El componente real las comprueba en `apps/web` (su prueba de Chromium).
 */
export type PropsDePantallaDeListadoDeComprobantes = Readonly<{
  eleccionDeSucursal: EleccionDeSucursalArmada | null;
  accionDeSucursal: (previo: never, datos: never) => Promise<{ error: null }>;
  filtros: FiltrosArmados | null;
  listado: ListadoArmado | null;
  error?: ReactNode;
}>;

export const ID_1 = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const ID_2 = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";

export const fila = (cambios: Partial<ResumenParaMostrar> = {}): ResumenParaMostrar => ({
  id: ID_1,
  tipo: "FACTURA_B",
  numero: "00001-00001234",
  fecha: "2026-10-14",
  receptorNombre: null,
  receptorDocumento: { tipo: "SIN_IDENTIFICAR" },
  total: "9000.00",
  estado: "AUTORIZADO",
  acreditacion: "NINGUNA",
  ...cambios,
});

export const conNombre = (nombre: string): Partial<ResumenParaMostrar> => ({
  receptorNombre: nombre,
  receptorDocumento: { tipo: "CUIT", numero: "30712345678" },
});

export const PAGINA: PaginaParaMostrar = {
  items: [
    fila(),
    fila({
      id: ID_2,
      tipo: "FACTURA_A",
      numero: null,
      fecha: "2026-10-13",
      estado: "EN_VALIDACION",
      total: "121000.00",
      acreditacion: null,
      ...conNombre("Distribuidora Sur SA"),
    }),
    fila({
      id: "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d",
      estado: "AUTORIZADO",
      acreditacion: "PARCIAL",
      receptorNombre: "Juan Pérez",
      receptorDocumento: { tipo: "DNI", numero: "27345678" },
    }),
  ],
  siguiente: "2026-10-12T10:00:00.000000Z|2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d",
};

export const SUCURSALES = [
  { id: "s-centro", nombre: "Centro", activa: true },
  { id: "s-norte", nombre: "Norte", activa: false },
] as const;

const accionFalsa: PropsDePantallaDeListadoDeComprobantes["accionDeSucursal"] = () =>
  Promise.resolve({ error: null });

export function propsDe(
  datos: Readonly<{
    pagina?: PaginaParaMostrar;
    filtros?: FiltrosDelListado;
    puntosDeVenta?: readonly number[];
    elegida?: string;
  }> = {},
  sobre: Partial<PropsDePantallaDeListadoDeComprobantes> = {},
): PropsDePantallaDeListadoDeComprobantes {
  const filtros = datos.filtros ?? FILTROS_POR_DEFECTO;
  return {
    eleccionDeSucursal: armarLaEleccionDeSucursal(SUCURSALES, datos.elegida ?? "s-centro"),
    accionDeSucursal: accionFalsa,
    filtros: armarLosFiltros(filtros, datos.puntosDeVenta ?? [1, 2]),
    listado: armarElListado(datos.pagina ?? PAGINA, filtros),
    ...sobre,
  };
}

/**
 * Con la ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la pantalla hasta los campos de cliente (`Campo`, `Selector`), que
 * usan tipos del DOM.
 */
const RUTA_DE_LA_PANTALLA =
  "../../apps/web/ui/plantillas/facturacion/PantallaDeListadoDeComprobantes";

export async function pintar(props: PropsDePantallaDeListadoDeComprobantes): Promise<string> {
  const { PantallaDeListadoDeComprobantes } = (await import(
    /* @vite-ignore */ RUTA_DE_LA_PANTALLA
  )) as {
    PantallaDeListadoDeComprobantes: (p: PropsDePantallaDeListadoDeComprobantes) => ReactNode;
  };
  return renderToStaticMarkup(createElement(PantallaDeListadoDeComprobantes, props));
}

/** El texto visible: sin marcas ni entidades, ni lo oculto con `display:none` por CSS (que acá no se aplica). */
export const visible = (marcado: string): string =>
  marcado
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
