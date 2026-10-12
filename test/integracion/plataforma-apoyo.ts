import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { expect } from "vitest";
import type { Contexto } from "../../src/contexto/contexto";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import {
  adminPlataformaId,
  type AdminPlataformaId,
} from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { comoPlataforma } from "./entorno";

/**
 * Apoyo de las pruebas de los adaptadores de plataforma (H5 P4): los actores, los administradores
 * extra y las comprobaciones de error que se repiten.
 */

export const comoAdmin = (): Contexto => comoPlataforma();
export const comoSoporte = (): Contexto => comoPlataforma({ tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });
export const comoSistema = (): Contexto =>
  comoPlataforma({ tipo: "SISTEMA", proceso: "barrido-de-altas" });
export const comoAdminDe = (id: AdminPlataformaId): Contexto =>
  comoPlataforma({ tipo: "ADMIN", id });

export { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA };

/** Una clave de idempotencia válida al azar (22 caracteres). */
export const claveAlAzar = (): string => `clave-${randomBytes(8).toString("hex")}`;

/** Da de alta (con la conexión del dueño) un administrador extra; `activo: false` es uno dado de baja. */
export async function crearAdminDeBase(
  dueno: pg.Client,
  opciones: { rol?: "ADMIN" | "SOPORTE"; activo?: boolean; email?: string } = {},
): Promise<{ id: AdminPlataformaId; email: string }> {
  const id = randomUUID();
  const email = opciones.email ?? `admin-${randomBytes(5).toString("hex")}@prueba.test`;
  await dueno.query(
    "insert into admin_plataforma (id, email, rol, activo) values ($1, $2, $3, $4)",
    [id, email, opciones.rol ?? "ADMIN", opciones.activo ?? true],
  );
  return { id: adminPlataformaId(id), email };
}

/** Un administrador que nunca existió en la base, con un id bien formado. */
export const adminInexistente = (): AdminPlataformaId => adminPlataformaId(randomUUID());

export function esperarAccesoDenegado<T>(r: Resultado<T, unknown>): void {
  expect(r.ok, "tenía que rechazarse").toBe(false);
  if (!r.ok) expect(r.error).toEqual({ tipo: "AccesoDenegado" });
}

export function esperarError<T>(
  r: Resultado<T, unknown>,
  tipo: ErrorDePersistencia["tipo"],
  restriccion?: string,
): void {
  expect(r.ok, "tenía que fallar").toBe(false);
  if (r.ok) return;
  const error = r.error as ErrorDePersistencia;
  expect(error.tipo).toBe(tipo);
  if (restriccion !== undefined && "restriccion" in error) {
    expect(error.restriccion).toBe(restriccion);
  }
}
