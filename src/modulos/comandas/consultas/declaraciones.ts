import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/** Las consultas de comandas (ADR-005; E7 §3.6) y la acción que cada una exige al guard (cruce X1). Mirar es de los tres roles. */
export const DECLARACIONES_DE_CONSULTAS = {
  fichaDeEnvio: { accion: "comandas.ver" },
  enviosDeCuenta: { accion: "comandas.ver" },
  documentoParaImprimir: { accion: "comandas.ver" },
  trabajosDeImpresion: { accion: "comandas.ver" },
  impresorasDeLaSucursal: { accion: "impresoras.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
