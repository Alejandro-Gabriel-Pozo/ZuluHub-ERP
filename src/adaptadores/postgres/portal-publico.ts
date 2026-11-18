import type { Kysely } from "kysely";
import type { AlcanceDelHost } from "../../capacidades/experiencia/puerta";
import { elPlanDejaServirLaCarta } from "../../capacidades/planes/derechos-de-la-carta";
import { codigoDeCartaDesdeTexto } from "../../primitivas/texto/datos-de-carta-publica";
import {
  armarPortalPublicado,
  crearLecturaPublicaDePortales,
  type LecturaPublicaDePortales,
} from "../../modulos/portal/publico";
import {
  crearLecturaDeModulosActivados,
  crearLecturaDePlanes,
  type LecturaDeModulosActivados,
  type LecturaDePlanes,
  type PlanesDb,
} from "../../modulos/planes/publico";
import type { TransaccionesPublicas } from "../../puertos/transacciones-publicas";
import type { PortalPublicado, PortalPublico } from "../../puertos/portal-publico";
import { derechosDeLaEmpresaDeUnTenant } from "./derechos-de-uso";
import type { CatalogosDeLaCarta } from "./vidriera-publica";
import type { SinTablas } from "./transacciones";

/**
 * Lo que recibe el trabajo de una transacción pública del portal: la lectura del portal (0078) y, de planes, solo lo que hace falta para saber si el plan de la empresa
 * deja servirlo (0083): los módulos que activó, sus asignaciones de plan y sus ajustes de perilla.
 */
export type TxPublicaDePortal = Readonly<{
  portales: LecturaPublicaDePortales;
  planes: LecturaDePlanes;
  modulos: LecturaDeModulosActivados;
}>;

export const armarTxPublicaDePortal = (db: Kysely<SinTablas>): TxPublicaDePortal => ({
  portales: crearLecturaPublicaDePortales(db),
  planes: crearLecturaDePlanes(db.withTables<PlanesDb>()),
  modulos: crearLecturaDeModulosActivados(db.withTables<PlanesDb>()),
});

/**
 * `PortalPublico` sobre la puerta pública: el portal de un código DENTRO DEL ALCANCE DEL HOST (su marca y, si es dedicado, su empresa), con datos REALES de la empresa.
 *
 *  - Un código que no tiene la forma de un código (22 a 64 de `A-Za-z0-9_-`) responde `null` SIN tocar la base (igual que uno inexistente).
 *  - Todo lo demás es UNA transacción de solo lectura con una sola foto: la visita ve el portal ENTERO de antes o ENTERO de después de un cambio.
 *  - `null` es la ÚNICA respuesta para todo lo que no se sirve (código inexistente, de otra marca, empresa que no opera, plan que no lo deja): no hay oráculo. Un fallo
 *    de la base NO es `null`: se lanza (una caída no se disfraza de «no disponible»).
 *  - EN CADA VISITA, y en la MISMA foto, se mira si el plan de la empresa deja servirlo con la MISMA regla que la carta (`elPlanDejaServirLaCarta`, módulo `vidriera` y
 *    perilla `vidriera_por_qr`; una sola regla, sin copia). Una empresa que baja de plan o pierde el módulo deja de mostrarlo sola, con la misma respuesta `null`.
 *  - La hora es la del reloj de la composición, no `now()` de la base.
 */
export function crearPortalPublico(
  transacciones: TransaccionesPublicas<TxPublicaDePortal>,
  reloj: Readonly<{ ahora(): Date }>,
  catalogos: CatalogosDeLaCarta,
): PortalPublico {
  async function servir(
    tx: TxPublicaDePortal,
    host: AlcanceDelHost,
    codigo: string,
    ahora: Date,
  ): Promise<PortalPublicado | null> {
    const leido = await tx.portales.porCodigo(codigo);
    if (leido === null) return null;
    const portal = armarPortalPublicado(leido, host);
    // El plan se lee solo de un portal que, por lo demás, se serviría: lo que ya es `null` no cuesta ni muestra nada más.
    if (portal === null) return null;
    const derechos = await derechosDeLaEmpresaDeUnTenant(tx.planes, catalogos, {
      tenant: leido.tenantId,
      empresa: leido.empresaId,
      ahora,
    });
    const permite = elPlanDejaServirLaCarta({
      catalogoDeModulos: catalogos.catalogoDeModulos,
      modulo: "vidriera",
      perilla: "vidriera_por_qr",
      derechos,
      modulosActivados: await tx.modulos.deLaEmpresa(leido.empresaId),
    });
    return permite ? portal : null;
  }
  const leer = async <T>(trabajo: (tx: TxPublicaDePortal) => Promise<T>): Promise<T> => {
    const leida = await transacciones.leer(trabajo);
    if (!leida.ok) throw new Error(`no se pudo leer el portal público: ${leida.error.tipo}`);
    return leida.valor;
  };
  return {
    porCodigo: (host, codigo) =>
      codigoDeCartaDesdeTexto(codigo).ok
        ? leer((tx) => servir(tx, host, codigo, reloj.ahora()))
        : Promise.resolve(null),
    codigoDelPortalDeLaCarta: (host, codigoDeCarta) =>
      codigoDeCartaDesdeTexto(codigoDeCarta).ok
        ? leer(async (tx) => {
            const codigo = await tx.portales.codigoDelPortalDeLaCarta(codigoDeCarta);
            if (codigo === null) return null;
            // Sin portal servible (otro host, plan que no lo deja, empresa que no opera) no hay flecha: la misma regla que la visita al portal.
            return (await servir(tx, host, codigo, reloj.ahora())) === null ? null : codigo;
          })
        : Promise.resolve(null),
  };
}
