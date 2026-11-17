import { clavesDe, estadoDeModulos } from "../../capacidades/modulos/activos";
import type { OrigenDeValor, ValorDePerilla } from "../../capacidades/planes/valores";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  empresaId as comoEmpresaId,
  type EmpresaId,
  type PlanId,
  type TenantId,
  type VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDeMarcasYPlanes } from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";
import { LECTURA } from "./lectura-de-planes";

// --- derechosDeUsoDeEmpresa -----------------------------------------------------------------------------

export type EstadoDelModuloParaLaEmpresa = "ACTIVO" | "SOLO_LECTURA" | "NO_ACTIVO";

export type ModuloEnLosDerechos = Readonly<{
  modulo: string;
  obligatorio: boolean;
  /** `false`: el módulo está en desarrollo; no se puede activar. */
  disponible: boolean;
  /** Dentro del techo del plan que rige (los obligatorios siempre). */
  habilitadoPorElPlan: boolean;
  /** La empresa lo tiene activado. */
  activado: boolean;
  estado: EstadoDelModuloParaLaEmpresa;
}>;

export type PerillaEnLosDerechos = Readonly<{
  perilla: string;
  valor: ValorDePerilla;
  origen: OrigenDeValor;
}>;

export type DerechosDeUsoDeEmpresa = Readonly<{
  empresaId: EmpresaId;
  tenantId: TenantId;
  /** El instante con que se calcularon. */
  leidoEn: Date;
  /** La versión de plan que rige; `null` si el tenant no tiene (solo los módulos obligatorios y las perillas base). */
  versionDePlan: Readonly<{
    planId: PlanId;
    versionDePlanId: VersionDePlanId;
    numero: number;
  }> | null;
  modulos: readonly ModuloEnLosDerechos[];
  perillas: readonly PerillaEnLosDerechos[];
}>;

export type ErrorAlVerDerechosDeUsoDeEmpresa =
  MotivoDeRechazo | "ID_INVALIDO" | "EMPRESA_NO_ENCONTRADA" | ErrorDePersistencia;

/**
 * Los derechos de uso de una empresa vistos desde la plataforma (§B.11): módulos habilitados por el plan y
 * activados por la empresa, con su estado para el guard, y cada perilla con su valor y su origen
 * (`BASE`, `PLAN`, `AJUSTE`). Es el mismo cálculo que ve la propia empresa. Sin uso: la plataforma no
 * cuenta datos operativos. `planes.ver`, solo lectura.
 */
export function armarDerechosDeUsoDeEmpresa({
  transacciones,
  reglas,
  catalogoDeModulos,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function derechosDeUsoDeEmpresa(
    contexto: ContextoDePlataforma,
    entrada: Readonly<{ empresaId: string }>,
  ): Promise<Resultado<DerechosDeUsoDeEmpresa, ErrorAlVerDerechosDeUsoDeEmpresa>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<DerechosDeUsoDeEmpresa, ErrorAlVerDerechosDeUsoDeEmpresa>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.derechosDeUsoDeEmpresa.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const id = uuidDesdeTexto(entrada.empresaId);
        if (!id.ok) return id;
        const empresa = comoEmpresaId(id.valor);
        const derechos = await tx.derechos.deLaEmpresaParaLaPlataforma(contexto, empresa);
        if (derechos === null) return err("EMPRESA_NO_ENCONTRADA");
        const filas = await tx.planes.modulosDeLasEmpresas([empresa]);
        const activados = filas.filter((f) => f.activo).map((f) => f.modulo);
        const estado = estadoDeModulos(catalogoDeModulos, activados, [
          ...derechos.modulosHabilitados,
        ]);
        return ok({
          empresaId: empresa,
          tenantId: derechos.tenantId,
          leidoEn: derechos.leidoEn,
          versionDePlan: derechos.versionDePlan,
          modulos: clavesDe(catalogoDeModulos).map((modulo) => {
            const definicion = catalogoDeModulos[modulo];
            return {
              modulo,
              obligatorio: definicion?.obligatorio ?? false,
              disponible: definicion?.estado === "disponible",
              habilitadoPorElPlan: derechos.modulosHabilitados.has(modulo),
              activado: activados.includes(modulo),
              estado: estado.modulosActivos.has(modulo)
                ? "ACTIVO"
                : estado.modulosEnSoloLectura.has(modulo)
                  ? "SOLO_LECTURA"
                  : "NO_ACTIVO",
            };
          }),
          perillas: [...derechos.perillas].map(([perilla, valor]) => ({
            perilla,
            valor:
              valor.tipo === "INTERRUPTOR"
                ? { tipo: valor.tipo, encendida: valor.encendida }
                : { tipo: valor.tipo, limite: valor.limite },
            origen: valor.origen,
          })),
        });
      },
    );
  };
}
