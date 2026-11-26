import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import { platosPendientesEnTx } from "../../comandas/publico";
import {
  cerrarCuentaEnTx,
  cuentaPorId,
  REINTENTOS_AL_COBRAR,
  type EntradaDeCerrarCuenta,
  type SalidaDeCerrarCuenta,
} from "../../ventas/publico";
import { liberarLoQueDepende } from "./cobro";
import { exigirAlcance, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeSalon, TxDeSalon } from "./contrato";
import { claseDeCuenta, exigirCuentaUsable } from "./cuenta-de-mesa";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeSalon } from "./errores";

type R<S> = Resultado<S, ErrorDeSalon>;

export type EntradaDeCerrarMesaACuenta = Readonly<{
  cuentaId: string;
  /** El id del ejemplar ORIGINAL del ticket: lo genera la pantalla por intento y es la clave de idempotencia (como en `cerrarCuenta`). */
  ejemplarId: string;
  /** El cliente al que se le carga la mesa: obligatorio (sin cliente no hay cuenta a la que cargar). */
  clienteId: string;
  /** Lo que vio quien cierra: si el total de ahora es otro, no se cierra nada (`TOTAL_CAMBIO`). */
  totalEsperado: Readonly<{ moneda: string; monto: string }>;
  /** El motivo con el que quien cierra aprueba pasar el límite de crédito (solo cuenta si la venta lo supera y quien cierra puede aprobar: lo decide el servidor). */
  aprobacionDelExceso?: Readonly<{ motivo: string }> | undefined;
  confirmaciones?: readonly string[] | undefined;
  /** La sucursal con la que trabaja quien cierra (la fija el servidor): una cuenta de OTRA, o sin sucursal de trabajo, es como si no existiera (`CUENTA_NO_ENCONTRADA`). */
  sucursalDeTrabajo: string;
}>;

/**
 * `cerrarMesaACuenta`: cierra la cuenta de una mesa (o de una hija de una división) a nombre de un cliente con cuenta corriente, SIN cobro de caja, en UNA transacción
 * serializable y atómica: o se emite el ticket cargado a su cuenta y la mesa queda libre, o no pasa nada. Guard de TODAS las acciones que usa por dentro (`cuentas.cerrar`,
 * `cuenta_corriente.cargar_a_cuenta`, `cuentas.anular`). Misma regla que cobrar (D86 y D114): con algún plato vigente sin enviar o en espera, `HAY_PLATOS_SIN_ENVIAR` y no se
 * escribe nada. Después, el cierre de ventas (`cerrarCuentaEnTx` con cliente: ticket con su número, ejemplar, stock, cargo a la cuenta corriente con su límite y auditoría) y
 * se libera lo que dependía de esta cuenta (la misma regla que al cobrar). Repetir tras perder la respuesta devuelve el mismo ticket (`yaEstabaCerrada`). Audita
 * `MESA_CERRADA_A_CUENTA` (sin el nombre del cliente). El cobro de lo adeudado viene después, por la cuenta corriente.
 */
async function cerrar(
  tx: TxDeSalon,
  dependencias: DependenciasDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeCerrarMesaACuenta,
): Promise<R<SalidaDeCerrarCuenta>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId);
  if (!ids.ok) return ids;
  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  if (entrada.sucursalDeTrabajo !== cuenta.sucursalId) return err("CUENTA_NO_ENCONTRADA");
  const usable = exigirCuentaUsable(await claseDeCuenta(tx, contexto, cuenta), true);
  if (!usable.ok) return usable;
  if (cuenta.estado === "ABIERTA") {
    const pendientes = await platosPendientesEnTx(tx, empresaId, cuenta.id);
    if (pendientes.paraEnviar > 0 || pendientes.enEspera > 0) return err("HAY_PLATOS_SIN_ENVIAR");
  }
  // `totalEsperado` lo valida `cerrarCuentaEnTx` (CC-1): una sola regla, en ventas. Mientras su tipo no lo declare, el pedido va como valor y no como literal.
  const pedido = {
    cuentaId: entrada.cuentaId,
    ejemplarId: entrada.ejemplarId,
    clienteId: entrada.clienteId,
    totalEsperado: entrada.totalEsperado,
    aprobacionDelExceso: entrada.aprobacionDelExceso,
    confirmaciones: entrada.confirmaciones,
  } satisfies EntradaDeCerrarCuenta & Pick<EntradaDeCerrarMesaACuenta, "totalEsperado">;
  const cerrada = await cerrarCuentaEnTx(tx, contexto, persona, pedido, {
    stock: dependencias.stock,
    cuentaCorriente: dependencias.cuentaCorriente,
  });
  if (!cerrada.ok) return cerrada;
  const liberada = await liberarLoQueDepende(tx, contexto, persona, cuenta.id);
  if (!liberada.ok) return liberada;
  if (!cerrada.valor.yaEstabaCerrada) {
    await tx.auditoria.registrar({
      empresaId,
      actorPersonaId: persona,
      accion: "MESA_CERRADA_A_CUENTA",
      entidad: "ticket",
      entidadId: cerrada.valor.ticketId,
      despues: {
        cuentaId: cuenta.id,
        numero: cerrada.valor.numero,
        total: cerrada.valor.total.monto,
        clienteId: entrada.clienteId,
      },
    });
  }
  return cerrada;
}

export function armarCerrarMesaACuenta(dependencias: DependenciasDeSalon) {
  return {
    async cerrarMesaACuenta(
      contexto: ContextoOperativo,
      entrada: EntradaDeCerrarMesaACuenta,
    ): Promise<R<SalidaDeCerrarCuenta>> {
      const resultado = await dependencias.transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_AL_COBRAR },
        async (tx) => {
          const persona = await prepararComando(
            tx,
            contexto,
            dependencias.reglas,
            accionesDeCaso(DECLARACIONES.cerrarMesaACuenta),
          );
          if (!persona.ok) return persona;
          return cerrar(tx, dependencias, contexto, persona.valor, entrada);
        },
      );
      return traducir(resultado, dependencias.stock);
    },
  };
}
