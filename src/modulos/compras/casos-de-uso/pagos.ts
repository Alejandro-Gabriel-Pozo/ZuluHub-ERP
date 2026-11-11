import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { decidirPorHuella, huellaDeComando } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { camposDeHuellaDePago, esClasePagable, leerPago } from "../dominio/pago";
import { motivoDeAnulacionDesdeTexto } from "../dominio/registrar-compra";
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
  medio: string;
}>;
export type SalidaDeDeclararPago = Readonly<{ pagoId: string; yaExistia: boolean }>;

/**
 * La sucursal de un comprobante, por la recepción a la que apuntan sus líneas: el alcance de sucursales de quien paga o anula tiene que incluirla. Un
 * comprobante que no apunta a ninguna recepción (no lo hay en N1 y N2) exige alcance sobre TODAS.
 */
async function exigirAlcanceDelComprobante(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Resultado<null, "SUCURSAL_FUERA_DE_ALCANCE">> {
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
  return exigirAlcanceDeSucursal(tx, contexto, sucursalId(recepcion.sucursalId));
}

/**
 * Declarar el pago de una factura (E9 §3.6, D142): cuándo y con qué medio. El importe es el total de la factura (el que dice el papel) y se copia en el pago:
 * un pago por factura, sin parciales. NO mueve la caja. Guard `comprobantes_de_proveedor.pagar` (gerente y administrador). El comprobante se bloquea: dos pagos a
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
    const pago = leerPago(entrada, contexto.ahora);
    if (!pago.ok) return pago;
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
            [comprobante.id, ...camposDeHuellaDePago(pago.valor, comprobante.totalSegunFactura)],
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
          const pagoId = await tx.pagosDeProveedor.insertar(empresaId, {
            comprobanteId: comprobante.id,
            fechaDePago: pago.valor.fechaDePago,
            medio: pago.valor.medio,
            importe: comprobante.totalSegunFactura,
            clave: entrada.clave,
            huella,
            registradoPor: persona,
          });
          if (pagoId === undefined) {
            throw new Error(
              "el pago chocó con una restricción única que no es la clave ni el pago vigente",
            );
          }
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "PAGO_DECLARADO",
            entidad: "pago_de_comprobante",
            entidadId: pagoId,
            despues: {
              comprobanteId: comprobante.id,
              fechaDePago: pago.valor.fechaDePago,
              medio: pago.valor.medio,
              importe: comprobante.totalSegunFactura,
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
 * `comprobantes_de_proveedor.anular_pago`. Repetición (`RECHAZA_LA_REPETICION`): anular un pago ya anulado es `PAGO_YA_ANULADO` y no escribe nada; el estado
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
