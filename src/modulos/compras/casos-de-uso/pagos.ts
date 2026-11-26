import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { decidirPorHuella, huellaDeComando } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import {
  camposDeHuellaDePago,
  esClasePagable,
  leerPagoConMedios,
  leerSalidaDeCaja,
  netoAPagar,
  resolverLosMedios,
  type LineaDePago,
} from "../dominio/pago";
import { motivoDeAnulacionDesdeTexto } from "../dominio/registrar-compra";
import { anularElPagoDeLaFactura, asentarElPagoDeLaFactura } from "./cargo-de-la-factura";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeDeclararPago = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia del pago. */
  clave: string;
  comprobanteId: string;
  /** Fecha civil `YYYY-MM-DD`, no futura (el «hoy» de Argentina). */
  fechaDePago: string;
  /** Un solo medio por el total de la factura. O este, o `medios`: las dos cosas juntas no se admiten. */
  medio?: string;
  /** Varios medios, cada uno con su importe (texto decimal): la suma tiene que ser lo que hay que pagar de la factura (su neto, total menos notas de crédito), que el servidor lee bajo el bloqueo (`LA_SUMA_DE_LOS_MEDIOS_NO_ES_EL_TOTAL`). Un medio de cada tipo (DEC-1280). */
  medios?: readonly Readonly<{ medio: string; importe: string }>[];
  /**
   * Solo con un medio `EFECTIVO`, y con él es OBLIGATORIA: la plata de la línea en efectivo (no la del total) sale de esta caja abierta en la misma transacción (T10b; dueño, 16/11/2026, 3A). Sin ella, un pago con efectivo no se declara
   * (`SALIDA_DE_CAJA_INVALIDA`); sin efectivo no se admite. Sin sesión abierta en esa caja, el pago NO se declara (falla con su código) y se puede volver a pedir por otro medio.
   */
  salidaDeCaja?: Readonly<{ cajaId: string; motivo: string }>;
}>;
export type SalidaDeDeclararPago = Readonly<{ pagoId: string; yaExistia: boolean }>;

/**
 * La sucursal de un comprobante, por la recepción a la que apuntan sus líneas: el alcance de sucursales de quien paga o anula tiene que incluirla. Un
 * comprobante que no apunta a ninguna recepción (no lo hay en N1 y N2) exige alcance sobre TODAS y no tiene sucursal (`null`).
 */
async function exigirAlcanceDelComprobante(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Resultado<string | null, "SUCURSAL_FUERA_DE_ALCANCE">> {
  const recepcionId = await tx.comprobantesDeProveedor.recepcionIdDe(
    contexto.empresaId,
    comprobanteId,
  );
  const recepcion =
    recepcionId === null ? null : await tx.recepciones.obtener(contexto.empresaId, recepcionId);
  if (recepcion === null) {
    return (await tx.autorizacion.sucursalesDelActor(contexto)) === "TODAS"
      ? ok(null)
      : err("SUCURSAL_FUERA_DE_ALCANCE");
  }
  const alcance = await exigirAlcanceDeSucursal(tx, contexto, sucursalId(recepcion.sucursalId));
  return alcance.ok ? ok(recepcion.sucursalId) : alcance;
}

/** Lo que paga la línea en efectivo (la única que mueve la caja); con `salidaDeCaja` hay una. */
const efectivo = (lineas: readonly LineaDePago[]): string =>
  lineas.find((l) => l.medio === "EFECTIVO")?.importe ?? "0.00";

/**
 * Declarar el pago de una factura (E9 §3.6, D142): cuándo y con qué medio o medios. El importe es el NETO de la factura (su total menos lo que acreditan sus notas de crédito vigentes; sin notas, el total que dice el papel) y se copia en el pago:
 * un pago por factura, sin parciales; con varios medios, cada uno con su importe y la suma exacta es el neto (DEC-1280); si el neto es cero, `NADA_PARA_PAGAR`. Con `salidaDeCaja` (solo si hay una línea en efectivo) la plata de esa línea sale de la caja abierta indicada, en la misma transacción (DEC-0316). Guard `comprobantes_de_proveedor.pagar` (gerente y administrador). El comprobante se bloquea: dos pagos a
 * la vez de la misma factura dejan uno (el otro, `COMPROBANTE_YA_PAGADO` con el id del vigente). Repetición (`CLAVE_DE_IDEMPOTENCIA`): misma clave y mismo
 * contenido devuelve el pago con `yaExistia` sin escribir ni auditar; misma clave y otro contenido, `CLAVE_REUTILIZADA`.
 */
export function armarDeclararPago(dependencias: DependenciasDeCompras) {
  return async function declararPago(
    contexto: ContextoOperativo,
    entrada: EntradaDeDeclararPago,
  ): Promise<R<SalidaDeDeclararPago>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave) || !esUuid(entrada.comprobanteId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const pago = leerPagoConMedios(entrada, contexto.ahora);
    if (!pago.ok) return pago;
    const hayEfectivo = pago.valor.medios.some((m) => m.medio === "EFECTIVO");
    const salida = leerSalidaDeCaja(entrada.salidaDeCaja, hayEfectivo ? "EFECTIVO" : "OTRO");
    if (!salida.ok) return salida;
    // El efectivo siempre sale de una caja abierta (dueño, 16/11/2026, 3A): un pago con una línea en efectivo sin caja no se declara. Previene: plata que sale sin que ninguna caja lo sepa (el pago quedaría declarado y la caja, sin
    // descontar). Chequeo: `test/integracion/compras-pagos-caja.test.ts`.
    if (hayEfectivo && salida.valor === null) return err("SALIDA_DE_CAJA_INVALIDA");
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeDeclararPago>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "comprobantes_de_proveedor.pagar",
          ]);
          if (!permiso.ok) return permiso;
          const comprobante = await tx.comprobantesDeProveedor.bloquear(
            empresaId,
            entrada.comprobanteId,
          );
          if (comprobante === null) return err("COMPROBANTE_NO_ENCONTRADO");
          const alcance = await exigirAlcanceDelComprobante(tx, contexto, comprobante.id);
          if (!alcance.ok) return alcance;
          const huella = huellaDeComando(
            "declarar_pago",
            [comprobante.id, ...camposDeHuellaDePago(pago.valor, salida.valor)],
            [],
          );
          const previa = await tx.pagosDeProveedor.porClave(empresaId, entrada.clave);
          if (previa !== null) {
            return decidirPorHuella(previa.huella, huella) === "REPETIDA"
              ? ok({ pagoId: previa.id, yaExistia: true })
              : err("CLAVE_REUTILIZADA");
          }
          if (comprobante.estado === "ANULADO") return err("COMPROBANTE_ANULADO");
          if (!esClasePagable(comprobante.clase)) return err("COMPROBANTE_NO_PAGABLE");
          const vigente = await tx.pagosDeProveedor.vigenteDe(empresaId, comprobante.id);
          if (vigente !== null) return err({ error: "COMPROBANTE_YA_PAGADO", pagoId: vigente.id });
          // Lo que se paga es el NETO de la factura (total − notas de crédito vigentes), leído acá, bajo el bloqueo de la factura (que las notas también toman al cargarse): la suma de los medios se compara con él y no con nada
          // que mande el navegador. Sin nada para pagar (las notas lo acreditan todo) no hay pago, ni salida de caja, ni asiento. Previene: pagar de más lo que el proveedor ya acreditó. Chequeo: `test/integracion/compras-pago-por-el-neto.test.ts`.
          const acreditado = await tx.notasDeCredito.acreditadoDe(empresaId, comprobante.id);
          const aPagar = netoAPagar(comprobante.totalSegunFactura, acreditado);
          if (aPagar === null) return err("NADA_PARA_PAGAR");
          const lineas = resolverLosMedios(pago.valor.medios, aPagar);
          if (!lineas.ok) return lineas;
          const pagoId = await tx.pagosDeProveedor.insertar(empresaId, {
            comprobanteId: comprobante.id,
            fechaDePago: pago.valor.fechaDePago,
            medios: lineas.valor,
            importe: aPagar,
            clave: entrada.clave,
            huella,
            registradoPor: persona,
          });
          if (pagoId === undefined) {
            throw new Error(
              "el pago chocó con una restricción única que no es la clave ni el pago vigente",
            );
          }
          if (salida.valor !== null) {
            // Con salida de caja el alcance siempre trae sucursal: el comprobante sin recepción exige alcance sobre todas y no tiene a qué caja apuntar.
            if (alcance.valor === null) return err("CAJA_DE_OTRA_SUCURSAL");
            const egreso = await dependencias.egresoDeCaja.registrar(tx, contexto, {
              cajaId: salida.valor.cajaId,
              sucursalId: alcance.valor,
              pagoId,
              importe: efectivo(lineas.valor),
              motivo: salida.valor.motivo,
            });
            if (!egreso.ok) return err(egreso.error);
          }
          // Al final: el pago en el libro, después de bloquear el comprobante (ver `asentarElPagoDeLaFactura`).
          const enElLibro = await asentarElPagoDeLaFactura(tx, contexto, dependencias, {
            pagoId,
            comprobanteId: comprobante.id,
            importe: aPagar,
          });
          if (!enElLibro.ok) return enElLibro;
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "PAGO_DECLARADO",
            entidad: "pago_de_comprobante",
            entidadId: pagoId,
            despues: {
              comprobanteId: comprobante.id,
              fechaDePago: pago.valor.fechaDePago,
              medios: lineas.valor,
              importe: aPagar,
              totalDeLaFactura: comprobante.totalSegunFactura,
              acreditado,
              salidaDeCajaId: salida.valor?.cajaId ?? null,
            },
          });
          return ok({ pagoId, yaExistia: false });
        },
      ),
    );
  };
}

export type EntradaDeAnularPago = Readonly<{ pagoId: string; motivo: string }>;
export type SalidaDeAnularPago = Readonly<{ anulado: true }>;

/**
 * Anular un pago (E9 §3.6): el pago queda `ANULADO` con quién, cuándo y por qué (nada se borra) y después se puede declarar otro. Guard
 * `comprobantes_de_proveedor.anular_pago`. Si el pago había sacado efectivo de la caja, la anulación lo devuelve con un registro nuevo de caja en la misma transacción (si la caja
 * ya no está abierta, `EGRESO_DE_CAJA_NO_ANULABLE` o el error de su sesión y nada se anula: se corrige en caja). Repetición (`RECHAZA_LA_REPETICION`): anular un pago ya anulado es `PAGO_YA_ANULADO` y no escribe nada; el estado
 * bajo bloqueo decide, así que dos anulaciones a la vez dejan una sola.
 */
export function armarAnularPago(dependencias: DependenciasDeCompras) {
  return async function anularPago(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularPago,
  ): Promise<R<SalidaDeAnularPago>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    if (!esUuid(entrada.pagoId)) return err("PAGO_NO_ENCONTRADO");
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeAnularPago>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "comprobantes_de_proveedor.anular_pago",
          ]);
          if (!permiso.ok) return permiso;
          // Orden de bloqueo: comprobante, pago, parte (documentado en `cargo-de-la-factura.ts`).
          const sinBloquear = await tx.pagosDeProveedor.obtener(empresaId, entrada.pagoId);
          if (sinBloquear === null) return err("PAGO_NO_ENCONTRADO");
          const factura = await tx.comprobantesDeProveedor.bloquear(
            empresaId,
            sinBloquear.comprobanteId,
          );
          if (factura === null) return err("COMPROBANTE_NO_ENCONTRADO");
          const pago = await tx.pagosDeProveedor.bloquear(empresaId, entrada.pagoId);
          if (pago === null) return err("PAGO_NO_ENCONTRADO");
          const alcance = await exigirAlcanceDelComprobante(tx, contexto, pago.comprobanteId);
          if (!alcance.ok) return alcance;
          if (pago.estado === "ANULADO") return err("PAGO_YA_ANULADO");
          const hecho = await tx.pagosDeProveedor.anular(empresaId, pago.id, {
            por: persona,
            en: contexto.ahora,
            motivo: motivo.valor,
          });
          if (!hecho) throw new Error("el pago ya no estaba vigente bajo bloqueo");
          const devuelto = await dependencias.egresoDeCaja.anular(tx, contexto, {
            pagoId: pago.id,
            motivo: motivo.valor,
          });
          if (!devuelto.ok) return err(devuelto.error);
          const enElLibro = await anularElPagoDeLaFactura(tx, contexto, dependencias, pago.id);
          if (!enElLibro.ok) return enElLibro;
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "PAGO_ANULADO",
            entidad: "pago_de_comprobante",
            entidadId: pago.id,
            antes: { estado: "VIGENTE" },
            despues: { estado: "ANULADO", motivo: motivo.valor },
          });
          return ok({ anulado: true });
        },
      ),
    );
  };
}
