import type { DeclaracionDeCaso } from "../capacidades/permisos/declaracion";
import type { ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import { exigirAcciones } from "../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { ContextoOperativo } from "../contexto/contexto";
import { crearDirectorioDePartes } from "../modulos/clientes/publico";
import { ORIGEN_DEL_CARGO_DE_VENTA } from "../modulos/cuenta_corriente/publico";
import {
  estaVencida,
  movimientosDeLasPartes,
  saldoDeParte,
} from "../modulos/saldos_de_partes/publico";
import { importeAJson, type ImporteJson } from "../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { hoyEnArgentina } from "../primitivas/tiempo/fecha-civil-hasta-hoy";
import type { ErrorDePersistencia, Transacciones } from "../puertos/transacciones";
import type { TxDeApp } from "./conexiones";

/**
 * Las lecturas del libro que necesita «Cobrar un ticket a cuenta» (CC-5 B2a): cuál es el cargo pendiente MÁS ANTIGUO de un cliente (con su vencimiento) y cuál es hoy su saldo. Viven en la
 * composición porque cruzan el libro de saldos con el directorio de clientes. Las dos exigen `cuenta_corriente.ver` (por la ficha del cliente se llega a cobrar: SUPUESTO aceptado) y filtran por
 * la empresa del contexto: un cliente que no existe, que es de otra empresa o que no es cliente sale igual (`null`). Leen en una transacción de solo lectura y no escriben ni auditan.
 * El «más antiguo» es el de registro más viejo entre los cargos de ventas (originales, sin anular) con algo pendiente (empate por id del asiento): determinista, sin selector. Solo cuentan los cargos que nacieron de un
 * ticket (`ventas.ticket`): cualquier otro origen futuro no se cobra con esta pantalla. Chequeo: `test/integracion/cobrar-a-cuenta-web.test.ts`.
 */

export type CargoACobrar = Readonly<{
  asientoId: string;
  /** El ticket que originó el cargo: el que se cobra. */
  ticketId: string;
  venceEl: string | null;
  vencida: boolean;
  /** Lo que le falta saldar al cargo (el cobro es por el total del ticket: tiene que coincidir). */
  pendiente: ImporteJson;
  cliente: Readonly<{ id: string; nombre: string | null }>;
}>;

/** Cuántos movimientos del libro de UN cliente se leen para elegir el cargo más antiguo: por encima se rechaza (nace cerrado) en vez de elegir con un libro leído a medias. */
const MOVIMIENTOS_MAXIMOS_DEL_CLIENTE = 5_000;

export type ErrorDeCobroACuenta =
  MotivoDeRechazo | ErrorDePersistencia | "IDENTIFICADOR_INVALIDO" | "CUENTA_DEMASIADO_GRANDE";

export type DependenciasDeCobroACuenta = Readonly<{
  transacciones: Transacciones<TxDeApp>;
  reglas: ReglasDeEmpresa;
}>;

/** La acción que cada lectura exige al guard: la de ver la cuenta corriente. */
export const DECLARACIONES_DE_COBRO_A_CUENTA = {
  cargoACobrarDelCliente: { accion: "cuenta_corriente.ver" },
  saldoDelClienteACuenta: { accion: "cuenta_corriente.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const directorio = crearDirectorioDePartes();

export function crearCobroACuenta(d: DependenciasDeCobroACuenta) {
  const leer = <T>(
    contexto: ContextoOperativo,
    trabajo: (tx: TxDeApp) => Promise<Resultado<T, ErrorDeCobroACuenta>>,
  ) =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<T, ErrorDeCobroACuenta>> => {
        const permiso = await exigirAcciones(d.reglas, ["cuenta_corriente.ver"], () =>
          tx.autorizacion.delActor(contexto),
        );
        return permiso.ok ? trabajo(tx) : permiso;
      },
    );

  return {
    /** El cargo pendiente más antiguo del cliente que nació de un ticket, o el de `ticketId` si se pide uno; `null` si no hay (o el cliente no es de la empresa). */
    cargoACobrarDelCliente(
      contexto: ContextoOperativo,
      entrada: Readonly<{ clienteId: string; ticketId?: string | undefined }>,
    ): Promise<Resultado<CargoACobrar | null, ErrorDeCobroACuenta>> {
      if (!UUID.test(entrada.clienteId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      if (entrada.ticketId !== undefined && !UUID.test(entrada.ticketId)) {
        return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      }
      return leer(contexto, async (tx) => {
        const cliente = await directorio.parteParaOperacion(
          tx,
          contexto.empresaId,
          entrada.clienteId,
          "CUSTOMER",
        );
        if (!cliente.ok) return ok(null);
        const hoy = hoyEnArgentina(contexto.ahora);
        if (!hoy.ok) throw new Error("el «hoy» de Argentina no se pudo calcular");
        // El libro del cliente (con el origen de cada asiento: de ahí sale el ticket). Cargo abierto = el original de un ticket, sin anular y con algo por saldar.
        const libro = await movimientosDeLasPartes(
          tx,
          contexto,
          [cliente.valor.id],
          "A_COBRAR",
          MOVIMIENTOS_MAXIMOS_DEL_CLIENTE,
        );
        if (libro.length > MOVIMIENTOS_MAXIMOS_DEL_CLIENTE) return err("CUENTA_DEMASIADO_GRANDE");
        const delTicket = libro
          .filter(
            (c) =>
              c.naturaleza === "ORIGINAL" &&
              !c.anulado &&
              c.pendiente.unidades > 0n &&
              c.origenTipo === ORIGEN_DEL_CARGO_DE_VENTA &&
              (entrada.ticketId === undefined || c.origenId === entrada.ticketId),
          )
          .sort(
            (a, b) =>
              a.registradoEn.getTime() - b.registradoEn.getTime() ||
              a.asientoId.localeCompare(b.asientoId),
          );
        const cargo = delTicket[0];
        if (cargo === undefined) return ok(null);
        const nombres = await directorio.nombresParaMostrar(tx, contexto.empresaId, [
          cliente.valor.id,
        ]);
        return ok({
          asientoId: cargo.asientoId,
          ticketId: cargo.origenId,
          venceEl: cargo.venceEl,
          vencida: estaVencida(cargo.venceEl, hoy.valor),
          pendiente: importeAJson(cargo.pendiente),
          cliente: { id: cliente.valor.id, nombre: nombres.get(cliente.valor.id) ?? null },
        });
      });
    },

    /** El saldo del libro del cliente (positivo debe, negativo a favor); `null` si no es un cliente de la empresa. Es el de «El saldo de {cliente} bajó a {saldo}». */
    saldoDelClienteACuenta(
      contexto: ContextoOperativo,
      entrada: Readonly<{ clienteId: string }>,
    ): Promise<Resultado<ImporteJson | null, ErrorDeCobroACuenta>> {
      if (!UUID.test(entrada.clienteId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(contexto, async (tx) => {
        const cliente = await directorio.parteParaOperacion(
          tx,
          contexto.empresaId,
          entrada.clienteId,
          "CUSTOMER",
        );
        if (!cliente.ok) return ok(null);
        return ok(importeAJson(await saldoDeParte(tx, contexto, cliente.valor.id, "A_COBRAR")));
      });
    },
  };
}
