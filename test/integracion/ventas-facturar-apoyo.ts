import { randomUUID } from "node:crypto";
import type { ComprobanteId } from "../../src/modulos/fiscal/publico";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { renglon } from "../utilidades/facturacion";
import { comoEmpresa } from "./entorno";
import {
  RelojDePrueba,
  cargarCertificado,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  notaManual,
} from "./facturacion-casos-apoyo";
import {
  crearEscenario as crearEscenarioDeFacturacion,
  type Escenario as EscenarioFiscal,
} from "./facturacion-apoyo";
import {
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";
import { crearPuntoDeVenta } from "./fiscal-apoyo";

/**
 * Apoyo de E1-T3 (facturar un ticket): una empresa de ventas con todo lo fiscal armado (emisor RI con datos confirmados, un punto de venta
 * ACTIVO en cada sucursal y un certificado vigente) y un ticket COBRADO por el camino real (`venderYCobrar`). ARCA no se toca: emitir solo encola.
 */
export type EscenarioDeFacturacionDeTickets = EscenarioDeVentas &
  Readonly<{
    fiscal: EscenarioFiscal;
    /** El punto de venta de la sucursal principal y el de la otra. */
    pv: string;
    pvDeOtraSucursal: string;
  }>;

export async function escenarioFacturable(
  m: MundoDeVentas,
): Promise<EscenarioDeFacturacionDeTickets> {
  const e = await m.escenario();
  const { rows } = await m.dueno.query<{ tenant_id: string; cuit: string; emisor: string }>(
    `select e.tenant_id, e.cuit, em.id as emisor from empresa e
       join emisor em on em.empresa_id = e.id and em.es_principal where e.id = $1`,
    [e.empresa],
  );
  const fila = rows[0];
  if (fila === undefined) throw new Error("la empresa de prueba no tiene emisor principal");
  const persona = e.gerente.personaId;
  if (persona === null) throw new Error("el gerente de prueba no tiene persona");
  const mundo = {
    tenant: fila.tenant_id,
    empresa: e.empresa,
    cuit: fila.cuit,
    sucursal: e.sucursal as string,
    persona,
    emisor: fila.emisor,
  };
  const fiscal = await crearEscenarioDeFacturacion(m.dueno, { mundo });
  await cargarCertificado(m.propia.base, fiscal, "HOMOLOGACION");
  const pvDeOtraSucursal = await crearPuntoDeVenta(m.dueno, mundo, {
    numero: 2,
    sucursal: e.otraSucursal,
    activo: true,
  });
  return { ...e, fiscal, pv: fiscal.pv, pvDeOtraSucursal };
}

export type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;

/** Un ticket de mostrador COBRADO en efectivo: `cantidad` unidades del producto de $1000. */
export async function ticketCobrado(
  m: MundoDeVentas,
  e: EscenarioDeVentas,
  caja: Caja,
  cantidad = "1",
): Promise<{ ticketId: string; total: string }> {
  const total = (1000 * Number(cantidad)).toFixed(2);
  const r = valorDe(
    await m.casos.venderYCobrar(e.gerente, {
      claveIdempotencia: nuevaClave(),
      cuentaId: nuevoId(),
      ejemplarId: nuevoId(),
      sucursalId: e.sucursal,
      lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad }],
      totalEsperado: { moneda: "ARS", monto: total },
      cobro: {
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"] as string,
            cuentaDeCobroId: null,
            importe: { moneda: "ARS", monto: total },
          },
        ],
      },
    }),
  );
  return { ticketId: r.ticketId, total };
}

/** Los datos de un consumidor final por el total, como los manda la pantalla. */
export const receptorConsumidorFinal = (): Record<string, unknown> => ({
  nombre: null,
  documento: { tipo: "SIN_IDENTIFICAR" },
  condicionIva: "CONSUMIDOR_FINAL",
  domicilio: null,
});

export const nuevaClaveDeFactura = (): string => randomUUID();

/**
 * Lo que hace ARCA y la persona en fiscal sobre los comprobantes que ventas emitió, con los casos de uso reales de fiscal y ARCA falsa:
 * validar (autorizar o rechazar, según lo programado) y emitir notas de crédito. Usa la misma base que ventas.
 */
export function crearFiscalDePrueba(m: MundoDeVentas) {
  const entorno = crearEntornoDeFacturacion(m.propia.base, 8);
  const reloj = new RelojDePrueba(new Date(Date.now() + 60_000));
  const falsa = new EmisionFalsa();
  const casos = casosDeFacturacion(
    entorno,
    { HOMOLOGACION: falsa, PRODUCCION: new EmisionFalsa() },
    reloj,
  );
  const exito = <T>(r: { ok: true; valor: T } | { ok: false; error: unknown }): T => {
    if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  return {
    reloj,
    falsa,
    /** Facturar es siempre un instante después de armar el escenario (los datos fiscales rigen desde entonces). */
    adelantar: () => {
      reloj.actual = new Date(Date.now() + 60_000);
    },
    /** ARCA valida el comprobante (el trabajo que corre fuera de la transacción). */
    autorizar: async (e: EscenarioDeVentas, id: string) => {
      exito(
        await casos.validarComprobante(
          {
            ...comoEmpresa(empresaId(e.empresa), null),
            personaId: null,
            marcaDeEntrada: null,
            ahora: reloj.ahora(),
          },
          { comprobanteId: id as ComprobanteId },
        ),
      );
    },
    /** Lo mismo que `notaDeCredito` pero devuelve el resultado crudo (el oráculo prueba también lo que se rechaza). */
    intentarNotaDeCredito: (e: EscenarioDeVentas, id: string, total: string) =>
      casos.emitirNotaDeCredito(
        { ...e.gerente, ahora: reloj.ahora() },
        notaManual(id as ComprobanteId, { renglones: [renglon(total, "1", "21")] }),
      ),
    notaDeCredito: async (e: EscenarioDeVentas, id: string, total: string): Promise<string> =>
      exito(
        await casos.emitirNotaDeCredito(
          { ...e.gerente, ahora: reloj.ahora() },
          notaManual(id as ComprobanteId, { renglones: [renglon(total, "1", "21")] }),
        ),
      ).comprobanteId,
    cerrar: () => entorno.cerrar(),
  };
}
