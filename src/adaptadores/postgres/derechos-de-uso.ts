import type { DefinicionDeModulo } from "../../capacidades/modulos/catalogo";
import { esClaveDe } from "../../capacidades/modulos/activos";
import { derechosDeUso, type AjusteDePerilla } from "../../capacidades/planes/derechos";
import type { DefinicionDePerilla } from "../../capacidades/planes/perillas";
import { vigenteEn } from "../../capacidades/planes/vigencia";
import { valorDeAjuste } from "../../capacidades/planes/valores";
import type {
  AjusteGuardado,
  AsignacionConVersion,
  LecturaDePlanes,
} from "../../modulos/planes/publico";
import type { LecturaDeDerechosDeUso } from "../../puertos/derechos-de-uso";

/**
 * `LecturaDeDerechosDeUso` sobre la lectura de planes (marcas y planes, §B.5.3). No tiene lógica de
 * negocio propia: arma los datos de la base (asignaciones, ajustes) y le deja el cálculo a la función
 * pura `derechosDeUso`, la misma que usan el panel y la consulta de soporte (una sola regla).
 *
 *  - La versión de plan que rige es la de la asignación VIGENTE a `ahora` (la de mayor número entre las
 *    que ya empezaron, `vigenteEn`); sin asignación, ninguna: solo los módulos obligatorios y la base.
 *  - Cada ajuste se interpreta contra su perilla (`valorDeAjuste`). Una perilla que el catálogo ya no
 *    tiene se ignora; un valor que no es de su tipo cuenta como `DEL_PLAN` (vuelve al plan: falla cerrado).
 *  - Nada se guarda entre llamadas: cada llamada lee de nuevo, en la transacción del llamador.
 */
export type CatalogosDeDerechos<M extends string, P extends string> = Readonly<{
  catalogoDeModulos: Readonly<Record<M, Pick<DefinicionDeModulo, "obligatorio">>>;
  catalogoDePerillas: Readonly<Record<P, DefinicionDePerilla>>;
}>;

export function crearLecturaDeDerechosDeUso<M extends string, P extends string>(
  planes: LecturaDePlanes,
  catalogos: CatalogosDeDerechos<M, P>,
): LecturaDeDerechosDeUso<M, P> {
  const { catalogoDeModulos, catalogoDePerillas } = catalogos;

  /** Los ajustes guardados, como los entiende `derechosDeUso`. */
  function interpretar(guardados: readonly AjusteGuardado[]): AjusteDePerilla[] {
    const ajustes: AjusteDePerilla[] = [];
    for (const g of guardados) {
      if (!esClaveDe(catalogoDePerillas, g.perilla)) continue;
      ajustes.push({
        perilla: g.perilla,
        empresaId: g.empresaId,
        numero: g.numero,
        vigenteDesde: g.vigenteDesde,
        valor: valorDeAjuste(catalogoDePerillas[g.perilla], g.valor) ?? "DEL_PLAN",
      });
    }
    return ajustes;
  }

  const versionVigente = (asignaciones: readonly AsignacionConVersion[], ahora: Date) =>
    vigenteEn(asignaciones, ahora)?.version ?? null;

  return {
    async deLaEmpresa(contexto) {
      const tenant = await planes.tenantDeLaEmpresa(contexto.empresaId);
      if (tenant === null) {
        throw new RangeError(
          "la empresa del contexto no es visible: no se pueden leer sus derechos de uso",
        );
      }
      const asignaciones = await planes.asignacionesDelTenant(tenant);
      const ajustes = await planes.ajustesDelTenant(tenant, contexto.empresaId);
      return derechosDeUso({
        catalogoDeModulos,
        catalogoDePerillas,
        tenantId: tenant,
        empresaId: contexto.empresaId,
        versionDePlan: versionVigente(asignaciones, contexto.ahora),
        ajustes: interpretar(ajustes),
        ahora: contexto.ahora,
      });
    },

    async delTenant(contexto, tenant) {
      if (!(await planes.existeElTenant(tenant))) return null;
      const asignaciones = await planes.asignacionesDelTenant(tenant);
      const ajustes = await planes.ajustesDelTenant(tenant, null);
      return derechosDeUso({
        catalogoDeModulos,
        catalogoDePerillas,
        tenantId: tenant,
        empresaId: null,
        versionDePlan: versionVigente(asignaciones, contexto.ahora),
        ajustes: interpretar(ajustes),
        ahora: contexto.ahora,
      });
    },

    deLaCartaPublica() {
      // Falla cerrado hasta que exista el enlace de carta de catálogo: ver la nota del puerto.
      return Promise.resolve(null);
    },
  };
}
