import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { decidirAnularCuenta } from "../dominio/decisiones";
import { cuentaId } from "../dominio/identificadores";
import { motivoDeAnulacion } from "../dominio/motivo";
import { exigirAlcance, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeAnularCuenta = Readonly<{ cuentaId: string; motivo: string }>;
export type SalidaDeAnularCuenta = Readonly<{ yaEstabaAnulada: boolean }>;

/**
 * `anularCuentaEnTx` es el cuerpo de `anularCuenta` dentro de la transacción del llamador (E7); el permiso lo exige quien llama. `anularCuenta` (decisión 155; E4 §3.4). Anula una cuenta ABIERTA con su motivo: no gasta número de ticket ni mueve stock (no hay ticket).
 * Con cero líneas vigentes está SIEMPRE permitida: es la salida de la «cuenta con todo anulado» (R5). Una cuenta cerrada tiene ticket y
 * no se anula acá (`CUENTA_CERRADA`); repetir sobre una anulada devuelve `yaEstabaAnulada` sin escribir. No mira la jornada: es la salida de
 * `ventas.cuentas_abiertas` (§3.15). Audita `CUENTA_ANULADA` (quién, cuándo y por qué).
 */
export async function anularCuentaEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeAnularCuenta,
): Promise<R<SalidaDeAnularCuenta>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId);
  if (!ids.ok) return ids;
  const motivo = motivoDeAnulacion(entrada.motivo);
  if (!motivo.ok) return motivo;

  const cuenta = await tx.cuentas.obtener(empresaId, cuentaId(entrada.cuentaId));
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;

  const decision = decidirAnularCuenta(cuenta.estado);
  if (!decision.ok) return decision;
  if (decision.valor === "YA_ESTABA_ANULADA") return ok({ yaEstabaAnulada: true });
  const anulada = await tx.cuentas.anular(
    empresaId,
    cuenta.id,
    persona,
    contexto.ahora,
    motivo.valor,
  );
  // 0 filas: otro la cerró o la anuló un instante antes. Se relee para decir qué pasó (la serializable ya repite ante un conflicto).
  if (!anulada) {
    const actual = await tx.cuentas.obtener(empresaId, cuenta.id);
    return actual !== null && actual.estado === "ANULADA"
      ? ok({ yaEstabaAnulada: true })
      : err("CUENTA_CERRADA");
  }
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "CUENTA_ANULADA",
    entidad: "cuenta_consumo",
    entidadId: cuenta.id,
    antes: { estado: "ABIERTA", totalProvisorio: cuenta.totalProvisorio },
    despues: { estado: "ANULADA", motivo: motivo.valor },
  });
  return ok({ yaEstabaAnulada: false });
}

async function anular(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeAnularCuenta,
): Promise<R<SalidaDeAnularCuenta>> {
  const persona = await prepararComando(tx, contexto, dependencias.reglas, ["cuentas.anular"]);
  if (!persona.ok) return persona;
  return anularCuentaEnTx(tx, contexto, persona.valor, entrada);
}

export function armarAnularCuenta(dependencias: DependenciasDeVentas) {
  return async function anularCuenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularCuenta,
  ): Promise<R<SalidaDeAnularCuenta>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      anular(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
