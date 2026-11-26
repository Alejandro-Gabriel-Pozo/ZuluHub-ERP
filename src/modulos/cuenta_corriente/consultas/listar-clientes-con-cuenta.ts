import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  importeAJson,
  importeCero,
  sumar,
  type Importe,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { hoyEnArgentina } from "../../../primitivas/tiempo/fecha-civil-hasta-hoy";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargosAbiertosDeLasPartes, saldosDeLasPartes } from "../../saldos_de_partes/publico";
import { aCuentaPublica, type CuentaPublica } from "../casos-de-uso/cuenta-publica";
import { antiguedadEnDias } from "../antiguedad";
import { datosDeLosClientes } from "./datos-de-clientes";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { disponibleDe } from "./disponible";
import type { DependenciasDeEstadoDeCuenta } from "./ver-estado-de-cuenta";

/** Por qué se ordena la lista: lo que el cliente debe, lo que debe VENCIDO o la edad de su deuda abierta más antigua. */
export const ORDENES_DE_LA_LISTA = ["SALDO", "VENCIDO", "ANTIGUEDAD"] as const;
export type OrdenDeLaLista = (typeof ORDENES_DE_LA_LISTA)[number];

export type EntradaDeListarClientesConCuenta = Readonly<{
  /** Por defecto, `SALDO`. Siempre de mayor a menor; los empates se rompen por nombre y, al final, por id: el orden es el mismo en cada lectura. */
  orden?: OrdenDeLaLista | undefined;
}>;

export type ClienteConCuenta = Readonly<{
  cuenta: CuentaPublica;
  nombre: string | null;
  cuit: string | null;
  saldo: ImporteJson;
  /** La suma de lo que le falta saldar a sus cargos ya vencidos. */
  vencido: ImporteJson;
  disponible: ImporteJson;
  excedido: boolean;
  /** Días de su cargo abierto más antiguo (a la fecha de negocio); `null` si no tiene cargos abiertos. */
  antiguedadEnDias: number | null;
  /** La fecha de negocio (`AAAA-MM-DD`) de ese cargo abierto más antiguo; `null` si no tiene cargos abiertos. */
  fechaDelCargoMasAntiguo: string | null;
}>;

export type ListaDeClientesConCuenta = Readonly<{
  /** El día (Argentina) al que se calcularon «vencido» y la antigüedad. */
  alDia: string;
  clientes: readonly ClienteConCuenta[];
}>;

export type ErrorAlListarClientesConCuenta =
  "ORDEN_INVALIDO" | "FECHA_INVALIDA" | MotivoDeRechazo | ErrorDePersistencia;

/**
 * Los clientes con ficha de cuenta corriente, con su saldo, lo vencido, el disponible y la antigüedad de su deuda, ordenables por saldo, vencido o antigüedad (CC-4). Exige
 * `cuenta_corriente.ver`. Todo se lee en UNA transacción de solo lectura `serializable` (saldos, cargos abiertos y fichas de la misma foto) y se calcula con enteros en centavos.
 */
export function armarListarClientesConCuenta({
  transacciones,
  reglas,
}: DependenciasDeEstadoDeCuenta) {
  return async function listarClientesConCuenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarClientesConCuenta = {},
  ): Promise<Resultado<ListaDeClientesConCuenta, ErrorAlListarClientesConCuenta>> {
    const orden = entrada.orden ?? "SALDO";
    if (!ORDENES_DE_LA_LISTA.includes(orden)) return err("ORDEN_INVALIDO");
    const hoy = hoyEnArgentina(contexto.ahora);
    if (!hoy.ok) return err("FECHA_INVALIDA");
    return transacciones.ejecutar(
      { contexto, aislamiento: "serializable", soloLectura: true },
      async (tx): Promise<Resultado<ListaDeClientesConCuenta, MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarClientesConCuenta.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const fichas = await tx.cuentasDeClientes.listar(contexto.empresaId);
        const ids = fichas.map((f) => f.parteId);
        const saldos = new Map(
          (await saldosDeLasPartes(tx, contexto, ids, "A_COBRAR")).map((s) => [s.parteId, s.saldo]),
        );
        const abiertos = await cargosAbiertosDeLasPartes(tx, contexto, ids, "A_COBRAR", hoy.valor);
        const datos = await datosDeLosClientes(tx, contexto.empresaId, ids);

        const vencidos = new Map<string, Importe>();
        const edades = new Map<string, number>();
        const masAntiguos = new Map<string, string>();
        for (const c of abiertos) {
          const actual = masAntiguos.get(c.parteId);
          if (actual === undefined || c.fechaNegocio < actual)
            masAntiguos.set(c.parteId, c.fechaNegocio);
          if (c.vencida) {
            vencidos.set(
              c.parteId,
              sumar(vencidos.get(c.parteId) ?? importeCero(ARS), c.pendiente),
            );
          }
          edades.set(
            c.parteId,
            Math.max(edades.get(c.parteId) ?? 0, antiguedadEnDias(c.fechaNegocio, hoy.valor)),
          );
        }
        const filas = fichas.map((f) => {
          const saldo = saldos.get(f.parteId) ?? importeCero(ARS);
          const { disponible, excedido } = disponibleDe(f.limite, saldo);
          const d = datos.get(f.parteId);
          return {
            fila: {
              cuenta: aCuentaPublica(f),
              nombre: d?.nombre ?? null,
              cuit: d?.cuit ?? null,
              saldo: importeAJson(saldo),
              vencido: importeAJson(vencidos.get(f.parteId) ?? importeCero(ARS)),
              disponible: importeAJson(disponible),
              excedido,
              antiguedadEnDias: edades.get(f.parteId) ?? null,
              fechaDelCargoMasAntiguo: masAntiguos.get(f.parteId) ?? null,
            } satisfies ClienteConCuenta,
            saldo: saldo.unidades,
            vencido: (vencidos.get(f.parteId) ?? importeCero(ARS)).unidades,
            edad: edades.get(f.parteId) ?? -1,
          };
        });
        const clave = (x: (typeof filas)[number]): bigint =>
          orden === "SALDO" ? x.saldo : orden === "VENCIDO" ? x.vencido : BigInt(x.edad);
        filas.sort((a, b) => {
          const ka = clave(a);
          const kb = clave(b);
          if (ka !== kb) return ka > kb ? -1 : 1;
          const na = a.fila.nombre ?? "";
          const nb = b.fila.nombre ?? "";
          if (na !== nb) return na < nb ? -1 : 1;
          return a.fila.cuenta.parteId < b.fila.cuenta.parteId ? -1 : 1;
        });
        return ok({ alDia: hoy.valor, clientes: filas.map((x) => x.fila) });
      },
    );
  };
}
