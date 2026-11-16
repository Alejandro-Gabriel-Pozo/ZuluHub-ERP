import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import {
  armarTxPublicaDePortal,
  crearPortalPublico,
  type TxPublicaDePortal,
} from "../../src/adaptadores/postgres/portal-publico";
import {
  crearTransaccionesPublicas,
  type TransaccionesPublicasDePostgres,
} from "../../src/adaptadores/postgres/transacciones-publicas";
import {
  crearCasosDeUsoDePortal,
  crearConsultasDePortal,
  crearRepositorioDePortales,
  type PortalDb,
  type TxDePortal,
} from "../../src/modulos/portal/publico";
import type { PortalPublico } from "../../src/puertos/portal-publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { deLaMarca } from "../utilidades/alcance-del-host";
import { cartaDeBase } from "./carta-publica-apoyo";
import {
  CATALOGOS_DE_PRUEBA_DE_LA_CARTA,
  MARCA_DEL_HOST,
  darleLaCartaAlPlan,
} from "./carta-publica-lectura-apoyo";
import { montarCatalogo, REGLAS_DE_PRUEBA, type EscenarioDeCatalogo } from "./catalogo-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas del portal de la empresa (0078 y 0083): se arma sobre el montaje del catálogo (mismas personas, roles y planes de prueba) y se le suma el repositorio
 * del portal, que el entorno compartido de las pruebas no trae. El escenario se monta con SQL del dueño de la base (que evade RLS); lo que se prueba pasa por el rol real.
 */
export type Montaje = Awaited<ReturnType<typeof montarPortal>>;

/** Una dirección de imagen con la forma real de Cloudinary; el `id` distinto da una imagen distinta. */
export const direccionDeImagen = (id = "portal", cuenta = "mi-cuenta"): string =>
  `https://res.cloudinary.com/${cuenta}/image/upload/v1700000000/${id}.jpg`;

const codigoDePortalAlAzar = (): string => randomBytes(16).toString("base64url");

export async function montarPortal(
  base: BaseDePruebas,
  opciones: Readonly<{ generarCodigoDePortal?: () => string }> = {},
) {
  const c = await montarCatalogo(base);
  const transacciones: Transacciones<TxDePortal> = {
    ejecutar: (o, trabajo) =>
      c.entorno.ejecutar(o, (tx) =>
        trabajo({ ...tx, portales: crearRepositorioDePortales(tx.db.withTables<PortalDb>()) }),
      ),
  };
  const casos = crearCasosDeUsoDePortal({
    transacciones,
    reglas: REGLAS_DE_PRUEBA,
    generarCodigoDePortal: opciones.generarCodigoDePortal ?? codigoDePortalAlAzar,
  });
  const consultas = crearConsultasDePortal({ transacciones, reglas: REGLAS_DE_PRUEBA });
  /** Un poco después del reloj real: los cambios de plan de las pruebas rigen desde hace segundos. */
  let ahora: Date | null = null;
  const publicas: TransaccionesPublicasDePostgres<TxPublicaDePortal> = crearTransaccionesPublicas({
    url: c.propia.base.publico,
    armar: (db) => armarTxPublicaDePortal(db),
  });
  const portalPublico: PortalPublico = crearPortalPublico(
    publicas,
    { ahora: () => ahora ?? new Date(Date.now() + 120_000) },
    CATALOGOS_DE_PRUEBA_DE_LA_CARTA,
  );
  return {
    ...c,
    casos: { ...c.casos, ...casos },
    consultas: { ...c.consultas, ...consultas },
    portalPublico,
    fijarAhora: (fecha: Date) => {
      ahora = fecha;
    },
    cerrar: async () => {
      await publicas.cerrar();
      await c.cerrar();
    },
  };
}

export const hostDeLaMarca = () => deLaMarca(MARCA_DEL_HOST);

/** Una empresa con sus dos sucursales, su plan con carta y una carta EN LÍNEA por sucursal (montada por el dueño de la base). */
export async function empresaConPortal(c: Montaje) {
  const e: EscenarioDeCatalogo = await c.escenario();
  const plan = await darleLaCartaAlPlan(c, e.empresa);
  const carta1 = await cartaDeBase(c.dueno, e.empresa, e.sucursal, { nombre: "Casa central" });
  const carta2 = await cartaDeBase(c.dueno, e.empresa, e.otraSucursal, { nombre: "Norte" });
  return { e, plan, carta1, carta2 };
}

export const nuevoId = (): string => randomUUID();

/** Lee como el rol público con el código del PORTAL fijado (o sin fijar, con `null`). */
export async function comoPublicoDelPortal<T extends Record<string, unknown>>(
  cadena: string,
  codigoDePortal: string | null,
  consulta: string,
  parametros: unknown[] = [],
  codigoDeCarta: string | null = null,
): Promise<T[]> {
  const cliente = new pg.Client({ connectionString: cadena });
  await cliente.connect();
  try {
    await cliente.query("begin read only isolation level repeatable read");
    if (codigoDePortal !== null)
      await cliente.query("select set_config('app.codigo_de_portal', $1, true)", [codigoDePortal]);
    if (codigoDeCarta !== null)
      await cliente.query("select set_config('app.codigo_de_carta', $1, true)", [codigoDeCarta]);
    const { rows } = await cliente.query<T>(consulta, parametros);
    await cliente.query("commit");
    return rows;
  } finally {
    await cliente.end();
  }
}

/**
 * PROPUESTA (vuelve al dueño; NO está en los SQL aprobados 0078 y 0083): sin esto el rol público no puede leer el portal. (1) La política `portal_de_empresa_publico_de_carta` de
 * 0078 y `carta_publica_publico_de_portal` se llaman en ciclo (SQLSTATE 42P17): se rompe con una función que devuelve solo el `empresa_id` de la carta visitada.
 * (2) El lector llega al tenant, y las políticas de plan de 0083 lo hacen en su subconsulta, por `empresa` y `tenant`: faltan sus políticas por código de portal.
 * Cuando el dueño apruebe el SQL corregido, esto se borra y sus líneas pasan a 0078 y 0083.
 */
export async function aplicarParchePropuesto(dueno: pg.Client): Promise<void> {
  const sentencias = [
    "drop policy portal_de_empresa_publico_de_carta on portal_de_empresa",
    `create function empresa_de_la_carta_visitada() returns uuid language sql stable security definer set search_path = pg_catalog, public, pg_temp
       as $$ select empresa_id from public.carta_publica where codigo = current_setting('app.codigo_de_carta', true) $$`,
    "revoke all on function empresa_de_la_carta_visitada() from public",
    "grant execute on function empresa_de_la_carta_visitada() to pedernal_publico",
    `create policy portal_de_empresa_publico_de_carta on portal_de_empresa for select to pedernal_publico using (empresa_id = public.empresa_de_la_carta_visitada())`,
    `create policy empresa_publico_de_portal on empresa for select to pedernal_publico
       using (exists (select 1 from public.portal_de_empresa p where p.codigo = current_setting('app.codigo_de_portal', true) and p.empresa_id = empresa.id))`,
    `create policy tenant_publico_de_portal on tenant for select to pedernal_publico
       using (exists (select 1 from public.portal_de_empresa p join public.empresa e on e.id = p.empresa_id
                       where p.codigo = current_setting('app.codigo_de_portal', true) and e.tenant_id = tenant.id))`,
  ];
  for (const sentencia of sentencias) await dueno.query(sentencia);
}
