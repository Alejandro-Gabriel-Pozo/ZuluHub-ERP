import type { ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../contexto/contexto";
import { ErrorDeValor } from "../primitivas/cantidad/errores";
import { cantidadDesdeTexto } from "../primitivas/cantidad/cantidad";
import { importeDesdeTexto } from "../primitivas/dinero/importe";
import { ARS } from "../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../primitivas/dinero/precio-unitario";
import { sucursalId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { CODIGOS_DE_ALICUOTA, puntoDeVentaId } from "../modulos/fiscal/publico";
import {
  emitirFacturaDeOrigenEnTx,
  vigenciaDeComprobantesEnTx,
  type EntradaDeFacturaDeOrigen,
  type RenglonDeOrigen,
} from "../modulos/fiscal/publico";
import type {
  EntradaDeFacturaDeTicket,
  ErrorDelFacturador,
  FacturadorDeTickets,
  RenglonDeFactura,
} from "../modulos/ventas/publico";
import type { TxDeApp } from "./conexiones";
import { receptorDeEntrada } from "./entradas-de-facturacion";
import { comprobanteId as comprobanteIdDeFiscal } from "../modulos/fiscal/publico";

/**
 * El adaptador que une ventas y fiscal (E1 §3.4; R-1): la composición es el ÚNICO lugar donde se tocan los dos módulos. Traduce los tipos del puerto
 * de ventas (`FacturadorDeTickets`, texto y símbolos) a los de fiscal (cantidades, importes, receptor) y llama a SUS cuerpos de transacción con la
 * MISMA `tx`: la `TxDeApp` ya compone los repositorios de ventas y de fiscal sobre la misma conexión, así la factura, su trabajo de validación, su
 * auditoría y el puntero de ventas son todo o nada. A ARCA no se envía nada acá: fiscal solo encola.
 *
 * Fiscal vuelve a pedir su guard adentro (`comprobantes.emitir`, `comprobantes.ver`): quien llama no es de fiar. Un error de fiscal sale tal cual como
 * `ErrorDelFacturador` (la web lo traduce con `aRespuestaFiscal`); un dato que no se puede convertir (no debería pasar: viene de ventas) sale como
 * `DATO_DE_FACTURA_INVALIDO`.
 */

/**
 * La transacción que recibe el puerto es la de ventas; en la composición es SIEMPRE la `TxDeApp` (lo comprueba `tipos-tx.test.ts`: contiene la de
 * ventas y la de fiscal). Si alguien arma el puerto con otra transacción sin los repositorios de fiscal, falla cerrado en vez de facturar a medias.
 */
function comoTxDeApp(tx: object): TxDeApp {
  if (!("comprobantes" in tx) || !("puntosDeVenta" in tx) || !("lecturas" in tx)) {
    throw new Error(
      "facturar un ticket necesita la transacción compuesta con los repositorios de fiscal",
    );
  }
  return tx as TxDeApp;
}

function aRenglon(r: RenglonDeFactura): Resultado<RenglonDeOrigen, "DATO_DE_FACTURA_INVALIDO"> {
  if (!(CODIGOS_DE_ALICUOTA as readonly string[]).includes(r.alicuota)) {
    return err("DATO_DE_FACTURA_INVALIDO");
  }
  try {
    return ok({
      descripcion: r.descripcion,
      cantidad: cantidadDesdeTexto(r.cantidad),
      unidad: r.unidad,
      precioUnitario: precioUnitarioDesdeTexto(r.precioUnitario),
      alicuota: r.alicuota as RenglonDeOrigen["alicuota"],
    });
  } catch (error) {
    if (error instanceof ErrorDeValor) return err("DATO_DE_FACTURA_INVALIDO");
    throw error;
  }
}

function aEntradaDeFiscal(
  entrada: EntradaDeFacturaDeTicket,
): Resultado<EntradaDeFacturaDeOrigen, ErrorDelFacturador> {
  const receptor = receptorDeEntrada(entrada.receptor);
  if (!receptor.ok) return err({ codigo: "RECEPTOR_INVALIDO" });
  const renglones: RenglonDeOrigen[] = [];
  for (const r of entrada.renglones) {
    const convertido = aRenglon(r);
    if (!convertido.ok) return convertido;
    renglones.push(convertido.valor);
  }
  let total;
  try {
    total = importeDesdeTexto(ARS, entrada.totalEsperado);
  } catch (error) {
    if (error instanceof ErrorDeValor) return err("DATO_DE_FACTURA_INVALIDO");
    throw error;
  }
  return ok({
    origen: entrada.origen,
    comprobanteId: entrada.comprobanteId,
    puntoDeVentaId: puntoDeVentaId(entrada.puntoDeVentaId),
    sucursalEsperadaId: sucursalId(entrada.sucursalId),
    receptor: receptor.valor,
    renglones,
    totalEsperado: total,
  });
}

export function crearFacturadorDeTickets(reglas: ReglasDeEmpresa): FacturadorDeTickets<object> {
  const conPersona = (contexto: ContextoOperativo) => {
    const { personaId } = contexto;
    if (personaId === null)
      throw new RangeError("facturar un ticket exige una persona: un trabajo de sistema no emite");
    return { ...contexto, personaId };
  };
  return {
    async emitirEnTx(tx, contexto, entrada) {
      const deFiscal = aEntradaDeFiscal(entrada);
      if (!deFiscal.ok) return deFiscal;
      const r = await emitirFacturaDeOrigenEnTx(
        comoTxDeApp(tx),
        conPersona(contexto),
        deFiscal.valor,
        reglas,
      );
      if (!r.ok) return err(r.error as ErrorDelFacturador);
      return ok({
        comprobanteId: r.valor.comprobanteId,
        estado: r.valor.estado,
        yaExistia: r.valor.yaExistia,
      });
    },

    async vigenciaEnTx(tx, contexto, ids) {
      const r = await vigenciaDeComprobantesEnTx(
        comoTxDeApp(tx),
        contexto,
        { comprobanteIds: ids.map((id) => comprobanteIdDeFiscal(id)) },
        reglas,
      );
      if (!r.ok) return err(r.error);
      return ok(
        r.valor.map((v) => ({
          comprobanteId: v.comprobanteId,
          vigente: v.vigente,
          motivoNoVigente: v.motivoNoVigente,
        })),
      );
    },
  };
}
