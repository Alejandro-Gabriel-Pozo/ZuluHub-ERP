import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { jornadaDeSucursal } from "../../cierre/publico";
import { dejarConstancia } from "../casos-de-uso/comun";
import type { TxDeCaja } from "../casos-de-uso/contrato";
import { decidirAnulacion, movimientoAnulableDe } from "../dominio/anulacion";
import { decidirCajaParaCobrar, decidirSesionParaCobrar } from "../dominio/cobrar";
import { decidirPorHuella } from "../dominio/huella";
import { huellaDeAnulacion, huellaDeMovimientoManual } from "../dominio/idempotencia-de-operacion";
import { decidirMovimientoManual } from "../dominio/movimiento";
import {
  claveDeAnulacionDeOrigen,
  claveDeIngresoDe,
  origenDeIngresoValido,
} from "../dominio/origen-de-movimiento";
import type {
  EntradaDeAnularIngresoPorOrigen,
  EntradaDeIngresoPorOrigen,
  ErrorAlAnularIngreso,
  ErrorAlIngresar,
  SalidaDeAnularIngresoPorOrigen,
  SalidaDeIngresoPorOrigen,
} from "./contrato";

/**
 * Mete UN ingreso de efectivo en la caja abierta (LB-5) en la transacción del llamador y sin autorizar (el permiso es el de la acción que lo pide: reintegro
 * de un proveedor o devolución del sobrante de un anticipo; gerente y administrador). Espejo de `registrarEgresoEnTx`. Orden: persona del contexto, origen de
 * la lista cerrada (`REINTEGRO_DE_PROVEEDOR`, `DEVOLUCION_DE_SOBRANTE`; otro es `ORIGEN_INVALIDO`), serializable (el cierre de la caja detecta al ingreso en
 * vuelo), validación del importe y del motivo, BÚSQUEDA POR CLAVE ANTES DE MIRAR LA SESIÓN (misma clave y misma huella: lo ya hecho con `yaExistia`; otra
 * huella: `CLAVE_REUTILIZADA`), caja activa de la sucursal, sesión `ABIERTA` (sin sesión o en cierre falla cerrado con su error tipado) y jornada abierta.
 * Inserta el movimiento `INGRESO_MANUAL` en el medio efectivo y su auditoría, en la misma transacción. Solo efectivo: no hay parámetro de medio.
 * Previene: la plata que entra a la caja dos veces por un doble clic y un reintegro o una devolución en efectivo con la caja cerrada que no suma nada.
 */
export async function registrarIngresoEnTx(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  entrada: EntradaDeIngresoPorOrigen,
): Promise<Resultado<SalidaDeIngresoPorOrigen, ErrorAlIngresar>> {
  const { empresaId, ahora } = contexto;
  if (contexto.personaId === null) return err("SIN_PERMISO");
  if (!origenDeIngresoValido(entrada.origen)) return err("ORIGEN_INVALIDO");
  if ((await tx.cobros.aislamientoDeLaTransaccion()) !== "serializable") {
    throw new Error("registrarIngresoEnTx solo corre en una transacción serializable");
  }
  const persona = contexto.personaId;
  const movimiento = decidirMovimientoManual({
    sentido: "INGRESO",
    importe: entrada.importe,
    motivo: entrada.motivo,
  });
  if (!movimiento.ok) return movimiento;
  const clave = claveDeIngresoDe(entrada.origen);
  const huella = huellaDeMovimientoManual({
    // La sesión todavía no se conoce (se busca por clave ANTES de mirarla): la huella lleva la caja, que es lo que pidió quien registra.
    sesionId: entrada.cajaId,
    clase: movimiento.valor.clase,
    importe: movimiento.valor.importe,
    motivo: movimiento.valor.motivo,
  });
  const previa = await tx.movimientos.obtenerHuellaPorClave(empresaId, clave);
  if (previa !== null) {
    if (decidirPorHuella(previa.huella, huella) === "CLAVE_REUTILIZADA") {
      return err("CLAVE_REUTILIZADA");
    }
    return ok({ movimientoId: previa.id, sesionId: previa.sesionId, yaExistia: true });
  }

  const caja = await tx.cajas.obtener(empresaId, entrada.cajaId);
  const cajaAdmitida = decidirCajaParaCobrar({ caja, sucursalPedida: entrada.sucursalId });
  if (!cajaAdmitida.ok) return cajaAdmitida;
  const sesionVigente = await tx.sesiones.vigenteDeLaCajaCompartida(empresaId, entrada.cajaId);
  const sesionAdmitida = decidirSesionParaCobrar({ cajaId: entrada.cajaId, sesionVigente });
  if (!sesionAdmitida.ok) return sesionAdmitida;
  // `sesionVigente` no es nula si la decisión salió bien.
  const sesion = sesionVigente as NonNullable<typeof sesionVigente>;
  const jornada = await jornadaDeSucursal.asegurarAbiertaEnTx(
    tx,
    empresaId,
    sesion.sucursalId,
    sesion.fechaDeNegocio,
  );
  if (!jornada.ok) return jornada;

  const efectivo = await tx.mediosDePago.obtenerEfectivo(empresaId);
  if (efectivo === null) throw new Error("invariante rota: una sesión sin medio efectivo");

  const movimientoId = await tx.movimientos.insertarSiNoExiste({
    empresa: empresaId,
    sesionId: sesion.id,
    clase: movimiento.valor.clase,
    medioDePagoId: efectivo.id,
    cuentaDeCobroId: null,
    importe: movimiento.valor.importe,
    motivo: movimiento.valor.motivo,
    anulaA: null,
    corrigeJornada: null,
    registradoEn: ahora,
    registradoPor: persona,
    claveDeIdempotencia: clave,
    huella,
    origen: { tipo: entrada.origen.tipo, id: entrada.origen.id.toLowerCase() },
  });
  if (movimientoId === null) {
    // Otro pedido con esta misma clave se adelantó (y esta transacción lo ve recién ahora): es una repetición, no un error.
    const ganadora = await tx.movimientos.obtenerHuellaPorClave(empresaId, clave);
    if (ganadora === null) {
      throw new Error("invariante rota: el ingreso chocó con algo que no es su clave");
    }
    return decidirPorHuella(ganadora.huella, huella) === "CLAVE_REUTILIZADA"
      ? err("CLAVE_REUTILIZADA")
      : ok({ movimientoId: ganadora.id, sesionId: ganadora.sesionId, yaExistia: true });
  }
  await dejarConstancia(tx, contexto, persona, {
    accion: "MOVIMIENTO_MANUAL_REGISTRADO",
    entidad: "movimiento_caja",
    entidadId: movimientoId,
    despues: {
      sesionId: sesion.id,
      clase: movimiento.valor.clase,
      importe: importeATexto(movimiento.valor.importe),
      motivo: movimiento.valor.motivo,
      origenTipo: entrada.origen.tipo,
      origenId: entrada.origen.id,
    },
  });
  return ok({ movimientoId, sesionId: sesion.id, yaExistia: false });
}

/**
 * Anula el ingreso de caja de un origen con un registro nuevo: el egreso inverso (espejo exacto), mismo motivo obligatorio. Corre en la transacción del
 * llamador y no autoriza: quien anula el reintegro o la devolución (gerente o administrador) anula también su ingreso, sea de quien sea. Sin ingreso para ese
 * origen (se recibió sin meterlo en la caja) devuelve `anulacionId: null` y no escribe. Solo se anula con la sesión `ABIERTA` (`SESION_EN_CIERRE` /
 * `SESION_CERRADA` son los errores del dominio de caja): con la caja ya cerrada la plata no sale sola y hay que corregirla en caja. Idempotente: el espejo ya
 * anulado es `MOVIMIENTO_YA_ANULADO`, y la clave de la anulación es una por origen.
 */
export async function anularIngresoEnTx(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  entrada: EntradaDeAnularIngresoPorOrigen,
): Promise<Resultado<SalidaDeAnularIngresoPorOrigen, ErrorAlAnularIngreso>> {
  const { empresaId, ahora } = contexto;
  if (contexto.personaId === null) return err("SIN_PERMISO");
  const persona = contexto.personaId;
  if (!origenDeIngresoValido(entrada.origen)) return err("ORIGEN_INVALIDO");
  const claveDelIngreso = claveDeIngresoDe(entrada.origen);
  const original = await tx.movimientos.obtenerPorClave(empresaId, claveDelIngreso);
  if (original === null) return ok({ anulacionId: null });
  const movimiento = await tx.movimientos.obtener(empresaId, original.id);
  if (movimiento === null) throw new Error("invariante rota: un ingreso sin su movimiento");
  const espejo = decidirAnulacion({
    movimiento: movimientoAnulableDe(movimiento),
    yaAnulado: (await tx.movimientos.anulacionDe(empresaId, movimiento.id)) !== null,
    sesion: movimiento.estadoDeLaSesion,
    actor: { personaId: persona, puedeAnularDeOtros: true },
    motivo: entrada.motivo,
  });
  if (!espejo.ok) return espejo;
  const clave = claveDeAnulacionDeOrigen(claveDelIngreso);
  const huella = huellaDeAnulacion({ movimientoId: movimiento.id, motivo: espejo.valor.motivo });
  const anulacionId = await tx.movimientos.insertarSiNoExiste({
    empresa: empresaId,
    sesionId: movimiento.sesionId,
    clase: espejo.valor.clase,
    medioDePagoId: espejo.valor.medioDePagoId,
    cuentaDeCobroId: espejo.valor.cuentaDeCobroId,
    importe: espejo.valor.importe,
    motivo: espejo.valor.motivo,
    anulaA: movimiento.id,
    corrigeJornada: null,
    registradoEn: ahora,
    registradoPor: persona,
    claveDeIdempotencia: clave,
    huella,
  });
  // Otra anulación del mismo movimiento se adelantó (y esta transacción lo ve recién ahora): es una repetición, no un error de base.
  if (anulacionId === null) return err("MOVIMIENTO_YA_ANULADO");
  await dejarConstancia(tx, contexto, persona, {
    accion: "MOVIMIENTO_ANULADO",
    entidad: "movimiento_caja",
    entidadId: anulacionId,
    despues: {
      sesionId: movimiento.sesionId,
      movimientoAnuladoId: movimiento.id,
      clase: movimiento.clase,
      importe: importeATexto(espejo.valor.importe),
      motivo: espejo.valor.motivo,
      origenTipo: entrada.origen.tipo,
      origenId: entrada.origen.id,
    },
  });
  return ok({ anulacionId });
}
