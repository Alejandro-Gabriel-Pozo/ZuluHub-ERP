import type { DefinicionDeModulo } from "../../capacidades/modulos/catalogo";
import { derechosDeUso, type DerechosDeUso } from "../../capacidades/planes/derechos";
import type { DefinicionDePerilla } from "../../capacidades/planes/perillas";
import { vigenteEn } from "../../capacidades/planes/vigencia";
import {
  interpretarAjustes,
  type AjusteGuardado,
  type AsignacionConVersion,
  type LecturaDePlanes,
} from "../../modulos/planes/publico";
import type { LecturaDeDerechosDeUso } from "../../puertos/derechos-de-uso";
import type { EmpresaId, TenantId } from "../../primitivas/identificadores/marca";

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

/**
 * Los derechos de una empresa de un tenant: el ÚNICO armado de los datos de la base (asignaciones, ajustes) para `derechosDeUso`. Lo usan la lectura de la propia
 * empresa, la de la plataforma y la puerta pública de la carta (T6): una sola forma de calcular lo que la empresa puede usar.
 */
export async function derechosDeLaEmpresaDeUnTenant<M extends string, P extends string>(
  planes: LecturaDePlanes,
  catalogos: CatalogosDeDerechos<M, P>,
  e: Readonly<{ tenant: TenantId; empresa: EmpresaId; ahora: Date }>,
): Promise<DerechosDeUso<M, P>> {
  const asignaciones = await planes.asignacionesDelTenant(e.tenant);
  const ajustes = await planes.ajustesDelTenant(e.tenant, e.empresa);
  return derechosDeUso({
    catalogoDeModulos: catalogos.catalogoDeModulos,
    catalogoDePerillas: catalogos.catalogoDePerillas,
    tenantId: e.tenant,
    empresaId: e.empresa,
    versionDePlan: vigenteEn(asignaciones, e.ahora)?.version ?? null,
    ajustes: interpretarAjustes(catalogos.catalogoDePerillas, ajustes),
    ahora: e.ahora,
  });
}

export function crearLecturaDeDerechosDeUso<M extends string, P extends string>(
  planes: LecturaDePlanes,
  catalogos: CatalogosDeDerechos<M, P>,
): LecturaDeDerechosDeUso<M, P> {
  const { catalogoDeModulos, catalogoDePerillas } = catalogos;

  const interpretar = (guardados: readonly AjusteGuardado[]) =>
    interpretarAjustes(catalogoDePerillas, guardados);

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
      return derechosDeLaEmpresaDeUnTenant(planes, catalogos, {
        tenant,
        empresa: contexto.empresaId,
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

    async deLaEmpresaParaLaPlataforma(contexto, empresa) {
      const tenant = await planes.tenantDeLaEmpresa(empresa);
      if (tenant === null) return null;
      return derechosDeLaEmpresaDeUnTenant(planes, catalogos, {
        tenant,
        empresa,
        ahora: contexto.ahora,
      });
    },
  };
}
