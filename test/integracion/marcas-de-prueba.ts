import pg from "pg";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";

/**
 * La marca principal de las bases de PRUEBA. La migración 0007 crea la fila `pedernal` con un id al azar;
 * las pruebas arman todo contexto operativo con `MARCA_PRINCIPAL_DE_PRUEBA` (`comoEmpresa`), así que cada
 * base de prueba lleva la principal con ese id. Se cambia con la conexión del dueño y antes de que exista
 * ningún tenant (el id de una marca es inmutable en la base: el disparador se apaga solo acá).
 *
 * TRANSITORIO: además, `tenant.marca_id` recibe como valor por defecto la principal de prueba. Hasta que el
 * repositorio de tenants (`tenants.crear`, tramo M4) y el alta de empresa (tramo M6) reciban la marca, los
 * ~40 `insert into tenant (nombre)` de las pruebas existentes no la nombran. En producción NO hay valor por
 * defecto: un alta sin marca falla (lo prueba `marcas-sql.test.ts` sobre una base sin sembrar). Cuando M4 y
 * M6 pasen la marca, `conMarcaPorDefecto` deja de hacer falta.
 */
export async function sembrarMarcaPrincipalDePrueba(
  urlDueno: string,
  opciones: { conMarcaPorDefecto?: boolean } = {},
): Promise<void> {
  const cliente = new pg.Client({ connectionString: urlDueno });
  await cliente.connect();
  try {
    await cliente.query("begin");
    await cliente.query("alter table marca disable trigger marca_cambio");
    const { rowCount } = await cliente.query("update marca set id = $1 where es_principal", [
      MARCA_PRINCIPAL_DE_PRUEBA,
    ]);
    await cliente.query("alter table marca enable trigger marca_cambio");
    if (rowCount !== 1) throw new Error("no se encontró la marca principal para sembrar");
    if (opciones.conMarcaPorDefecto !== false) {
      // El valor se interpola: un DEFAULT no admite parámetros. Es un uuid fijo de las pruebas.
      await cliente.query(
        `alter table tenant alter column marca_id set default '${MARCA_PRINCIPAL_DE_PRUEBA}'`,
      );
    }
    await cliente.query("commit");
  } catch (error) {
    await cliente.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await cliente.end();
  }
}
