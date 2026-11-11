import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { traducirErroresDelCobro } from "../../caja/publico";
import { platosPendientesEnTx } from "../../comandas/publico";
import {
  anularCuentaEnTx,
  cerrarYCobrarEnTx,
  cuentaPorId,
  REINTENTOS_AL_COBRAR,
  type EntradaDeCobrar,
  type SalidaDeVenderYCobrar,
} from "../../ventas/publico";
import { exigirAlcance, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeSalon, TxDeSalon } from "./contrato";
import {
  claseDeCuenta,
  exigirCuentaUsable,
  MOTIVO_DIVISION_COBRADA,
  MOTIVO_UNIDA_COBRADA,
} from "./cuenta-de-mesa";
import type { ErrorDeSalon } from "./errores";

type R<S> = Resultado<S, ErrorDeSalon>;

export type EntradaDeCobrarMesa = Readonly<{
  /** `^[A-Za-z0-9_-]{16,128}$`, la genera la pantalla por intento de cobro (idempotencia). */
  claveIdempotencia: string;
  cuentaId: string;
  /** El id del ejemplar ORIGINAL del ticket. */
  ejemplarId: string;
  /** Lo que vio quien cobra: si el total de ahora es otro, no se cobra nada (`TOTAL_CAMBIO`). */
  totalEsperado: Readonly<{ moneda: string; monto: string }>;
  confirmaciones?: readonly string[] | undefined;
  cobro: Pick<EntradaDeCobrar, "cajaId" | "cobros">;
}>;

/**
 * Libera lo que depende de esta cuenta ya cobrada (E7 §3.7 punto 5): las cuentas de reserva de las uniones cuyo destino es esta (motivo interno
 * `UNIDA_COBRADA`) y, si es la ÚLTIMA cuenta hija de una división, la cuenta madre (`DIVISION_COBRADA`). Con eso la mesa queda libre. Idempotente: anular
 * una cuenta ya anulada no escribe.
 */
async function liberarLoQueDepende(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  cuentaId: string,
): Promise<R<null>> {
  const { empresaId } = contexto;
  for (const union of await tx.unionesYDivisiones.unionesDeDestino(empresaId, cuentaId)) {
    const anulada = await anularCuentaEnTx(tx, contexto, persona, {
      cuentaId: union.cuentaOrigenId,
      motivo: MOTIVO_UNIDA_COBRADA,
    });
    if (!anulada.ok) return anulada;
  }
  const hija = await tx.unionesYDivisiones.divisionPorHija(empresaId, cuentaId);
  if (hija !== null) {
    const partes = await tx.unionesYDivisiones.partesDeDivision(empresaId, hija.division.id);
    let todasCobradas = true;
    for (const parte of partes) {
      const c = await cuentaPorId(tx, empresaId, parte.cuentaId);
      if (c === null || c.estado === "ABIERTA") todasCobradas = false;
    }
    if (todasCobradas) {
      const anulada = await anularCuentaEnTx(tx, contexto, persona, {
        cuentaId: hija.division.cuentaMadreId,
        motivo: MOTIVO_DIVISION_COBRADA,
      });
      if (!anulada.ok) return anulada;
    }
  }
  return ok(null);
}

/**
 * `cobrarMesa` (E7 §3.7): cobra la cuenta de una mesa (o de una hija de una división) en UNA transacción serializable, atómica: o se cobra y la mesa
 * queda libre, o no pasa nada. Guard de TODAS las acciones que usa por dentro (`cuentas.cerrar`, `tickets.cobrar`, `cuentas.anular`). Regla D86 y D114: si
 * queda algún plato vigente sin enviar o en espera, `HAY_PLATOS_SIN_ENVIAR` y no se escribe nada (la pantalla lo comunica con el estado del botón; el
 * servidor igual lo rechaza). Después, el cierre y el cobro de ventas (`cerrarYCobrarEnTx`: ticket con su número, ejemplar, cobranza, cobros de caja, stock
 * y auditoría, con la fecha de negocio de la sesión de caja), y se libera lo que dependía de esta cuenta. Repetir tras perder la respuesta devuelve la
 * misma venta (`yaExistia`). Audita `MESA_COBRADA`. Sin propina (D152); el vuelto, solo en efectivo, es de caja.
 */
async function cobrar(
  tx: TxDeSalon,
  dependencias: DependenciasDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeCobrarMesa,
): Promise<R<SalidaDeVenderYCobrar>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId);
  if (!ids.ok) return ids;
  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const usable = exigirCuentaUsable(await claseDeCuenta(tx, contexto, cuenta), true);
  if (!usable.ok) return usable;
  if (cuenta.estado === "ABIERTA") {
    const pendientes = await platosPendientesEnTx(tx, empresaId, cuenta.id);
    if (pendientes.paraEnviar > 0 || pendientes.enEspera > 0) return err("HAY_PLATOS_SIN_ENVIAR");
  }
  const vendida = await cerrarYCobrarEnTx(
    tx,
    contexto,
    persona,
    {
      claveIdempotencia: entrada.claveIdempotencia,
      cuentaId: entrada.cuentaId,
      ejemplarId: entrada.ejemplarId,
      totalEsperado: entrada.totalEsperado,
      confirmaciones: entrada.confirmaciones,
      cobro: entrada.cobro,
    },
    { stock: dependencias.stock },
  );
  if (!vendida.ok) return vendida;
  const liberada = await liberarLoQueDepende(tx, contexto, persona, cuenta.id);
  if (!liberada.ok) return liberada;
  if (!vendida.valor.yaExistia) {
    await tx.auditoria.registrar({
      empresaId,
      actorPersonaId: persona,
      accion: "MESA_COBRADA",
      entidad: "ticket",
      entidadId: vendida.valor.ticketId,
      despues: {
        cuentaId: cuenta.id,
        numero: vendida.valor.numero,
        total: vendida.valor.total.monto,
      },
    });
  }
  return vendida;
}

export function armarCobro(dependencias: DependenciasDeSalon) {
  return {
    async cobrarMesa(
      contexto: ContextoOperativo,
      entrada: EntradaDeCobrarMesa,
    ): Promise<R<SalidaDeVenderYCobrar>> {
      const resultado = await dependencias.transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_AL_COBRAR },
        async (tx) => {
          const persona = await prepararComando(tx, contexto, dependencias.reglas, [
            "cuentas.cerrar",
            "tickets.cobrar",
            "cuentas.anular",
          ]);
          if (!persona.ok) return persona;
          return cobrar(tx, dependencias, contexto, persona.valor, entrada);
        },
      );
      // Un error de la base en la transacción (caja) sale con su código de negocio; el resto, como el módulo lo traduce.
      return traducir(traducirErroresDelCobro(resultado), dependencias.stock);
    },
  };
}
