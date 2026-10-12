import pg from "pg";
import {
  adminPlataformaId,
  type AdminPlataformaId,
} from "../../src/primitivas/identificadores/marca";

/**
 * Los administradores de plataforma de las pruebas. Los ids son FIJOS (uuid canónicos): así
 * `comoPlataforma()` no necesita saber en qué base se sembraron, y toda base de prueba (la
 * compartida y las descartables) tiene los mismos. Se siembran con la conexión del dueño, como lo
 * hará el script del primer administrador: ningún rol limitado puede escribir en `admin_plataforma`.
 */

export const ADMIN_DE_PRUEBA: AdminPlataformaId = adminPlataformaId(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
export const SOPORTE_DE_PRUEBA: AdminPlataformaId = adminPlataformaId(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
export const EMAIL_DE_ADMIN_DE_PRUEBA = "admin-plataforma@prueba.test";
const EMAIL_DE_SOPORTE_DE_PRUEBA = "soporte-plataforma@prueba.test";

/** Siembra un ADMIN y un SOPORTE activos (idempotente). Exige la migración 0004. */
export async function sembrarAdminsDePrueba(urlDueno: string): Promise<void> {
  const cliente = new pg.Client({ connectionString: urlDueno });
  await cliente.connect();
  try {
    await cliente.query(
      `INSERT INTO admin_plataforma (id, email, rol) VALUES ($1, $2, 'ADMIN'), ($3, $4, 'SOPORTE')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_DE_PRUEBA, EMAIL_DE_ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA, EMAIL_DE_SOPORTE_DE_PRUEBA],
    );
  } finally {
    await cliente.end();
  }
}
