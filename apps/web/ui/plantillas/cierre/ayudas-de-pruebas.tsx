import type { ReactNode } from "react";
import { expect, vi } from "vitest";
import { page } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import type { CierreParaLaPantalla } from "../../../../../src/composicion/lectura-del-cierre";
import type { AccionesDelServidorDelCierre } from "./PantallaDelCierre.cliente";
import {
  armarElModeloDelCierre,
  esErrorDelModelo,
  type AccionesDelCierre,
  type ModeloDelCierre,
} from "./modelo-del-cierre";

/** Lo común de las pruebas de «Cierre del día» en el navegador: la pantalla dentro de una página mínima, un día de ejemplo, el modelo y las acciones del servidor simuladas. */

export const TODO_PERMITIDO: AccionesDelCierre = {
  empezar: true,
  cancelar: true,
  cerrar: true,
  corregirMedio: true,
  declarar: true,
};

export const NADA_PERMITIDO: AccionesDelCierre = {
  empezar: false,
  cancelar: false,
  cerrar: false,
  corregirMedio: false,
  declarar: false,
};

export const enPagina = (contenido: ReactNode): ReactNode => (
  <main>
    <h1>Cierre del día</h1>
    {contenido}
  </main>
);

export const ventana = (ancho: number): Promise<void> => page.viewport(ancho, 844);

/** Ningún texto por debajo de 16 px, ningún control por debajo de 48 px de alto y sin desborde lateral (decisiones del dueño D4 y D10). */
export function legibleYTocable(): void {
  const visible = (el: HTMLElement) =>
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const chicos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const tieneTexto = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (!tieneTexto || !visible(el)) continue;
    const tamano = Number.parseFloat(getComputedStyle(el).fontSize);
    if (tamano < 16) chicos.push(`${el.tagName.toLowerCase()} ${tamano}px: ${el.textContent}`);
  }
  expect(chicos).toEqual([]);
  const bajos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>(
    "button, a[href], select, input:not([type=hidden]), summary",
  )) {
    if (!visible(el)) continue;
    // El campo de importe es una fila con borde (el objetivo táctil de 48 px) que envuelve al `<input>` (44 px): se mide la fila.
    const alto = (
      el.getAttribute("inputmode") === "decimal" ? (el.parentElement ?? el) : el
    ).getBoundingClientRect().height;
    if (alto < 48) bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

const control = (cambios: Record<string, unknown> = {}) => ({
  modulo: "caja",
  clave: "caja.diferencia_de_arqueo",
  severidad: "RECONOCIBLE" as const,
  cantidad: 1,
  reconocido: false,
  reconocidoPor: null,
  reconocidoEn: null,
  texto: null,
  ...cambios,
});

/** Un día de ejemplo con lo que muestra cada paso: una caja sin cerrar (impide), dos controles por reconocer, dos que solo informan, dos cobros y tres líneas de conciliación. */
export const DIA: CierreParaLaPantalla = {
  fechaDeNegocio: "2026-11-09",
  estado: "EN_AUDITORIA",
  cerradaPor: null,
  cerradaEn: null,
  huella: "huella-del-servidor",
  controles: [
    control({
      modulo: "ventas",
      clave: "ventas.cuentas_abiertas",
      severidad: "BLOQUEA",
      cantidad: 2,
    }),
    control({ clave: "caja.diferencia_de_arqueo", cantidad: 1 }),
    control({ modulo: "ventas", clave: "ventas.cortesias", cantidad: 3 }),
    control({ modulo: "ventas", clave: "ventas.anulaciones", severidad: "INFORMA", cantidad: 5 }),
    control({ clave: "caja.cobros_corregidos", severidad: "INFORMA", cantidad: 1 }),
  ],
  conciliacion: {
    enVivo: true,
    lineas: [
      {
        medioDePagoId: "ef",
        cuentaDeCobroId: null,
        medioTipo: "EFECTIVO",
        medioNombre: null,
        cuentaNombre: null,
        registrado: "1250.00",
        correcciones: "0.00",
        declarado: "1300.00",
        estadoDeConteo: "CONTADO",
        diferencia: "50.00",
      },
      {
        medioDePagoId: "de",
        cuentaDeCobroId: "t1",
        medioTipo: "TARJETA_DEBITO",
        medioNombre: null,
        cuentaNombre: "Posnet 1",
        registrado: "7070.00",
        correcciones: "-18400.00",
        declarado: null,
        estadoDeConteo: "SIN_DATO",
        diferencia: null,
      },
      {
        medioDePagoId: "tr",
        cuentaDeCobroId: "b1",
        medioTipo: "TRANSFERENCIA",
        medioNombre: null,
        cuentaNombre: "Banco",
        registrado: "1800.00",
        correcciones: "0.00",
        declarado: "1800.00",
        estadoDeConteo: "DECLARADO",
        diferencia: "0.00",
      },
    ],
    cobradoContraTicket: [],
  },
  cobros: {
    hayMas: false,
    cobros: [
      {
        cobroId: "cobro-1",
        importe: "18400.00",
        medioDePagoId: "cr",
        cuentaDeCobroId: "t1",
        medioTipo: "TARJETA_CREDITO",
        medioNombre: null,
        cuentaNombre: "Posnet 1",
        registradoPor: "lucia@ejemplo.com",
        correccionPosible: true,
        ultimaCorreccion: null,
      },
      {
        cobroId: "cobro-2",
        importe: "2000.00",
        medioDePagoId: "ef",
        cuentaDeCobroId: null,
        medioTipo: "EFECTIVO",
        medioNombre: null,
        cuentaNombre: null,
        registradoPor: "tomas@ejemplo.com",
        correccionPosible: true,
        ultimaCorreccion: null,
      },
    ],
  },
  medios: [
    { medioDePagoId: "ef", tipo: "EFECTIVO", nombre: null, cuentas: [] },
    {
      medioDePagoId: "de",
      tipo: "TARJETA_DEBITO",
      nombre: null,
      cuentas: [{ cuentaDeCobroId: "t1", nombre: "Posnet 1" }],
    },
    {
      medioDePagoId: "cr",
      tipo: "TARJETA_CREDITO",
      nombre: null,
      cuentas: [{ cuentaDeCobroId: "t1", nombre: "Posnet 1" }],
    },
  ],
};

export const modeloDe = (
  cambios: Partial<CierreParaLaPantalla> = {},
  acciones: AccionesDelCierre = TODO_PERMITIDO,
): ModeloDelCierre => {
  const m = armarElModeloDelCierre({ ...DIA, ...cambios }, acciones);
  if (esErrorDelModelo(m)) throw new Error(`se esperaba el modelo y vino ${m.error}`);
  return m;
};

export const BIEN: Respuesta<unknown> = { ok: true, dato: {} };

/** Las seis acciones del servidor como espías; cada una responde bien salvo que la prueba diga otra cosa. */
export function servidorSimulado() {
  const nuevo = () =>
    vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() => Promise.resolve(BIEN));
  const acciones = {
    empezar: nuevo(),
    cancelar: nuevo(),
    cerrar: nuevo(),
    corregir: nuevo(),
    declarar: nuevo(),
    conforme: nuevo(),
  };
  return { acciones: acciones satisfies AccionesDelServidorDelCierre, ...acciones };
}

/** Una respuesta que se resuelve cuando la prueba quiere (para ver el estado «enviando» y el doble toque). */
export function puerta() {
  let soltar: (r: Respuesta<unknown>) => void = () => undefined;
  const espera = new Promise<Respuesta<unknown>>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}
