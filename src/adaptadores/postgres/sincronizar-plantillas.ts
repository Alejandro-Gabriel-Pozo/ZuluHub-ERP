import type pg from "pg";
// Con extensión `.ts` a propósito: lo carga `scripts/migrar-base.ts` directamente con Node (que borra los tipos pero no resuelve imports sin extensión).
import {
  planDeSincronizacion,
  type ClaveDePlantilla,
  type DeclaracionDeAcciones,
} from "../../capacidades/roles/sincronizar-plantillas.ts";

/**
 * SINCRONIZAR PLANTILLAS (H4b §6.3, solo aditivo): después de aplicar las migraciones, suma a las plantillas las acciones nuevas que el
 * código declara y las marca como introducidas. Una sola transacción: o entra todo o no entra nada.
 *
 * Lo corre el ejecutor de migraciones (con su bloqueo de sesión, así dos ejecutores no se pisan) y, por eso, con la cadena directa del dueño.
 * TABLAS QUE ESCRIBE (solo INSERT, nunca UPDATE ni DELETE): `version_de_plantilla` (una versión nueva por plantilla que aporta algo, con
 * autor `AUTOR_DE_LA_SINCRONIZACION`) y `accion_introducida`. TABLAS QUE SOLO LEE: `version_de_plantilla`, `accion_introducida` y
 * `piso_de_plataforma`. Toma `SHARE ROW EXCLUSIVE` sobre las dos que escribe mientras dura: una edición de la plataforma a la vez espera
 * (con el `lock_timeout` del ejecutor) y no se numera mal una versión.
 *
 * Auditoría: la dejan las propias filas, inmutables (solo inserción, con autor y fecha). NO escribe `auditoria_plataforma`: esa tabla exige
 * un actor de plataforma firmado (0004) y el ejecutor no lo es.
 *
 * Previene: una acción nueva sin dueño en las plantillas, y que cada despliegue pise lo que la plataforma cambió (no quita ni repone nada).
 * Chequeo: `test/integracion/sincronizar-plantillas.test.ts` (dos corridas a la vez, repetida, acción nueva, plantilla editada).
 */
export const AUTOR_DE_LA_SINCRONIZACION = "sincronizacion:plantillas";

export type ResultadoDeLaSincronizacion = Readonly<{
  /** Cuántas acciones nuevas se marcaron como introducidas. */
  introducidas: number;
  /** Las versiones nuevas: la plantilla, su número y las acciones que sumó. */
  versiones: readonly Readonly<{
    clave: ClaveDePlantilla;
    numero: number;
    agregadas: readonly string[];
  }>[];
}>;

const CLAVES: readonly ClaveDePlantilla[] = ["ADMINISTRADOR", "OPERADOR"];

export async function sincronizarPlantillas(
  cliente: pg.Client,
  declaracion: DeclaracionDeAcciones,
  falla: (mensaje: string) => Error,
): Promise<ResultadoDeLaSincronizacion> {
  await cliente.query("BEGIN");
  try {
    const tablas = await cliente.query<{ ok: boolean }>(
      `SELECT to_regclass('public.version_de_plantilla') IS NOT NULL
          AND to_regclass('public.accion_introducida') IS NOT NULL
          AND to_regclass('public.piso_de_plataforma') IS NOT NULL AS ok`,
    );
    if (tablas.rows[0]?.ok !== true) {
      throw falla("faltan las tablas de plantillas (migración 0094): no se puede sincronizar");
    }
    await cliente.query(
      "LOCK TABLE public.version_de_plantilla, public.accion_introducida IN SHARE ROW EXCLUSIVE MODE",
    );
    const introducidas = new Set(
      (
        await cliente.query<{ accion: string }>("SELECT accion FROM public.accion_introducida")
      ).rows.map((fila) => fila.accion),
    );
    const reservadas = new Set(
      (
        await cliente.query<{ accion: string }>(
          "SELECT accion FROM public.piso_de_plataforma WHERE tipo = 'SOLO_GERENTE'",
        )
      ).rows.map((fila) => fila.accion),
    );
    const vigentes: Record<ClaveDePlantilla, readonly string[]> = {
      ADMINISTRADOR: [],
      OPERADOR: [],
    };
    const numeros: Record<ClaveDePlantilla, number> = { ADMINISTRADOR: 0, OPERADOR: 0 };
    for (const clave of CLAVES) {
      const fila = await cliente.query<{ numero: number; acciones: string[] }>(
        "SELECT numero, acciones FROM public.version_de_plantilla WHERE clave = $1 ORDER BY numero DESC LIMIT 1",
        [clave],
      );
      const vigente = fila.rows[0];
      if (vigente === undefined) {
        throw falla(`la plantilla ${clave} no tiene ninguna versión: no se puede sincronizar`);
      }
      vigentes[clave] = vigente.acciones;
      numeros[clave] = vigente.numero;
    }

    const plan = planDeSincronizacion(declaracion, {
      introducidas,
      vigentes,
      reservadasAlGerente: reservadas,
    });
    const versiones: { clave: ClaveDePlantilla; numero: number; agregadas: readonly string[] }[] =
      [];
    for (const version of plan.versiones) {
      const numero = numeros[version.clave] + 1;
      await cliente.query(
        "INSERT INTO public.version_de_plantilla (clave, numero, acciones, autor) VALUES ($1, $2, $3::text[], $4)",
        [version.clave, numero, [...version.acciones], AUTOR_DE_LA_SINCRONIZACION],
      );
      versiones.push({ clave: version.clave, numero, agregadas: version.agregadas });
    }
    if (plan.nuevasIntroducidas.length > 0) {
      await cliente.query(
        "INSERT INTO public.accion_introducida (accion) SELECT unnest($1::text[])",
        [[...plan.nuevasIntroducidas]],
      );
    }
    await cliente.query("COMMIT");
    return { introducidas: plan.nuevasIntroducidas.length, versiones };
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  }
}
