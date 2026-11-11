import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { decidirAnularLinea } from "../dominio/decisiones";
import { cuentaId, lineaId } from "../dominio/identificadores";
import { motivoDeAnulacion } from "../dominio/motivo";
import { aJson, calcularLasLineas } from "./calculo";
import { exigirAlcance, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeAnularLinea = Readonly<{
  cuentaId: string;
  lineaId: string;
  motivo: string;
}>;

export type SalidaDeAnularLinea = Readonly<{
  yaEstabaAnulada: boolean;
  totalProvisorio: ImporteJson;
}>;

/**
 * `anularLineaEnTx` es el cuerpo de `anularLinea` DENTRO de la transacción del llamador (el salón anula con motivos internos, E7); el permiso lo exige
 * quien llama. `anularLinea` (decisión 155: el operador anula, con todo auditado; E4 §3.4). Una línea no se edita ni se borra: se anula con motivo y el total
 * de la cuenta se recalcula. Guard (`cuentas.anular_linea`), la empresa opera, el motivo es obligatorio, la línea es de esa cuenta, la
 * sucursal está en el alcance. NO mira la jornada: anular es la salida de `ventas.cuentas_abiertas` y se permite siempre (también con la
 * jornada en auditoría o cerrada, §3.15). Repetir devuelve `yaEstabaAnulada` sin escribir. Audita `LINEA_ANULADA` (quién, cuándo y por qué).
 */
export async function anularLineaEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeAnularLinea,
): Promise<R<SalidaDeAnularLinea>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId, entrada.lineaId);
  if (!ids.ok) return ids;
  const motivo = motivoDeAnulacion(entrada.motivo);
  if (!motivo.ok) return motivo;

  const cuenta = await tx.cuentas.obtener(empresaId, cuentaId(entrada.cuentaId));
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const linea = await tx.cuentas.obtenerLinea(empresaId, lineaId(entrada.lineaId));
  if (linea === null || linea.cuentaId !== cuenta.id) return err("LINEA_NO_ENCONTRADA");

  const decision = decidirAnularLinea({
    estadoDeLaLinea: linea.estado,
    estadoDeLaCuenta: cuenta.estado,
  });
  if (!decision.ok) return decision;
  if (decision.valor === "YA_ESTABA_ANULADA") {
    const lineas = await tx.cuentas.lineasDeCuenta(empresaId, cuenta.id);
    return ok({ yaEstabaAnulada: true, totalProvisorio: aJson(calcularLasLineas(lineas)) });
  }
  const anulada = await tx.cuentas.anularLinea(
    empresaId,
    linea.id,
    persona,
    contexto.ahora,
    motivo.valor,
  );
  if (!anulada) return err("CUENTA_NO_ABIERTA");
  const lineas = await tx.cuentas.lineasDeCuenta(empresaId, cuenta.id);
  const calculado = calcularLasLineas(lineas);
  await tx.cuentas.fijarTotal(empresaId, cuenta.id, importeAJson(calculado.total).monto);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "LINEA_ANULADA",
    entidad: "linea_cuenta",
    entidadId: linea.id,
    antes: { estado: "VIGENTE", totalProvisorio: cuenta.totalProvisorio },
    despues: {
      estado: "ANULADA",
      cuentaId: cuenta.id,
      posicion: linea.posicion,
      motivo: motivo.valor,
      totalProvisorio: importeAJson(calculado.total).monto,
    },
  });
  return ok({ yaEstabaAnulada: false, totalProvisorio: aJson(calculado) });
}

async function anular(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeAnularLinea,
): Promise<R<SalidaDeAnularLinea>> {
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [
    "cuentas.anular_linea",
  ]);
  if (!persona.ok) return persona;
  return anularLineaEnTx(tx, contexto, persona.valor, entrada);
}

export function armarAnularLinea(dependencias: DependenciasDeVentas) {
  return async function anularLinea(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularLinea,
  ): Promise<R<SalidaDeAnularLinea>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      anular(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
