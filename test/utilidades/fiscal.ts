import type { Cuit } from "../../src/primitivas/identificacion-fiscal/cuit";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import {
  empresaId,
  personaId,
  sucursalId,
  type EmpresaId,
} from "../../src/primitivas/identificadores/marca";
import type { Emisor } from "../../src/modulos/fiscal/dominio/emisor";
import {
  domicilioId,
  emisorId,
  puntoDeVentaId,
  solicitudId,
  versionId,
} from "../../src/modulos/fiscal/dominio/identificadores";
import type { Serie } from "../../src/modulos/fiscal/dominio/numeracion";
import type { PuntoDeVenta } from "../../src/modulos/fiscal/dominio/punto-de-venta";

/** Datos de ejemplo del dominio fiscal, compartidos por las pruebas. Todos los CUIT son válidos. */
function cuit(texto: string): Cuit {
  const r = cuitDesdeTexto(texto);
  if (!r.ok) throw new Error(`CUIT de prueba inválido: ${texto}`);
  return r.valor;
}

export const CUIT_A = cuit("20123456786");
export const CUIT_B = cuit("30708533935");
export const CUIT_C = cuit("30712345671");
export const CUIT_D = cuit("27333333339");

export const EMPRESA: EmpresaId = empresaId("e-1");
export const OTRA_EMPRESA: EmpresaId = empresaId("e-2");
export const GERENTE = personaId("p-gerente");
export const SUCURSAL = sucursalId("s-1");
export const OTRA_SUCURSAL = sucursalId("s-2");

export const EMISOR_1 = emisorId("em-1");
export const EMISOR_2 = emisorId("em-2");
export const EMISOR_3 = emisorId("em-3");
export const DOMICILIO_1 = domicilioId("d-1");
export const DOMICILIO_2 = domicilioId("d-2");
export const VERSION_1 = versionId("v-1");
export const VERSION_2 = versionId("v-2");
export const SOLICITUD_1 = solicitudId("sol-1");
export const SOLICITUD_2 = solicitudId("sol-2");

export const emisor = (cambios: Partial<Emisor> = {}): Emisor => ({
  id: EMISOR_1,
  empresaId: EMPRESA,
  esPrincipal: false,
  cuit: CUIT_B,
  activo: true,
  version: 1,
  ...cambios,
});

export const puntoDeVenta = (cambios: Partial<PuntoDeVenta> = {}): PuntoDeVenta => ({
  id: puntoDeVentaId("pv-1"),
  empresaId: EMPRESA,
  emisorId: EMISOR_1,
  sucursalId: SUCURSAL,
  domicilioId: DOMICILIO_1,
  numero: 1,
  estado: "INACTIVO",
  verificacionArca: "NO_VERIFICADO",
  version: 1,
  ...cambios,
});

export const IDENTIDAD_DE_SERIE = {
  empresaId: EMPRESA,
  puntoDeVentaId: puntoDeVentaId("pv-1"),
  emisorId: EMISOR_1,
  tipo: "FACTURA_B",
  ambiente: "HOMOLOGACION",
  version: 3,
} as const;

export const serieLibre = (ultimoNumero: bigint): Serie => ({
  ...IDENTIDAD_DE_SERIE,
  estado: "LIBRE",
  ultimoNumero,
});

export const serieEnCurso = (
  ultimoNumero: bigint,
  enCursoHasta: Date,
  solicitud = SOLICITUD_1,
): Serie => ({
  ...IDENTIDAD_DE_SERIE,
  estado: "EN_CURSO",
  ultimoNumero,
  numeroEnCurso: ultimoNumero + 1n,
  solicitud,
  enCursoHasta,
});

export const serieBloqueada = (ultimoNumero: bigint, motivoBloqueo = "desfase"): Serie => ({
  ...IDENTIDAD_DE_SERIE,
  estado: "BLOQUEADA",
  ultimoNumero,
  motivoBloqueo,
});
