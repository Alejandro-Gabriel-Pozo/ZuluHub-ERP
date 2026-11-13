import { codigoDeCartaDesdeTexto } from "../../primitivas/texto/datos-de-carta-publica";
import type { ClaveModulo, DefinicionDeModulo } from "../../capacidades/modulos/catalogo";
import { elPlanDejaServirLaCarta } from "../../capacidades/planes/derechos-de-la-carta";
import type { ClavePerilla, DefinicionDePerilla } from "../../capacidades/planes/perillas";
import {
  armarVidrieraPublicada,
  crearLecturaPublicaDeCartas,
  type LecturaPublicaDeCartas,
} from "../../modulos/catalogo/publico";
import { crearLecturaPublicaDeMarcas, type PublicoDb } from "../../modulos/marcas/publico";
import {
  crearLecturaDeModulosActivados,
  crearLecturaDePlanes,
  type LecturaDeModulosActivados,
  type LecturaDePlanes,
  type PlanesDb,
} from "../../modulos/planes/publico";
import { derechosDeLaEmpresaDeUnTenant } from "./derechos-de-uso";
import type { Kysely } from "kysely";
import type { TxPublica } from "./resolucion-de-host";
import type { SinTablas } from "./transacciones";
import type { TransaccionesPublicas } from "../../puertos/transacciones-publicas";
import type { VidrieraPublica } from "../../puertos/vidriera-publica";

/**
 * Lo que recibe el trabajo de una transacción pública de la carta: la lectura del catálogo para el comensal (0044) y, de marcas y planes, solo lo que hace falta para
 * saber si el plan de la empresa deja servirla (0050): los módulos que activó, sus asignaciones de plan y sus ajustes de perilla.
 */
export type TxPublicaDeCarta = Readonly<{
  cartas: LecturaPublicaDeCartas;
  planes: LecturaDePlanes;
  modulos: LecturaDeModulosActivados;
}>;

/** Todo lo que lee la puerta pública: marcas (resolución de host) y cartas. */
export type TxPublicaCompleta = TxPublica & TxPublicaDeCarta;

export const armarTxPublica = (db: Kysely<SinTablas>): TxPublicaCompleta => ({
  marcas: crearLecturaPublicaDeMarcas(db.withTables<PublicoDb>()),
  cartas: crearLecturaPublicaDeCartas(db),
  planes: crearLecturaDePlanes(db.withTables<PlanesDb>()),
  modulos: crearLecturaDeModulosActivados(db.withTables<PlanesDb>()),
});

/** Los catálogos con que se decide si el plan deja servir la carta: los reales en producción, los de la prueba en las pruebas. */
export type CatalogosDeLaCarta = Readonly<{
  catalogoDeModulos: Readonly<
    Record<ClaveModulo, Pick<DefinicionDeModulo, "estado" | "obligatorio">>
  >;
  catalogoDePerillas: Readonly<Record<ClavePerilla, DefinicionDePerilla>>;
}>;

/**
 * `VidrieraPublica` sobre la puerta pública (carta real §4): la carta de un código DENTRO DE UNA MARCA, con datos REALES de la empresa.
 *
 *  - Un código que no tiene la forma de un código de carta responde `null` SIN tocar la base (igual que uno inexistente).
 *  - Todo lo demás es UNA transacción de solo lectura con una sola foto (`LecturaPublicaDeCartas`): la visita ve la carta ENTERA de antes o ENTERA de después de
 *    un cambio, nunca a medias. La marca es la del host de la puerta (nunca un dato del cliente).
 *  - `null` es la ÚNICA respuesta para todo lo que no se sirve (código inexistente, de otra marca, carta retirada, sucursal cerrada, empresa que no opera): no
 *    hay oráculo. Un fallo de la base NO es `null`: se lanza (una caída no se disfraza de «no disponible»).
 *  - La hora es la del reloj de la composición, no `now()` de la base: el precio vigente depende de ella.
 *  - EN CADA VISITA, y en la MISMA foto, se mira si el plan de la empresa deja servir la carta (T6: módulo de la carta activo dentro de su plan y perilla
 *    `vidriera_por_qr` encendida, con la misma regla de derechos de uso del resto del sistema). Una empresa que baja de plan o pierde el módulo deja de mostrarla
 *    sola, con la misma respuesta `null` que una carta retirada: el comensal no distingue el motivo. Nada se guarda entre visitas.
 */
export function crearVidrieraPublica(
  transacciones: TransaccionesPublicas<TxPublicaDeCarta>,
  reloj: Readonly<{ ahora(): Date }>,
  catalogos: CatalogosDeLaCarta,
): VidrieraPublica {
  return {
    async porCodigo(marcaId, codigo) {
      if (!codigoDeCartaDesdeTexto(codigo).ok) return null;
      const ahora = reloj.ahora();
      const leida = await transacciones.leer(async (tx) => {
        const carta = await tx.cartas.porCodigo(codigo, ahora);
        if (carta === null) return null;
        const vidriera = armarVidrieraPublicada(carta, marcaId);
        // El plan se lee solo de una carta que, por lo demás, se serviría: lo que ya es `null` no cuesta ni muestra nada más.
        if (vidriera === null) return null;
        const derechos = await derechosDeLaEmpresaDeUnTenant(tx.planes, catalogos, {
          tenant: carta.tenantId,
          empresa: carta.empresaId,
          ahora,
        });
        const permite = elPlanDejaServirLaCarta({
          catalogoDeModulos: catalogos.catalogoDeModulos,
          modulo: "vidriera",
          perilla: "vidriera_por_qr",
          derechos,
          modulosActivados: await tx.modulos.deLaEmpresa(carta.empresaId),
        });
        return permite ? vidriera : null;
      });
      if (!leida.ok) throw new Error(`no se pudo leer la carta pública: ${leida.error.tipo}`);
      return leida.valor;
    },
  };
}
