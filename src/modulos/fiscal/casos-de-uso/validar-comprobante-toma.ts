import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import type { EstadoDeComprobanteArca } from "../dominio/estados-de-comprobante";
import { solicitudId, type ComprobanteId } from "../dominio/identificadores";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import type { ContextoDeSistema } from "./contrato";
import type { DependenciasDeFacturacion, OpcionesDeFacturacion } from "./contrato-de-facturacion";
import type { PuntoDeVentaParaEmision } from "./emision-electronica";
import { reservarEnTx, type ErrorPropioAlReservar } from "./numeracion-en-tx";

/**
 * TXa del trabajo `fiscal.validar_comprobante` (paso 1 de `validar-comprobante.ts`): tomar el comprobante
 * `PENDIENTE` y reservar su número en UNA transacción. Vive aparte para que el caso de uso quede legible;
 * el orden de las operaciones y la auditoría son los mismos.
 */

export type Toma =
  | Readonly<{ tipo: "NADA"; estado: EstadoDeComprobanteArca }>
  | Readonly<{ tipo: "OCUPADA" | "BLOQUEADA" }>
  | Readonly<{
      tipo: "FALTA_LA_SERIE";
      puntoDeVenta: PuntoDeVentaParaEmision;
      comprobante: ComprobanteGuardado;
    }>
  | Readonly<{
      tipo: "RESERVADO";
      comprobante: ComprobanteGuardado;
      puntoDeVenta: PuntoDeVentaParaEmision;
    }>;

export type ErrorDeToma =
  | "COMPROBANTE_NO_ENCONTRADO"
  | Exclude<ErrorPropioAlReservar, "SERIE_OCUPADA" | "SERIE_BLOQUEADA">
  | EmpresaNoOpera;

export function tomarYReservar(
  transacciones: DependenciasDeFacturacion["transacciones"],
  contexto: ContextoDeSistema,
  entrada: Readonly<{ comprobanteId: ComprobanteId }>,
  opciones: OpcionesDeFacturacion,
  ultimoDelServicio: bigint | null,
) {
  const { empresaId } = contexto;
  return transacciones.ejecutar({ contexto }, async (tx): Promise<Resultado<Toma, ErrorDeToma>> => {
    const c = await tx.comprobantes.obtener(empresaId, entrada.comprobanteId);
    if (c === null) return err("COMPROBANTE_NO_ENCONTRADO");
    if (c.estado !== "PENDIENTE") return ok({ tipo: "NADA", estado: c.estado });
    const reserva = await reservarEnTx(
      tx,
      contexto,
      {
        puntoDeVentaId: c.puntoDeVentaId,
        tipo: c.tipo,
        ambiente: c.ambiente,
        solicitud: solicitudId(c.id),
      },
      ultimoDelServicio,
      opciones.numeracion,
    );
    if (!reserva.ok) {
      if (reserva.error === "SERIE_OCUPADA") return ok({ tipo: "OCUPADA" });
      if (reserva.error === "SERIE_BLOQUEADA") return ok({ tipo: "BLOQUEADA" });
      return err(reserva.error);
    }
    if (reserva.valor.tipo === "FALTA_LA_SERIE") {
      return ok({
        tipo: "FALTA_LA_SERIE",
        puntoDeVenta: reserva.valor.puntoDeVenta,
        comprobante: c,
      });
    }
    const { numero, puntoDeVenta } = reserva.valor.salida;
    // `reservarEnTx` ya comprobó que la empresa opera: es visible.
    const empresa = await tx.empresas.obtener(empresaId);
    if (empresa === null) throw new Error(`la empresa ${empresaId} no es visible`);
    // La fecha del comprobante es el día civil de la empresa AL RESERVAR (§B.3.6).
    const fecha = fechaDeNegocio(contexto.ahora, empresa.zonaHoraria, "00:00");
    if (!fecha.ok) throw new RangeError(`no hay fecha del comprobante: ${fecha.error}`);
    const movido = await tx.comprobantes.transicionar(empresaId, c.id, c.version, {
      a: "EN_VALIDACION",
      numeroReservado: numero,
      fechaEmision: fecha.valor,
    });
    if (movido === null) throw new Error("el comprobante cambió dentro de la transacción");
    await tx.auditoria.registrar({
      empresaId,
      actorPersonaId: null,
      accion: "COMPROBANTE_EN_VALIDACION",
      entidad: "comprobante",
      entidadId: c.id,
      antes: { estado: c.estado },
      despues: {
        estado: movido.estado,
        numero: numero.toString(),
        fecha: fecha.valor,
        envio: movido.envios,
      },
    });
    return ok({ tipo: "RESERVADO", comprobante: movido, puntoDeVenta });
  });
}
