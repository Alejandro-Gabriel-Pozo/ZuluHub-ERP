import pg from "pg";
import { esReintentable } from "./errores";

/**
 * Una transacción SERIALIZABLE con la conexión DIRECTA del dueño de la base, para los scripts de operación del dueño
 * (baja de un administrador, reseteo de su segundo factor): ningún rol limitado puede escribir en `admin_plataforma` ni
 * borrar en el esquema de la librería de ingreso. Reintenta hasta `REINTENTOS` veces con un conflicto de serialización
 * o un deadlock (dos corridas simultáneas del mismo script): el reintento vuelve a leer y ve lo que dejó la que ganó.
 * El trabajo tiene que ser repetible y no hacer nada fuera de la base. Cierra la conexión siempre.
 */
const REINTENTOS = 5;
const ESPERA_MAXIMA_EN_MS = 80;
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export async function enTransaccionDelDueno<T>(
  urlDueno: string,
  trabajo: (cliente: pg.Client) => Promise<T>,
): Promise<T> {
  const cliente = new pg.Client({
    connectionString: urlDueno,
    statement_timeout: 30_000,
    lock_timeout: 15_000,
  });
  await cliente.connect();
  try {
    for (let intento = 0; ; intento++) {
      await cliente.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        const valor = await trabajo(cliente);
        await cliente.query("COMMIT");
        return valor;
      } catch (falla) {
        // La transacción queda abortada: se la deshace antes de decidir qué hacer con la falla.
        await cliente.query("ROLLBACK").catch(() => undefined);
        if (esReintentable(falla) && intento < REINTENTOS) {
          await esperar(Math.random() * ESPERA_MAXIMA_EN_MS);
          continue;
        }
        throw falla;
      }
    }
  } finally {
    await cliente.end();
  }
}
