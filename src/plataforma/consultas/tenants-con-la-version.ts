import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  marcaComercialId,
  versionDePlanId as comoVersionDePlanId,
  tenantId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import {
  paginaValida,
  resultadoDePagina,
  uuidDesdeTexto,
  type ErrorDePagina,
  type ResultadoDePagina,
} from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type {
  DependenciasDeConsultasDeMarcasYPlanes,
  EntradaDeTenantsConLaVersion,
  TenantConLaVersion,
} from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";

const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

export type ErrorAlVerTenantsConLaVersion =
  | MotivoDeRechazo
  | ErrorDePagina
  | "ID_INVALIDO"
  | "VERSION_DE_PLAN_NO_ENCONTRADA"
  | ErrorDePersistencia;

/**
 * Los tenants que tienen hoy una versión de plan como asignación VIGENTE, paginados por id (§B.11; consola:
 * migrar tenants de versión). Cada fila trae lo que el lote de `migrarTenantsDeVersion` pide por tenant:
 * `ultimoNumeroDeAsignacion` es su `numeroEsperado`. `planes.ver`, solo lectura.
 *
 * Una sola sentencia con la regla de vigencia de siempre («la última decisión manda») y otra por las marcas (el
 * código de cada una); el tope por página (100) deja cada página dentro del lote máximo (200).
 */
export function armarTenantsConLaVersion({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function tenantsConLaVersion(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeTenantsConLaVersion,
  ): Promise<Resultado<ResultadoDePagina<TenantConLaVersion>, ErrorAlVerTenantsConLaVersion>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<
        Resultado<
          ResultadoDePagina<TenantConLaVersion>,
          Exclude<ErrorAlVerTenantsConLaVersion, ErrorDePersistencia>
        >
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.tenantsConLaVersion.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        const id = uuidDesdeTexto(entrada.versionDePlanId);
        if (!id.ok) return id;
        const version = comoVersionDePlanId(id.valor);
        if ((await tx.planes.versionPorId(version)) === null) {
          return err("VERSION_DE_PLAN_NO_ENCONTRADA");
        }
        const filas = await tx.planes.tenantsConLaVersionVigente(version, contexto.ahora, {
          limite: pagina.valor.limite,
          despuesDeId:
            pagina.valor.despuesDeId === null ? null : tenantId(pagina.valor.despuesDeId),
        });
        const codigos = new Map((await tx.marcas.listar()).map((m) => [m.id, m.codigo] as const));
        const vistas = filas.map((f): TenantConLaVersion => {
          const marcaId = marcaComercialId(f.marcaId);
          const marcaCodigo = codigos.get(marcaId);
          // `tenant_marca_id_fkey`: todo tenant tiene una marca que existe.
          if (marcaCodigo === undefined)
            throw new RangeError(`el tenant ${f.tenantId} no tiene marca`);
          return {
            tenantId: f.tenantId,
            nombre: f.nombre,
            estado: f.estado,
            marcaId,
            marcaCodigo,
            ultimoNumeroDeAsignacion: f.ultimoNumeroDeAsignacion,
            hayProgramada: f.hayProgramada,
            empresas: f.empresas,
          };
        });
        return ok(resultadoDePagina(vistas, pagina.valor, (v) => v.tenantId));
      },
    );
  };
}
