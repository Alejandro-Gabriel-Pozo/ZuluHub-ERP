import { vi } from "vitest";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import type { AccionesDelServidorDeCaja } from "./BloqueDeCaja.cliente";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import type { CajaDeLaPantalla } from "./modelo-de-la-caja";

/** Lo que comparten las pruebas de la pantalla «Caja» del mostrador en Chromium: datos de ejemplo y las acciones del servidor simuladas. Este archivo no es una prueba. */
const ARS = (monto: string) => ({ moneda: "ARS", monto });

export const PERMISOS_TODOS: AccionesDeLaPantallaDeCaja = { abrir: true };
export const PERMISOS_NINGUNO: AccionesDeLaPantallaDeCaja = { abrir: false };

const BIEN: Respuesta<unknown> = { ok: true, dato: {} };
export const GENERICO: Respuesta<unknown> = {
  ok: false,
  error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA"),
};

const linea = (tipo: "EFECTIVO" | "TARJETA_DEBITO", esperado: string) => ({
  medioTipo: tipo,
  esperado: ARS(esperado),
});

export const CAJA_ABIERTA: CajaDeLaPantalla = {
  cajaId: "caja-1",
  nombre: "Caja 1",
  estado: "ABIERTA",
  sesion: {
    fechaDeNegocio: "2026-11-09",
    horaDeCorte: "06:00",
    lineas: [linea("EFECTIVO", "50900.00"), linea("TARJETA_DEBITO", "52300.00")],
  },
};

export const CAJA_CERRADA: CajaDeLaPantalla = {
  cajaId: "caja-1",
  nombre: "Caja 1",
  estado: "SIN_SESION",
  sesion: null,
};

/** La acción del servidor, simulada: responde bien salvo que la prueba cambie la respuesta. */
export function accionesDelServidor() {
  const mocks = {
    abrir: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() => Promise.resolve(BIEN)),
  };
  const acciones: AccionesDelServidorDeCaja = mocks;
  return { acciones, mocks };
}
