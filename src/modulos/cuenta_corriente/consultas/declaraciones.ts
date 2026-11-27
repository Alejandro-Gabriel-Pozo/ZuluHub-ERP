import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/** Las consultas de la cuenta corriente de clientes (ADR-005) y la acción que cada una exige al guard (cruce X1 de ADR-003). */
export const DECLARACIONES_DE_CONSULTAS = {
  verCuentaDelCliente: { accion: "cuenta_corriente.ver" },
  // CC-4: el estado de cuenta de un cliente y la lista de clientes con cuenta (sin permiso nuevo: `ver`, hoy solo gerente y administrador).
  verEstadoDeCuenta: { accion: "cuenta_corriente.ver" },
  listarClientesConCuenta: { accion: "cuenta_corriente.ver" },
  // CC-5 B1: la lista para elegir cliente al vender a cuenta; la ve quien puede cargar a cuenta (sin saldos).
  listarClientesParaVender: { accion: "cuenta_corriente.cargar_a_cuenta" },
  // CC-5 A2: los clientes que se pueden habilitar; la ve quien puede habilitar (`administrar`), no solo quien mira.
  listarClientesSinCuenta: { accion: "cuenta_corriente.administrar" },
} as const satisfies Record<string, DeclaracionDeCaso>;
