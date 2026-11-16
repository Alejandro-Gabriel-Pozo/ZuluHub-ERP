import { sql, type Kysely } from "kysely";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import { empresaId, tenantId } from "../../../primitivas/identificadores/marca";
import type { CartaDelPortal, PortalLeido } from "../dominio/portal-publicado";
import { COLUMNAS_PUBLICAS_DE_PORTAL, type TablasDePortal } from "./esquema";
import { aDatosDelPortal, aTarjeta, aZona } from "./repositorio-de-portales";

/** Las tablas que el portal público mira y no son del portal (0044 y 0078: columnas exactas). */
export type PublicoDePortalDb = TablasDePortal & {
  empresa: { id: string; tenant_id: string; estado: string };
  tenant: { id: string; estado: string; marca_id: string };
  sucursal: { id: string; empresa_id: string; activa: boolean };
  carta_publica: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    codigo: string;
    nombre: string;
    estado: string;
  };
};

/**
 * La lectura de la puerta pública de un portal (§2.3 a §2.5): SOLO LECTURA, con el rol `pedernal_publico` y dentro de UNA transacción de foto fija. Sin contexto firmado: lo
 * que se ve lo deciden los `GRANT` por columna y las políticas de 0078 y 0083, que miran `app.codigo_de_portal`. Trae FILAS; si el plan deja servirlo lo decide quien
 * llama con la MISMA regla que la carta (`elPlanDejaServirLaCarta`). Cada consulta pide la lista explícita de columnas otorgadas.
 */
export interface LecturaPublicaDePortales {
  /** `null` si el código no es de un portal (la misma respuesta para todo: sin oráculo). */
  porCodigo(codigo: string): Promise<PortalLeido | null>;
  /**
   * El código del portal de la empresa de UNA carta, para el enlace «← PORTAL» (`hrefDelPortal`). `null` si el código no es de una carta o su empresa no tiene portal.
   * Usa la política `portal_de_empresa_publico_de_carta` (0078): quien lee una carta con su código lee el portal de SU empresa y de ninguna otra.
   */
  codigoDelPortalDeLaCarta(codigoDeCarta: string): Promise<string | null>;
}

const COMO_ESTADO_DE_EMPRESA: readonly EstadoDeEmpresa[] = [
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "DELETING",
];
const COMO_ESTADO_DE_TENANT: readonly EstadoDeTenant[] = ["ACTIVE", "SUSPENDED"];

/** Lo que la base guarda y el dominio no conoce es una falla, no un dato: nunca se sirve a ciegas. */
function estadoDe<E extends string>(permitidos: readonly E[], texto: string): E {
  const estado = permitidos.find((e) => e === texto);
  if (estado === undefined) throw new RangeError(`estado inválido en la base: ${texto}`);
  return estado;
}

export function crearLecturaPublicaDePortales(db: {
  withTables<T extends object>(): Kysely<T & PublicoDePortalDb>;
}): LecturaPublicaDePortales {
  const k = db.withTables<object>();
  return {
    async porCodigo(codigo) {
      // El código de la visita: desde acá y hasta el final de la transacción, las políticas dejan ver solo ese portal y lo suyo.
      await sql`select set_config('app.codigo_de_portal', ${codigo}, true)`.execute(k);
      const fila = await k
        .selectFrom("portal_de_empresa")
        .select([...COLUMNAS_PUBLICAS_DE_PORTAL.portal_de_empresa])
        .where("codigo", "=", codigo)
        .executeTakeFirst();
      if (fila === undefined) return null;
      // La empresa que el portal ya mostró: desde acá las políticas de `carta_publica` y `sucursal` (0078) dejan ver las de ESA empresa y de ninguna otra.
      await sql`select set_config('app.empresa_del_portal', ${fila.empresa_id}, true)`.execute(k);
      await sql`select set_config('app.id_del_portal', ${fila.id}, true)`.execute(k);
      const empresa = await k
        .selectFrom("empresa")
        .select(["id", "tenant_id", "estado"])
        .where("id", "=", fila.empresa_id)
        .executeTakeFirst();
      if (empresa === undefined) return null;
      const tenant = await k
        .selectFrom("tenant")
        .select(["id", "estado", "marca_id"])
        .where("id", "=", empresa.tenant_id)
        .executeTakeFirst();
      if (tenant === undefined) return null;
      const tarjetas = await k
        .selectFrom("portal_tarjeta")
        .select([...COLUMNAS_PUBLICAS_DE_PORTAL.portal_tarjeta])
        .where("portal_id", "=", fila.id)
        .where("empresa_id", "=", fila.empresa_id)
        .orderBy("orden")
        .orderBy("sucursal_id")
        .execute();
      const zonas = await k
        .selectFrom("portal_zona")
        .select([...COLUMNAS_PUBLICAS_DE_PORTAL.portal_zona])
        .where("portal_id", "=", fila.id)
        .where("empresa_id", "=", fila.empresa_id)
        .orderBy("id")
        .execute();
      const cartas = await k
        .selectFrom("carta_publica")
        .select(["sucursal_id", "codigo", "nombre"])
        .where("empresa_id", "=", fila.empresa_id)
        .where("estado", "=", "EN_LINEA")
        .orderBy("sucursal_id")
        .execute();
      const abiertas = await k
        .selectFrom("sucursal")
        .select(["id"])
        .where("empresa_id", "=", fila.empresa_id)
        .where("activa", "=", true)
        .execute();
      return {
        sucursalesAbiertas: abiertas.map((x) => x.id),
        id: fila.id,
        codigo: fila.codigo,
        empresaId: empresaId(fila.empresa_id),
        tenantId: tenantId(tenant.id),
        marcaId: tenant.marca_id,
        estadoDeLaEmpresa: estadoDe(COMO_ESTADO_DE_EMPRESA, empresa.estado),
        estadoDelTenant: estadoDe(COMO_ESTADO_DE_TENANT, tenant.estado),
        datos: aDatosDelPortal(fila),
        tarjetas: tarjetas.map(aTarjeta),
        zonas: zonas.map(aZona),
        cartas: cartas.map((c) => ({
          sucursalId: c.sucursal_id,
          codigo: c.codigo,
          nombre: c.nombre,
        })),
      };
    },
    async codigoDelPortalDeLaCarta(codigoDeCarta) {
      await sql`select set_config('app.codigo_de_carta', ${codigoDeCarta}, true)`.execute(k);
      const carta = await k
        .selectFrom("carta_publica")
        .select(["empresa_id"])
        .where("codigo", "=", codigoDeCarta)
        .executeTakeFirst();
      if (carta === undefined) return null;
      const portal = await k
        .selectFrom("portal_de_empresa")
        .select(["codigo"])
        .where("empresa_id", "=", carta.empresa_id)
        .executeTakeFirst();
      return portal?.codigo ?? null;
    },
  };
}

export type { CartaDelPortal, PortalLeido };
