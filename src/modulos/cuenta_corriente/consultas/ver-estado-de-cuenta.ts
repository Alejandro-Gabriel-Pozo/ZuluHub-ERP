import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { hoyEnArgentina } from "../../../primitivas/tiempo/fecha-civil-hasta-hoy";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { ErrorDePersistencia, Transacciones } from "../../../puertos/transacciones";
import {
  cargosAbiertosDeLasPartes,
  estadoDeCuenta,
  saldoDeParte,
  type TxDeSaldos,
} from "../../saldos_de_partes/publico";
import type { TxDeClientes } from "../../clientes/publico";
import { aCuentaPublica, type CuentaPublica } from "../casos-de-uso/cuenta-publica";
import { antiguedadEnDias } from "../antiguedad";
import type {
  ApoyoDeLaExportacion,
  TicketDeUnMovimiento,
} from "../casos-de-uso/puertos-de-exportacion";
import {
  esOrigenDeUnaCobranza,
  esOrigenDeUnTicket,
  tipoDeMovimiento,
  type TipoDeMovimiento,
} from "../tipo-de-movimiento";
import type { RepositorioDeCuentasDeClientes } from "../persistencia/repositorio-de-cuentas";
import { datosDeLosClientes } from "./datos-de-clientes";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { disponibleDe } from "./disponible";

/** Lo que recibe el trabajo de las consultas de CC-4 (ADR-005): solo lecturas y la carga de autorización; por tipos, una consulta no escribe. */
export type TxDeEstadoDeCuenta = Readonly<{
  cuentasDeClientes: Pick<RepositorioDeCuentasDeClientes, "obtenerPorParte" | "listar">;
  saldos: TxDeSaldos["saldos"];
  partes: TxDeClientes["partes"];
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeEstadoDeCuenta = Readonly<{
  transacciones: Transacciones<TxDeEstadoDeCuenta>;
  reglas: ReglasDeEmpresa;
  /** Lo que la ficha lee de ventas, caja y empresas (el ticket de cada movimiento, el medio de cada cobro, el nombre de las sucursales): lo arma la composición. Sin él, los movimientos salen sin origen. */
  apoyo?: ApoyoDeLaExportacion<TxDeEstadoDeCuenta> | undefined;
}>;

export type EntradaDeVerEstadoDeCuenta = Readonly<{
  parteId: string;
  /** Fechas de negocio `AAAA-MM-DD`, inclusive; recortan las líneas pero NO el saldo corrido (que es siempre el real). */
  desde?: string | undefined;
  hasta?: string | undefined;
}>;

export type LineaDelEstadoDeCuenta = Readonly<{
  asientoId: string;
  clase: string;
  naturaleza: "ORIGINAL" | "ANULACION";
  /** Con su signo: positivo suma lo que el cliente debe; negativo lo resta. */
  importe: ImporteJson;
  saldoAcumulado: ImporteJson;
  fechaDeNegocio: string;
  venceEl: string | null;
  anulaA: string | null;
  /** El ticket detrás del movimiento (el del cargo, o el de la cobranza), para vincular la fila con él; `null` si no se pudo determinar. Solo lectura, de la empresa. */
  ticketId: string | null;
  /** Qué es el movimiento (venta a cuenta, cobranza o su anulación). */
  tipo: TipoDeMovimiento;
  /** `true`: un cargo todavía con algo por saldar cuyo vencimiento ya pasó. */
  vencida: boolean;
  /** El ticket detrás del movimiento (el del cargo o el de la cobranza); `null` si no se pudo determinar o la composición no lo ofrece. */
  ticket: Readonly<{
    numero: number;
    canal: "SALON" | "MOSTRADOR";
    sucursal: string | null;
  }> | null;
  /** El tipo de medio de pago de una cobranza con UN solo medio; `null` en el resto (o si pagó con varios). */
  medioDePago: string | null;
}>;

export type CargoPendienteDelEstadoDeCuenta = Readonly<{
  asientoId: string;
  clase: string;
  fechaDeNegocio: string;
  venceEl: string | null;
  /** El ticket que originó el cargo, para vincular la fila con él (cobrarlo a cuenta); `null` si el cargo no viene de un ticket. */
  ticketId: string | null;
  /** Lo que le falta saldar al cargo. */
  pendiente: ImporteJson;
  vencida: boolean;
  antiguedadEnDias: number;
}>;

export type EstadoDeCuentaDelCliente = Readonly<{
  cuenta: CuentaPublica;
  cliente: Readonly<{ nombre: string | null; cuit: string | null }>;
  /** El día (Argentina) al que se calcularon «vencida» y la antigüedad. */
  alDia: string;
  saldo: ImporteJson;
  disponible: ImporteJson;
  excedido: boolean;
  lineas: readonly LineaDelEstadoDeCuenta[];
  cargosPendientes: readonly CargoPendienteDelEstadoDeCuenta[];
}>;

export type ErrorAlVerEstadoDeCuenta =
  "CUENTA_NO_ENCONTRADA" | "FECHA_INVALIDA" | MotivoDeRechazo | ErrorDePersistencia;

const fechaOpcional = (
  texto: string | undefined,
): Resultado<FechaCivil | null, "FECHA_INVALIDA"> => {
  if (texto === undefined) return ok(null);
  const f = fechaCivilDesdeTexto(texto);
  return f.ok ? ok(f.valor) : err("FECHA_INVALIDA");
};

/** El ticket de un movimiento: el del cargo (por su id de ticket) o el de la cobranza (por su id de cobranza); `undefined` si no se pudo determinar. */
function ticketDelMovimiento(
  l: Readonly<{ origenTipo: string; origenId: string }>,
  tickets: Readonly<{
    porTicket: ReadonlyMap<string, TicketDeUnMovimiento>;
    porCobranza: ReadonlyMap<string, TicketDeUnMovimiento>;
  }>,
): TicketDeUnMovimiento | undefined {
  if (esOrigenDeUnaCobranza(l.origenTipo)) return tickets.porCobranza.get(l.origenId);
  if (esOrigenDeUnTicket(l.origenTipo)) return tickets.porTicket.get(l.origenId);
  return undefined;
}

/**
 * El estado de cuenta de UN cliente (CC-4): sus movimientos del libro con el saldo corrido (los espejos de anulación como líneas propias, nada se oculta), lo que le queda por saldar a cada
 * cargo con su vencimiento y su antigüedad, el saldo y el disponible. Exige `cuenta_corriente.ver` y lee TODO en una sola transacción de solo lectura `serializable`: una foto, no un
 * saldo de un instante y las líneas de otro mientras alguien cobra o carga. Una parte sin ficha o de otra empresa es `CUENTA_NO_ENCONTRADA` (sin oráculo de existencia).
 */
export function armarVerEstadoDeCuenta(dependencias: DependenciasDeEstadoDeCuenta) {
  const { transacciones, reglas } = dependencias;
  return async function verEstadoDeCuenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeVerEstadoDeCuenta,
  ): Promise<Resultado<EstadoDeCuentaDelCliente, ErrorAlVerEstadoDeCuenta>> {
    const desde = fechaOpcional(entrada.desde);
    if (!desde.ok) return desde;
    const hasta = fechaOpcional(entrada.hasta);
    if (!hasta.ok) return hasta;
    if (desde.valor !== null && hasta.valor !== null && desde.valor > hasta.valor) {
      return err("FECHA_INVALIDA");
    }
    const hoy = hoyEnArgentina(contexto.ahora);
    if (!hoy.ok) return err("FECHA_INVALIDA");
    return transacciones.ejecutar(
      { contexto, aislamiento: "serializable", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<EstadoDeCuentaDelCliente, "CUENTA_NO_ENCONTRADA" | MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.verEstadoDeCuenta.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const cuenta = await tx.cuentasDeClientes.obtenerPorParte(
          contexto.empresaId,
          entrada.parteId,
        );
        if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
        const saldo = await saldoDeParte(tx, contexto, cuenta.parteId, "A_COBRAR");
        const lineas = await estadoDeCuenta(
          tx,
          contexto,
          cuenta.parteId,
          "A_COBRAR",
          desde.valor ?? undefined,
          hasta.valor ?? undefined,
        );
        const pendientes = await cargosAbiertosDeLasPartes(
          tx,
          contexto,
          [cuenta.parteId],
          "A_COBRAR",
          hoy.valor,
        );
        const datos = await datosDeLosClientes(tx, contexto.empresaId, [cuenta.parteId]);
        const { disponible, excedido } = disponibleDe(cuenta.limite, saldo);
        const empresa = contexto.empresaId;
        const idsDeTickets = [
          ...new Set(lineas.filter((l) => esOrigenDeUnTicket(l.origenTipo)).map((l) => l.origenId)),
        ];
        const idsDeCobranzas = [
          ...new Set(
            lineas.filter((l) => esOrigenDeUnaCobranza(l.origenTipo)).map((l) => l.origenId),
          ),
        ];
        const apoyo = dependencias.apoyo;
        const tickets: Readonly<{
          porTicket: ReadonlyMap<string, TicketDeUnMovimiento>;
          porCobranza: ReadonlyMap<string, TicketDeUnMovimiento>;
        }> =
          apoyo === undefined
            ? { porTicket: new Map(), porCobranza: new Map() }
            : await apoyo.ticketsDeLosMovimientos(tx, empresa, idsDeTickets, idsDeCobranzas);
        const medios: Awaited<
          ReturnType<ApoyoDeLaExportacion<TxDeEstadoDeCuenta>["mediosDeCobranza"]>
        > =
          apoyo === undefined
            ? new Map()
            : await apoyo.mediosDeCobranza(tx, empresa, idsDeCobranzas);
        const sucursales =
          apoyo === undefined
            ? new Map<string, string>()
            : await apoyo.nombresDeSucursales(tx, empresa, [
                ...new Set(
                  [...tickets.porTicket.values(), ...tickets.porCobranza.values()].map(
                    (t) => t.sucursalId,
                  ),
                ),
              ]);
        const vencidas = new Set(pendientes.filter((c) => c.vencida).map((c) => c.asientoId));
        return ok({
          cuenta: aCuentaPublica(cuenta),
          cliente: datos.get(cuenta.parteId) ?? { nombre: null, cuit: null },
          alDia: hoy.valor,
          saldo: importeAJson(saldo),
          disponible: importeAJson(disponible),
          excedido,
          lineas: lineas.map((l) => ({
            asientoId: l.asientoId,
            clase: l.clase,
            naturaleza: l.naturaleza,
            importe: importeAJson(l.importe),
            saldoAcumulado: importeAJson(l.saldoAcumulado),
            fechaDeNegocio: l.fechaNegocio,
            venceEl: l.venceEl,
            anulaA: l.anulaA,
            tipo: tipoDeMovimiento(l.clase, l.naturaleza),
            vencida: vencidas.has(l.asientoId),
            ticketId: ticketDelMovimiento(l, tickets)?.ticketId ?? null,
            ticket: (() => {
              const t = ticketDelMovimiento(l, tickets);
              return t === undefined
                ? null
                : {
                    numero: t.numero,
                    canal: t.esDelSalon ? ("SALON" as const) : ("MOSTRADOR" as const),
                    sucursal: sucursales.get(t.sucursalId) ?? null,
                  };
            })(),
            medioDePago: (() => {
              const m = esOrigenDeUnaCobranza(l.origenTipo) ? medios.get(l.origenId) : undefined;
              return m?.length === 1 ? (m[0]?.tipoDeMedio ?? null) : null;
            })(),
          })),
          cargosPendientes: pendientes.map((c) => ({
            asientoId: c.asientoId,
            clase: c.clase,
            fechaDeNegocio: c.fechaNegocio,
            venceEl: c.venceEl,
            ticketId: esOrigenDeUnTicket(c.origenTipo) ? c.origenId : null,
            pendiente: importeAJson(c.pendiente),
            vencida: c.vencida,
            antiguedadEnDias: antiguedadEnDias(c.fechaNegocio, hoy.valor),
          })),
        });
      },
    );
  };
}
