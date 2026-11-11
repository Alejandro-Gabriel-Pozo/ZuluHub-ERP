import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla de stock (ADR-005; E5 §3.4) y la acción que cada una exige al guard (cruce X1). Mirar es de los tres roles; el
 * operador solo ve lo de sus sucursales (filtro en la consulta). `verificarSaldos` es del gerente (`stock.verificar_saldos`). Cada tramo suma
 * las suyas acá.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  listarDepositos: { accion: "stock.ver" },
  existencias: { accion: "stock.ver" },
  existenciasNegativas: { accion: "stock.ver" },
  libroDeArticulo: { accion: "stock.ver" },
  fichaDeMovimiento: { accion: "stock.ver" },
  movimientosPorOrigen: { accion: "stock.ver" },
  verificarSaldos: { accion: "stock.verificar_saldos" },
  // La existencia teórica y la diferencia de un conteo solo viajan con `conteos.aplicar` (a ciegas): lo decide la consulta, no la pantalla.
  fichaDeConteo: { accion: "stock.ver" },
  listarConteos: { accion: "stock.ver" },
  // La receta es de la empresa, no de una sucursal: la ve quien puede mirar stock (E5-T7).
  composicionDeProducto: { accion: "stock.ver" },
  // Costos (E5-T10, P-1): quien no puede ver costos no los ve nunca. Solo gerente y administrador (`costos.ver`).
  existenciaValorizada: { accion: "costos.ver" },
  costoDeRenglon: { accion: "costos.ver" },
  ultimoCostoDeCompra: { accion: "costos.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
