import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { sumarDiasCiviles, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { explicacionDesdeTexto } from "../../cierre/publico";
import {
  anularAsientoEnTx,
  registrarAsientoEnTx,
  type ErrorDelLibro,
  type TxDeSaldos,
} from "../../saldos_de_partes/publico";
import {
  CLASE_DEL_CARGO_DE_VENTA,
  DETALLE_DE_LA_ANULACION_DEL_CARGO_DE_VENTA,
  ORIGEN_DEL_CARGO_DE_VENTA,
  claveDeLaAnulacionDelCargoDeVenta,
  claveDelCargoDeVenta,
  excesoDelLimite,
} from "../dominio/cargo-de-venta";
import type { TxDeCuentaCorriente } from "./contrato";

/** Lo que el cargo necesita de la transacción del llamador (ventas): la ficha, el libro entero (escribe el asiento), la auditoría y la autorización. */
export type TxDeCargoDeVenta = Pick<TxDeCuentaCorriente, "cuentasDeClientes" | "autorizacion"> &
  TxDeSaldos;

export type EntradaDelCargoDeVenta = Readonly<{
  clienteId: string;
  ticketId: string;
  /** La sucursal del ticket: el centro de costo del cargo (todo el total a ella). */
  sucursalId: string;
  /** Texto decimal en pesos: el total del ticket. */
  total: string;
  /** La fecha de negocio del TICKET (la de la sucursal, con su hora de corte): de ella corre el plazo del vencimiento. */
  fechaDeNegocio: FechaCivil;
  /** El motivo con el que quien cierra aprueba pasar el límite; solo se mira si el cargo lo supera. */
  aprobacion?: Readonly<{ motivo: string }> | undefined;
}>;

export type ErrorDelCargoDeVenta =
  | "CLIENTE_SIN_CUENTA_HABILITADA"
  | "CUENTA_SUSPENDIDA"
  | "EXCEDE_EL_LIMITE"
  | MotivoDeRechazo
  | ErrorDelLibro;

/**
 * La aprobación de un exceso del límite: solo vale si quien actúa tiene `cuenta_corriente.aprobar_exceso` (lo decide el servidor, nunca el pedido) y manda un motivo; devuelve el motivo
 * canónico. Sin permiso o sin motivo: `EXCEDE_EL_LIMITE` (la venta no se hace). Es la única puerta de esa acción.
 */
export async function aprobarExcesoEnTx(
  tx: Pick<TxDeCargoDeVenta, "autorizacion">,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  motivo: string | undefined,
): Promise<Resultado<string, "EXCEDE_EL_LIMITE">> {
  const puede = await exigirAccion(reglas, "cuenta_corriente.aprobar_exceso", () =>
    tx.autorizacion.delActor(contexto),
  );
  const explicacion = explicacionDesdeTexto(motivo);
  if (!puede.ok || !explicacion.ok || explicacion.valor === null) return err("EXCEDE_EL_LIMITE");
  return ok(explicacion.valor);
}

export type CargoDeVentaRegistrado = Readonly<{ asientoId: string; yaExistia: boolean }>;

/**
 * Carga la venta a la cuenta del cliente (CC-2), DENTRO de la transacción del cierre del ticket; el permiso de cerrar a cuenta lo exige quien llama. Orden:
 *  1. La ficha del cliente se toma `FOR UPDATE` ANTES de leer el saldo: dos cargos al mismo cliente se turnan y el segundo ve el saldo del primero (y espera a quien la suspende).
 *     Sin ficha o suspendida, el cargo no se hace.
 *  2. Si el saldo más el total supera el límite hace falta una aprobación: solo vale si quien actúa tiene `cuenta_corriente.aprobar_exceso` (el servidor lo decide) y manda un motivo; si no,
 *     `EXCEDE_EL_LIMITE`. La aprobación deja su constancia (quién, cuánto excede, el límite y el saldo de antes) en la misma transacción.
 *  3. El asiento `A_COBRAR` por el total, con vencimiento = fecha de negocio del ticket + plazo de la ficha, origen = el ticket y clave determinista: repetir no duplica nada.
 *  4. Un solo centro de costo: la sucursal del ticket. El asiento va AL FINAL de lo que escribe el llamador (el libro serializa el saldo de la parte hasta que confirma).
 */
export async function cargarVentaEnTx(
  tx: TxDeCargoDeVenta,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  entrada: EntradaDelCargoDeVenta,
): Promise<Resultado<CargoDeVentaRegistrado, ErrorDelCargoDeVenta>> {
  // Guard primero (también acá: el módulo no confía en que quien lo llama haya autorizado).
  const permiso = await exigirAccion(reglas, "cuenta_corriente.cargar_a_cuenta", () =>
    tx.autorizacion.delActor(contexto),
  );
  if (!permiso.ok) return permiso;
  const persona = contexto.personaId;
  if (persona === null) return err("ACTOR_REQUERIDO");
  const ficha = await tx.cuentasDeClientes.obtenerPorParteParaActualizar(
    contexto.empresaId,
    entrada.clienteId,
  );
  if (ficha === null) return err("CLIENTE_SIN_CUENTA_HABILITADA");
  if (ficha.estado !== "HABILITADA") return err("CUENTA_SUSPENDIDA");

  const total = importeDesdeTexto(ARS, entrada.total);
  const saldo = await tx.saldos.saldoDeParte(contexto.empresaId, entrada.clienteId, "A_COBRAR");
  const exceso = excesoDelLimite(ficha.limite, saldo, total);
  let motivo: string | null = null;
  if (exceso !== null) {
    const aprobado = await aprobarExcesoEnTx(tx, contexto, reglas, entrada.aprobacion?.motivo);
    if (!aprobado.ok) return aprobado;
    motivo = aprobado.valor;
  }

  const vence = sumarDiasCiviles(entrada.fechaDeNegocio, ficha.plazoDias);
  if (!vence.ok) return err("VENCIMIENTO_INVALIDO");
  const asiento = await registrarAsientoEnTx(tx, contexto, {
    parteId: entrada.clienteId,
    sentido: "A_COBRAR",
    clase: CLASE_DEL_CARGO_DE_VENTA,
    importe: total,
    origen: { tipo: ORIGEN_DEL_CARGO_DE_VENTA, id: entrada.ticketId, orden: 1 },
    venceEl: vence.valor,
    clave: claveDelCargoDeVenta(entrada.ticketId),
    hechoEn: contexto.ahora,
    distribucion: [{ centroDeCosto: entrada.sucursalId, importe: total }],
  });
  if (!asiento.ok) return asiento;
  if (exceso !== null && motivo !== null && !asiento.valor.yaExistia) {
    await tx.auditoria.registrar({
      empresaId: contexto.empresaId,
      actorPersonaId: persona,
      accion: "cuenta_corriente.aprobar_exceso",
      entidad: "cuenta_del_cliente",
      entidadId: ficha.id,
      despues: {
        parteId: entrada.clienteId,
        ticketId: entrada.ticketId,
        total: importeATexto(total),
        exceso: importeATexto(exceso),
        limite: importeATexto(ficha.limite),
        saldoPrevio: importeATexto(saldo),
        motivo,
      },
    });
  }
  return ok(asiento.valor);
}

/**
 * El espejo del cargo al anular el ticket (CC-2): anula el asiento del cargo en la MISMA transacción que la anulación (o se hacen las dos o ninguna). Sin asiento no hay con qué
 * anular: `ASIENTO_NO_ENCONTRADO` y la anulación del ticket se revierte (un ticket a cuenta sin cargo es una inconsistencia que no se tapa). Repetir no duplica el espejo.
 */
export async function anularCargoDeVentaEnTx(
  tx: TxDeSaldos,
  contexto: ContextoOperativo,
  entrada: Readonly<{ ticketId: string }>,
): Promise<Resultado<CargoDeVentaRegistrado, ErrorDelLibro>> {
  const original = await tx.asientos.porOrigen(
    contexto.empresaId,
    ORIGEN_DEL_CARGO_DE_VENTA,
    entrada.ticketId,
    1,
  );
  if (original === null) return err("ASIENTO_NO_ENCONTRADO");
  const espejo = await anularAsientoEnTx(tx, contexto, {
    asientoId: original.id,
    detalle: DETALLE_DE_LA_ANULACION_DEL_CARGO_DE_VENTA,
    clave: claveDeLaAnulacionDelCargoDeVenta(entrada.ticketId),
  });
  return espejo.ok
    ? ok({ asientoId: espejo.valor.asientoId, yaExistia: espejo.valor.yaExistia })
    : espejo;
}
