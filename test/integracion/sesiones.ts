import pg from "pg";
import { firmarContexto, rolDeContexto } from "../../src/adaptadores/postgres/contexto-firmado";
import type { Contexto } from "../../src/contexto/contexto";
import type { BaseDePruebas } from "./global";

/**
 * Sesiones de base con el rol real y un contexto firmado, para las pruebas que necesitan CONTROLAR el
 * entrelazado de dos transacciones (quién empieza, quién escribe, quién confirma) o ver el error
 * exacto de la base. Las que no lo necesitan usan `entorno.ejecutar`, que reintenta y traduce.
 */

export type Intento =
  | { ok: true; filas: number; rows: Record<string, unknown>[] }
  | { ok: false; codigo: string; restriccion: string | undefined; mensaje: string };

const URL_POR_ROL = {
  pedernal_app: "app",
  pedernal_grupo: "grupo",
  pedernal_trabajos: "trabajos",
  pedernal_plataforma: "plataforma",
  /** Sin contexto de negocio: el rol de la librería de autenticación; se abre con `contexto: null`. */
  pedernal_autenticacion: "autenticacion",
  /** Sin contexto: el rol público (0007) no tiene sesión ni empresa; se abre con `contexto: null`. */
  pedernal_publico: "publico",
  /** La landing: su contexto lleva el claim `c` (ver `captacion-apoyo.ts`); se abre con `abrirConToken`. */
  pedernal_captacion: "captacion",
} as const;

export class SesionDePrueba {
  private constructor(
    private readonly cliente: pg.Client,
    readonly pid: number,
  ) {}

  /**
   * Abre una conexión con el rol de ese contexto y una transacción con el aislamiento pedido. Sin
   * `contexto` (`null`) no fija ninguno: es la conexión de un rol sin contexto firmado.
   */
  static async abrir(
    base: BaseDePruebas,
    rol: keyof typeof URL_POR_ROL,
    contexto: Contexto | null,
    aislamiento: "read committed" | "repeatable read" | "serializable" = "read committed",
  ): Promise<SesionDePrueba> {
    let token: string | null = null;
    if (contexto !== null) {
      if (rolDeContexto(contexto.tipo) !== rol) {
        throw new Error(`el contexto ${contexto.tipo} no es del rol ${rol}`);
      }
      token = firmarContexto(base.clave, contexto, Math.floor(Date.now() / 1000));
    }
    return SesionDePrueba.abrirConToken(base, rol, token, aislamiento);
  }

  /**
   * Como `abrir`, pero con un token ya firmado (o ninguno): sirve para contextos que `firmarContexto` todavía
   * no sabe armar, como el de la landing (claim `c`, ver `captacion-apoyo.ts`), o para tokens adulterados.
   */
  static async abrirConToken(
    base: BaseDePruebas,
    rol: keyof typeof URL_POR_ROL,
    token: string | null,
    aislamiento: "read committed" | "repeatable read" | "serializable" = "read committed",
  ): Promise<SesionDePrueba> {
    const cliente = new pg.Client({ connectionString: base[URL_POR_ROL[rol]] });
    await cliente.connect();
    const { rows } = await cliente.query<{ pid: number }>("select pg_backend_pid() as pid");
    const sesion = new SesionDePrueba(cliente, rows[0]?.pid as number);
    await cliente.query(`begin isolation level ${aislamiento}`);
    if (token !== null) await cliente.query("select set_config('app.ctx', $1, true)", [token]);
    return sesion;
  }

  /** Una sentencia dentro de un savepoint: si falla, la sesión sigue sana. */
  async intentar(texto: string, parametros: unknown[] = []): Promise<Intento> {
    await this.cliente.query("savepoint intento");
    try {
      const r = await this.cliente.query(texto, parametros);
      await this.cliente.query("release savepoint intento");
      return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
    } catch (error) {
      await this.cliente.query("rollback to savepoint intento");
      return deError(error);
    }
  }

  /**
   * Una sentencia SIN savepoint, como la manda una aplicación: devuelve la promesa tal cual (puede
   * quedar esperando un bloqueo). Si falla, la transacción queda abortada.
   */
  directo(texto: string, parametros: unknown[] = []): Promise<Intento> {
    return this.cliente.query(texto, parametros).then(
      (r) => ({
        ok: true as const,
        filas: r.rowCount ?? 0,
        rows: r.rows as Record<string, unknown>[],
      }),
      (error: unknown) => deError(error),
    );
  }

  /** Confirma. El resultado trae el error si la confirmación falla (por ejemplo, una restricción diferida). */
  async confirmar(): Promise<Intento> {
    return this.directo("commit");
  }

  async deshacer(): Promise<void> {
    await this.cliente.query("rollback").catch(() => undefined);
  }

  async cerrar(): Promise<void> {
    await this.deshacer();
    await this.cliente.end().catch(() => undefined);
  }
}

function deError(error: unknown): Intento {
  const e = error as { code?: string; constraint?: string; message?: string };
  return {
    ok: false,
    codigo: e.code ?? "?",
    restriccion: e.constraint,
    mensaje: e.message ?? "",
  };
}

/** Espera (hasta `limiteEnMs`) a que la sesión `pid` esté bloqueada esperando un bloqueo. */
export async function esperarBloqueo(
  dueno: pg.Client,
  pid: number,
  limiteEnMs = 5000,
): Promise<boolean> {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteEnMs) {
    const { rows } = await dueno.query(
      "select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'",
      [pid],
    );
    if (rows.length > 0) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}
