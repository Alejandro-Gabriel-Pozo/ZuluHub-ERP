import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { jornadaDeSucursal } from "../../cierre/publico";
import { dejarConstancia } from "../casos-de-uso/comun";
import type { TxDeCaja } from "../casos-de-uso/contrato";
import { armarCobro, decidirCajaParaCobrar, decidirSesionParaCobrar } from "../dominio/cobrar";
import type { MedioDePago } from "../dominio/configuracion";
import { datosCompletados, validarDatosDelCobro } from "../dominio/datos-del-cobro";
import { decidirPorHuella } from "../dominio/huella";
import { jornadaVencida } from "../dominio/jornada-de-caja";
import { validarParDeCobro } from "../dominio/medios";
import type { EntradaDeRegistrarCobro, ErrorAlCobrar, SalidaDeRegistrarCobro } from "./contrato";

/**
 * Escribe UN cobro en la sesión abierta de la caja (e3 §3.5), en la transacción del llamador y sin autorizar (el permiso es el de la acción de
 * ventas). El orden es el de la especificación:
 *  1. valida la entrada (origen, importe > 0 y ≤ tope, identificadores) y arma la clave `cobro_<origen.id>_<orden>` y la huella;
 *  2. BUSCA POR CLAVE ANTES DE MIRAR LA SESIÓN: misma clave y misma huella → lo ya hecho con `yaExistia`, sin escribir ni auditar (un
 *     reintento tras cerrar la caja o la jornada devuelve lo mismo, no `SIN_SESION_ABIERTA`); misma clave y otra huella → `CLAVE_REUTILIZADA`;
 *  3. la caja (existe, activa, de la sucursal pedida) y su sesión `ABIERTA`, tomada con `FOR SHARE`: el cierre espera a los cobros en vuelo y
 *     el cobro que llega después ve `EN_CIERRE` o `CERRADA` y no escribe; la jornada de la sesión tiene que seguir `ABIERTA`;
 *  4. medio activo y compatible con la cuenta (e3 §3.3); cada dato presente habilitado por el medio y bien escrito (e3 §3.6);
 *  5. inserta el movimiento `COBRO`, su fila de `cobro` y la auditoría `COBRO_REGISTRADO` (más `COBRO_EN_JORNADA_VENCIDA` si la sesión sigue
 *     abierta después de su jornada). La auditoría lleva SOLO la lista de datos completados, nunca sus valores, ni la clave ni la huella;
 *  6. devuelve la `fechaDeNegocio` de la SESIÓN.
 * Solo corre en una transacción SERIALIZABLE (si no, lanza antes de escribir): el cierre de la caja (serializable) detecta al cobro en vuelo por
 * la dependencia de lectura-escritura entre los dos; un cobro en `read committed` no deja esa huella y el cierre podría confirmar un arqueo
 * armado antes de que el cobro confirmara (la falla de Motor2 por otro camino). Chequeo: `caja-cobrar-casos.test.ts`.
 * Idempotente por sí mismo: no puede repetirse solo (corre en la transacción de otro), así que el alta del movimiento es
 * `ON CONFLICT DO NOTHING` y, si otro pedido idéntico se adelantó (lo vio recién ahora), se relee por clave. Bajo `SERIALIZABLE`, un choque con
 * un cobro que esta transacción no ve aborta por serialización y el adaptador repite todo: la segunda vuelta ya lo encuentra.
 * Previene: dos cobros simultáneos del mismo `(origen, orden)` que dejen un error de unicidad en vez de «ya existía», un cobro en una caja que
 * se cierra, y el efectivo (o la tarjeta) cobrado dos veces por un doble clic. Chequeos: `test/integracion/caja-cobrar-*.test.ts`.
 */
export async function registrarCobroEnTx(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  entrada: EntradaDeRegistrarCobro,
): Promise<Resultado<SalidaDeRegistrarCobro, ErrorAlCobrar>> {
  const { empresaId, ahora } = contexto;
  // Sin persona no hay `registrado_por` que la base acepte ni quién deje constancia.
  if (contexto.personaId === null) return err("SIN_PERMISO");
  // Defecto del llamador, no un error de negocio: se aborta todo antes de escribir.
  if ((await tx.cobros.aislamientoDeLaTransaccion()) !== "serializable") {
    throw new Error("registrarCobroEnTx solo corre en una transacción serializable");
  }
  const persona = contexto.personaId;

  const armado = armarCobro(entrada);
  if (!armado.ok) return armado;
  const { clave, huella, datos } = armado.valor;

  /** Lo que devuelve un cobro que ya estaba hecho con esta clave: lo mismo que la primera vez, sin escribir. */
  const yaHecho = async (
    previa: Readonly<{ id: string; sesionId: string; huella: string | null }>,
  ): Promise<Resultado<SalidaDeRegistrarCobro, ErrorAlCobrar>> => {
    if (decidirPorHuella(previa.huella, huella) === "CLAVE_REUTILIZADA") {
      return err("CLAVE_REUTILIZADA");
    }
    const sesion = await tx.sesiones.obtener(empresaId, previa.sesionId);
    if (sesion === null) throw new Error("invariante rota: un cobro sin su sesión");
    const vencida = jornadaVencida(ahora, sesion, sesion.fechaDeNegocio);
    if (!vencida.ok) return vencida;
    return ok({
      cobroId: previa.id,
      sesionId: sesion.id,
      fechaDeNegocio: sesion.fechaDeNegocio,
      jornadaVencida: vencida.valor,
      yaExistia: true,
    });
  };

  const previa = await tx.movimientos.obtenerHuellaPorClave(empresaId, clave);
  if (previa !== null) return yaHecho(previa);

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

  const medio = await tx.mediosDePago.obtener(empresaId, entrada.medioDePagoId);
  const cuenta =
    entrada.cuentaDeCobroId === null
      ? null
      : await tx.cuentasDeCobro.obtener(empresaId, entrada.cuentaDeCobroId);
  const par = validarParDeCobro({
    medio,
    cuentaDeCobroId: entrada.cuentaDeCobroId,
    cuenta,
    sucursalDeLaCaja: sesion.sucursalId,
  });
  if (!par.ok) return par;
  const validos = validarDatosDelCobro(entrada.datos, (medio as MedioDePago).pide);
  if (!validos.ok) return validos;
  if (datos.marcaDeTarjetaId !== null && !(await tx.cobros.esMarcaActiva(datos.marcaDeTarjetaId))) {
    return err({ codigo: "DATO_DE_COBRO_INVALIDO", dato: "marca", motivo: "NO_DISPONIBLE" });
  }

  const vencida = jornadaVencida(ahora, sesion, sesion.fechaDeNegocio);
  if (!vencida.ok) return vencida;

  const cobroId = await tx.movimientos.insertarSiNoExiste({
    empresa: empresaId,
    sesionId: sesion.id,
    clase: "COBRO",
    medioDePagoId: entrada.medioDePagoId,
    cuentaDeCobroId: entrada.cuentaDeCobroId,
    importe: entrada.importe,
    motivo: null,
    anulaA: null,
    corrigeJornada: null,
    registradoEn: ahora,
    registradoPor: persona,
    claveDeIdempotencia: clave,
    huella,
  });
  if (cobroId === null) {
    // Otro pedido con esta misma clave se adelantó (y esta transacción lo ve recién ahora): es una repetición, no un error.
    const ganadora = await tx.movimientos.obtenerHuellaPorClave(empresaId, clave);
    if (ganadora === null) {
      throw new Error("invariante rota: el alta del cobro chocó con algo que no es su clave");
    }
    return yaHecho(ganadora);
  }
  const insertado = await tx.cobros.insertar({
    empresa: empresaId,
    movimientoId: cobroId,
    origen: entrada.origen,
    origenOrden: entrada.origenOrden,
    datos,
  });
  if (!insertado) {
    // Imposible sin chocar antes la clave del movimiento (se arma con el mismo origen y orden): se aborta todo antes que dejar un cobro sin fila.
    throw new Error("invariante rota: el origen ya tenía su cobro con otra clave");
  }

  await dejarConstancia(tx, contexto, persona, {
    accion: "COBRO_REGISTRADO",
    entidad: "movimiento_caja",
    entidadId: cobroId,
    despues: {
      sesionId: sesion.id,
      cajaId: entrada.cajaId,
      fechaDeNegocio: sesion.fechaDeNegocio,
      importe: importeATexto(entrada.importe),
      medioDePagoId: entrada.medioDePagoId,
      cuentaDeCobroId: entrada.cuentaDeCobroId,
      origenTipo: entrada.origen.tipo,
      origenId: entrada.origen.id,
      origenOrden: entrada.origenOrden,
      // Qué datos se completaron, nunca su valor (el DNI, el cupón y los últimos 4 no van a la auditoría).
      datosCompletados: [...datosCompletados(entrada.datos)],
    },
  });
  if (vencida.valor) {
    await dejarConstancia(tx, contexto, persona, {
      accion: "COBRO_EN_JORNADA_VENCIDA",
      entidad: "movimiento_caja",
      entidadId: cobroId,
      despues: { sesionId: sesion.id, fechaDeNegocio: sesion.fechaDeNegocio },
    });
  }
  return ok({
    cobroId,
    sesionId: sesion.id,
    fechaDeNegocio: sesion.fechaDeNegocio,
    jornadaVencida: vencida.valor,
    yaExistia: false,
  });
}
