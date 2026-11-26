import type { Kysely, Selectable } from "kysely";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  esUuidCanonico,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import type { CuentaDelCliente, EstadoDeCuenta } from "../dominio/condiciones";
import type { CuentaDelClienteDb } from "./esquema";

/** Una ficha con la huella de su habilitación (la compara la repetición con la misma clave). */
export type CuentaGuardada = CuentaDelCliente & Readonly<{ huellaDeLaHabilitacion: string }>;

export type CuentaNueva = Readonly<{
  empresa: EmpresaId;
  parteId: string;
  plazoDias: number;
  /** Texto decimal canónico (`importeATexto`): nunca `number`. */
  limite: string;
  claveDeIdempotencia: string;
  huella: string;
  habilitadaPor: PersonaId;
}>;

/**
 * Persistencia de la ficha de cuenta corriente. Todo corre dentro de la transacción del caso de uso y sin caché; todo filtra por la empresa (una ficha de otra
 * empresa es, para quien pregunta, una ficha que no existe). Las modificaciones están condicionadas a la versión (control de versión optimista): devuelven
 * `null` si la versión no coincide o la ficha no es de la empresa. La ficha no se borra (la base lo impide).
 */
export interface RepositorioDeCuentasDeClientes {
  /** La ficha de la empresa; `null` si no existe o es de otra empresa. Un texto que no es un UUID no puede ser el id de ninguna ficha. */
  obtener(empresa: EmpresaId, id: string): Promise<CuentaGuardada | null>;
  /** La ficha del cliente (una sola por cliente y empresa); `null` si no tiene. */
  obtenerPorParte(empresa: EmpresaId, parteId: string): Promise<CuentaGuardada | null>;
  /** La ficha habilitada con esa clave de idempotencia; `null` si nadie la usó. */
  obtenerPorClave(empresa: EmpresaId, clave: string): Promise<CuentaGuardada | null>;
  /**
   * Alta de una ficha HABILITADA. Dos altas del mismo cliente chocan en `cuenta_cliente_parte_uk`; la misma clave, en `cuenta_cliente_clave_uk`. Que la parte sea un
   * cliente activo con CUIT lo exige el disparador de la base (`cuenta_del_cliente_validar`).
   */
  insertar(nueva: CuentaNueva): Promise<CuentaGuardada>;
  /** Cambia el plazo y el límite si la versión coincide. */
  cambiarCondiciones(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    plazoDias: number,
    limite: string,
  ): Promise<CuentaGuardada | null>;
  /** Suspende (con motivo) o reactiva (sin motivo) si la versión coincide. La reactivación vuelve a exigir que el cliente pueda deber (disparador de la base). */
  cambiarEstado(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    estado: EstadoDeCuenta,
    motivo: string | null,
  ): Promise<CuentaGuardada | null>;
}

function aCuenta(fila: Selectable<CuentaDelClienteDb["cuenta_del_cliente"]>): CuentaGuardada {
  return {
    id: fila.id,
    parteId: fila.parte_id,
    plazoDias: fila.plazo_dias,
    limite: importeDesdeTexto(ARS, fila.limite),
    estado: fila.estado,
    motivoDeSuspension: fila.motivo_de_suspension,
    version: fila.version,
    huellaDeLaHabilitacion: fila.huella,
  };
}

export function crearRepositorioDeCuentasDeClientes(
  db: Kysely<CuentaDelClienteDb>,
): RepositorioDeCuentasDeClientes {
  return {
    async obtener(empresa, id) {
      if (!esUuidCanonico(id)) return null;
      const fila = await db
        .selectFrom("cuenta_del_cliente")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async obtenerPorParte(empresa, parteId) {
      if (!esUuidCanonico(parteId)) return null;
      const fila = await db
        .selectFrom("cuenta_del_cliente")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", parteId)
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async obtenerPorClave(empresa, clave) {
      const fila = await db
        .selectFrom("cuenta_del_cliente")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async insertar(nueva) {
      const fila = await db
        .insertInto("cuenta_del_cliente")
        .values({
          empresa_id: nueva.empresa,
          parte_id: nueva.parteId,
          plazo_dias: nueva.plazoDias,
          limite: nueva.limite,
          clave_idempotencia: nueva.claveDeIdempotencia,
          huella: nueva.huella,
          habilitada_por: nueva.habilitadaPor,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aCuenta(fila);
    },

    async cambiarCondiciones(empresa, id, versionEsperada, plazoDias, limite) {
      const fila = await db
        .updateTable("cuenta_del_cliente")
        .set({ plazo_dias: plazoDias, limite })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async cambiarEstado(empresa, id, versionEsperada, estado, motivo) {
      const fila = await db
        .updateTable("cuenta_del_cliente")
        .set({ estado, motivo_de_suspension: motivo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },
  };
}
