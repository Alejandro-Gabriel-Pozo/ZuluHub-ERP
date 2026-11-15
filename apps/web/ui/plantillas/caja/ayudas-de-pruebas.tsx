import { vi } from "vitest";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import type { AccionesDelServidorDeCaja } from "./BloqueDeCaja.cliente";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import type { CajaDeLaPantalla } from "./modelo-de-la-caja";
import type { ConteoDeLaCaja } from "./modelo-de-conteo-de-caja";

/** Lo que comparten las pruebas de la pantalla «Caja» del mostrador en Chromium: datos de ejemplo y las acciones del servidor simuladas. Este archivo no es una prueba. */
const ARS = (monto: string) => ({ moneda: "ARS", monto });

export const PERMISOS_TODOS: AccionesDeLaPantallaDeCaja = {
  abrir: true,
  iniciarCierre: true,
  cancelarCierre: true,
  cerrar: true,
  registrarMovimiento: true,
  ajustar: true,
  anular: true,
  anularDeOtros: true,
};
export const PERMISOS_NINGUNO: AccionesDeLaPantallaDeCaja = {
  abrir: false,
  iniciarCierre: false,
  cancelarCierre: false,
  cerrar: false,
  registrarMovimiento: false,
  ajustar: false,
  anular: false,
  anularDeOtros: false,
};

export const BIEN: Respuesta<unknown> = { ok: true, dato: {} };
export const GENERICO: Respuesta<unknown> = {
  ok: false,
  error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA"),
};
export const INESPERADO: Respuesta<unknown> = {
  ok: false,
  error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" },
};

const linea = (tipo: "EFECTIVO" | "TARJETA_DEBITO" | "TRANSFERENCIA" | "QR", esperado: string) => {
  const base = {
    EFECTIVO: { medioDePagoId: "m-ef", cuentaDeCobroId: null, cuentaNombre: null },
    TARJETA_DEBITO: { medioDePagoId: "m-de", cuentaDeCobroId: "c-1", cuentaNombre: "Posnet 1" },
    TRANSFERENCIA: {
      medioDePagoId: "m-tr",
      cuentaDeCobroId: "c-2",
      cuentaNombre: "Cuenta bancaria principal",
    },
    QR: { medioDePagoId: "m-qr", cuentaDeCobroId: null, cuentaNombre: null },
  }[tipo];
  return { ...base, medioTipo: tipo, medioNombre: null, esperado: ARS(esperado) };
};

const movimiento = (
  id: string,
  clase: string,
  importe: string,
  cambios: Partial<{
    medioTipo: string;
    cuentaNombre: string | null;
    motivo: string | null;
    anuladoPor: string | null;
    anulablePorElActor: boolean;
  }> = {},
) => ({
  id,
  clase,
  medioTipo: "EFECTIVO",
  medioNombre: null,
  cuentaNombre: null,
  importe: ARS(importe),
  motivo: null,
  anuladoPor: null,
  anulablePorElActor: true,
  ...cambios,
});

export const CAJA_ABIERTA: CajaDeLaPantalla = {
  cajaId: "caja-1",
  nombre: "Caja 1",
  estado: "ABIERTA",
  ultimaSesion: null,
  sesion: {
    sesionId: "ses-1",
    fechaDeNegocio: "2026-11-09",
    horaDeCorte: "06:00",
    lineas: [
      linea("EFECTIVO", "50900.00"),
      linea("TARJETA_DEBITO", "52300.00"),
      linea("TRANSFERENCIA", "18000.00"),
      linea("QR", "9500.00"),
    ],
    movimientos: [
      movimiento("mv-1", "FONDO_INICIAL", "15000.00"),
      movimiento("mv-2", "COBRO", "18400.00"),
      movimiento("mv-3", "EGRESO_MANUAL", "-2500.00", { motivo: "Compra de hielo" }),
      movimiento("mv-4", "INGRESO_MANUAL", "1000.00", {
        motivo: "Cambio",
        anulablePorElActor: false,
      }),
      movimiento("mv-5", "INGRESO_MANUAL", "700.00", { motivo: "Error", anuladoPor: "mv-6" }),
      movimiento("mv-6", "ANULACION", "-700.00", { motivo: "Se cargó mal" }),
      movimiento("mv-7", "COBRO", "52300.00", {
        medioTipo: "TARJETA_DEBITO",
        cuentaNombre: "Posnet 1",
      }),
    ],
  },
};

export const CAJA_CERRADA: CajaDeLaPantalla = {
  cajaId: "caja-1",
  nombre: "Caja 1",
  estado: "SIN_SESION",
  sesion: null,
  ultimaSesion: {
    observacion: "Faltaron 100 pesos de vuelto",
    arqueo: [
      {
        ...linea("EFECTIVO", "50900.00"),
        contado: ARS("50800.00"),
        conforme: false,
        diferencia: ARS("-100.00"),
      },
      {
        ...linea("QR", "9500.00"),
        contado: null,
        conforme: true,
        diferencia: null,
      },
    ],
  },
};

export const CAJA_EN_CIERRE: CajaDeLaPantalla = { ...CAJA_ABIERTA, estado: "EN_CIERRE" };

export const CONTEO: ConteoDeLaCaja = {
  sesionId: "ses-1",
  lineas: [
    { ...linea("EFECTIVO", "50900.00"), contarConBilletes: true },
    { ...linea("TARJETA_DEBITO", "52300.00"), contarConBilletes: false },
    { ...linea("QR", "9500.00"), contarConBilletes: false },
  ],
  denominaciones: [20000, 10000, 2000, 1000, 500, 200, 100],
  cantidadMaximaDeBilletes: 99999,
};

/** Las siete acciones del servidor, simuladas: todas responden bien salvo que la prueba cambie la respuesta. */
export function accionesDelServidor() {
  const mocks = {
    abrir: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() => Promise.resolve(BIEN)),
    iniciarCierre: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() =>
      Promise.resolve(BIEN),
    ),
    cancelarCierre: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() =>
      Promise.resolve(BIEN),
    ),
    cerrar: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() => Promise.resolve(BIEN)),
    registrarMovimiento: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() =>
      Promise.resolve(BIEN),
    ),
    registrarAjuste: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() =>
      Promise.resolve(BIEN),
    ),
    anular: vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() => Promise.resolve(BIEN)),
  };
  const acciones: AccionesDelServidorDeCaja = mocks;
  return { acciones, mocks };
}
