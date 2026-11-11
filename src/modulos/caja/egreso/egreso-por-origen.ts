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
import { sumarImportes } from "../dominio/importes";
import { decidirMovimientoManual, egresoSuperaElEfectivo } from "../dominio/movimiento";
import type {
  EntradaDeAnularEgresoPorOrigen,
  EntradaDeEgresoPorOrigen,
  ErrorAlAnularEgreso,
  ErrorAlEgresar,
  OrigenDeEgreso,
  SalidaDeAnularEgresoPorOrigen,
  SalidaDeEgresoPorOrigen,
} from "./contrato";

/** La clave del egreso de un origen: una por origen, así repetir el pago no saca la plata dos veces. */
export function claveDeEgreso(origen: OrigenDeEgreso): string {
  return `egreso_${origen.tipo.toLowerCase()}_${origen.id}`;
}

/** La clave de la anulación de ese egreso (otra clave: la tabla de movimientos tiene una sola clave única por empresa). */
export function claveDeAnulacionDeEgreso(origen: OrigenDeEgreso): string {
  return `anulacion_${claveDeEgreso(origen)}`;
}

/**
 * Saca UN egreso de efectivo de la caja abierta (E9 T10b) en la transacción del llamador y sin autorizar (el permiso es el de la acción de compras).
 * Orden: persona del contexto, serializable (como el cobro: el cierre de la caja detecta al egreso en vuelo), validación del importe y del motivo,
 * BÚSQUEDA POR CLAVE ANTES DE MIRAR LA SESIÓN (misma clave y misma huella: lo ya hecho con `yaExistia`; otra huella: `CLAVE_REUTILIZADA`), caja
 * activa de la sucursal, sesión `ABIERTA` (sin sesión o en cierre falla cerrado con su error tipado: se puede pagar por otro medio) y jornada abierta.
 * Inserta el movimiento `EGRESO_MANUAL` en el medio efectivo y su auditoría; un egreso que supera el efectivo esperado se PERMITE y deja
 * `EGRESO_SUPERA_EFECTIVO` (misma regla que el egreso manual de caja).
 * Previene: la plata que sale de la caja dos veces por un doble clic y un pago en efectivo con la caja cerrada que no descuenta nada.
 */
export async function registrarEgresoEnTx(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  entrada: EntradaDeEgresoPorOrigen,
): Promise<Resultado<SalidaDeEgresoPorOrigen, ErrorAlEgresar>> {
  const { empresaId, ahora } = contexto;
  if (contexto.personaId === null) return err("SIN_PERMISO");
  if ((await tx.cobros.aislamientoDeLaTransaccion()) !== "serializable") {
    throw new Error("registrarEgresoEnTx solo corre en una transacción serializable");
  }
  const persona = contexto.personaId;
  const movimiento = decidirMovimientoManual({
    sentido: "EGRESO",
    importe: entrada.importe,
    motivo: entrada.motivo,
  });
  if (!movimiento.ok) return movimiento;
  const clave = claveDeEgreso(entrada.origen);
  const huella = huellaDeMovimientoManual({
    // La sesión todavía no se conoce (se busca por clave ANTES de mirarla): la huella lleva la caja, que es lo que pidió quien paga.
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
  const delEfectivo = (await tx.movimientos.paraSumar(empresaId, sesion.id)).filter(
    (m) => m.medioDePagoId === efectivo.id && m.cuentaDeCobroId === null,
  );
  const esperadoAntes = sumarImportes(delEfectivo.map((m) => m.importe));

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
  });
  if (movimientoId === null) {
    // Otro pedido con esta misma clave se adelantó (y esta transacción lo ve recién ahora): es una repetición, no un error.
    const ganadora = await tx.movimientos.obtenerHuellaPorClave(empresaId, clave);
    if (ganadora === null) {
      throw new Error("invariante rota: el egreso chocó con algo que no es su clave");
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
  if (egresoSuperaElEfectivo(esperadoAntes, movimiento.valor.importe)) {
    await dejarConstancia(tx, contexto, persona, {
      accion: "EGRESO_SUPERA_EFECTIVO",
      entidad: "movimiento_caja",
      entidadId: movimientoId,
      despues: { sesionId: sesion.id, importe: importeATexto(movimiento.valor.importe) },
    });
  }
  return ok({ movimientoId, sesionId: sesion.id, yaExistia: false });
}

/**
 * Anula el egreso de caja de un origen (E9 T10b: se anula el pago, vuelve la plata a la caja) con un registro nuevo: el espejo exacto, mismo motivo
 * obligatorio. Corre en la transacción del llamador y no autoriza: quien anula el pago (gerente o administrador) anula también su egreso, sea de quien
 * sea. Sin egreso para ese origen (el pago no salió de la caja) devuelve `anulacionId: null` y no escribe. Solo se anula con la sesión `ABIERTA`
 * (`SESION_EN_CIERRE` / `SESION_CERRADA` son los errores del dominio de caja): con la caja ya cerrada la plata no vuelve sola y hay que corregirla en caja.
 * Idempotente: el espejo ya anulado es `MOVIMIENTO_YA_ANULADO`, y la clave de la anulación es una por origen.
 */
export async function anularEgresoEnTx(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  entrada: EntradaDeAnularEgresoPorOrigen,
): Promise<Resultado<SalidaDeAnularEgresoPorOrigen, ErrorAlAnularEgreso>> {
  const { empresaId, ahora } = contexto;
  if (contexto.personaId === null) return err("SIN_PERMISO");
  const persona = contexto.personaId;
  const original = await tx.movimientos.obtenerPorClave(empresaId, claveDeEgreso(entrada.origen));
  if (original === null) return ok({ anulacionId: null });
  const movimiento = await tx.movimientos.obtener(empresaId, original.id);
  if (movimiento === null) throw new Error("invariante rota: un egreso sin su movimiento");
  const espejo = decidirAnulacion({
    movimiento: movimientoAnulableDe(movimiento),
    yaAnulado: (await tx.movimientos.anulacionDe(empresaId, movimiento.id)) !== null,
    sesion: movimiento.estadoDeLaSesion,
    actor: { personaId: persona, puedeAnularDeOtros: true },
    motivo: entrada.motivo,
  });
  if (!espejo.ok) return espejo;
  const clave = claveDeAnulacionDeEgreso(entrada.origen);
  const huella = huellaDeAnulacion({ movimientoId: movimiento.id, motivo: espejo.valor.motivo });
  const anulacionId = await tx.movimientos.insertar({
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
