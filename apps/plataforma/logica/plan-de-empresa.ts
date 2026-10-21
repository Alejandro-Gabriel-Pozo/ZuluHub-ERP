/**
 * De las consultas del backend al modelo mínimo y serializable que recibe la pantalla «Plan de una empresa».
 * Puro: sin Next ni React. Solo texto, números y marcas; fechas en ISO.
 */
import type { ValorDePerilla } from "../../../src/capacidades/planes/valores";
import type { VistaDeTenant } from "../../../src/plataforma/consultas/contrato";
import type {
  DerechosDeUsoDeEmpresa,
  PlanDelTenant,
  VistaDeListaDePlanes,
} from "../../../src/plataforma/consultas/consultas-de-planes";

export type PlanDeEmpresa = Readonly<{
  empresaId: string;
  tenantId: string;
  /** La razón social, o «Empresa» si no se pudo leer. */
  empresa: string;
  planActual: {
    nombreComercial: string;
    planCodigo: string;
    versionNumero: number;
    vigenteDesde: string;
  } | null;
  sinPlan: boolean;
  programada: { nombreComercial: string; versionNumero: number; vigenteDesde: string } | null;
  /** El mayor número de asignación del tenant: es el `numeroEsperado` del próximo cambio. */
  ultimoNumeroDeAsignacion: number | null;
  modulos: {
    modulo: string;
    obligatorio: boolean;
    habilitadoPorElPlan: boolean;
    activado: boolean;
    estado: string;
  }[];
  perillas: { perilla: string; valor: ValorDePerilla; origen: string }[];
  empresasDelCliente: { enUso: number; limite: number | "ILIMITADO" | null } | null;
  /** La última versión PUBLICADA de cada plan; `esActual`: es la versión asignada hoy. */
  planesElegibles: { versionDePlanId: string; nombre: string; esActual: boolean }[];
}>;

export type EntradasDelPlanDeEmpresa = Readonly<{
  derechos: DerechosDeUsoDeEmpresa;
  plan: PlanDelTenant;
  planes: VistaDeListaDePlanes;
  /** La razón social de la empresa; `null` si no se pudo leer. */
  razonSocial: string | null;
  /** El cliente tal como lo lista la consola; `null` si no se pudo obtener. */
  cliente: Pick<VistaDeTenant, "empresasEnUso" | "limiteDeEmpresas"> | null;
}>;

export function armarPlanDeEmpresa(entradas: EntradasDelPlanDeEmpresa): PlanDeEmpresa {
  const { derechos, plan, planes, razonSocial, cliente } = entradas;
  const vigente = plan.asignaciones.find((a) => a.estado === "VIGENTE");
  const programada = plan.asignaciones
    .filter((a) => a.estado === "PROGRAMADA")
    .reduce<(typeof plan.asignaciones)[number] | null>(
      (menor, a) =>
        menor === null || a.vigenteDesde.getTime() < menor.vigenteDesde.getTime() ? a : menor,
      null,
    );
  const numeros = plan.asignaciones.map((a) => a.numero);
  const idDeLaVigente = derechos.versionDePlan?.versionDePlanId;
  return {
    empresaId: derechos.empresaId,
    tenantId: derechos.tenantId,
    empresa: razonSocial ?? "Empresa",
    planActual:
      vigente === undefined
        ? null
        : {
            nombreComercial: vigente.nombreComercial,
            planCodigo: vigente.planCodigo,
            versionNumero: vigente.versionNumero,
            vigenteDesde: vigente.vigenteDesde.toISOString(),
          },
    sinPlan: vigente === undefined,
    programada:
      programada === null
        ? null
        : {
            nombreComercial: programada.nombreComercial,
            versionNumero: programada.versionNumero,
            vigenteDesde: programada.vigenteDesde.toISOString(),
          },
    ultimoNumeroDeAsignacion: numeros.length === 0 ? null : Math.max(...numeros),
    modulos: derechos.modulos.map((m) => ({
      modulo: m.modulo,
      obligatorio: m.obligatorio,
      habilitadoPorElPlan: m.habilitadoPorElPlan,
      activado: m.activado,
      estado: m.estado,
    })),
    perillas: derechos.perillas.map((p) => ({
      perilla: p.perilla,
      valor: p.valor,
      origen: p.origen,
    })),
    empresasDelCliente:
      cliente === null ? null : { enUso: cliente.empresasEnUso, limite: cliente.limiteDeEmpresas },
    planesElegibles: planes.planes.flatMap((p) =>
      p.ultimaVersion === null
        ? []
        : [
            {
              versionDePlanId: p.ultimaVersion.versionDePlanId,
              nombre: p.ultimaVersion.nombreComercial,
              esActual: p.ultimaVersion.versionDePlanId === idDeLaVigente,
            },
          ],
    ),
  };
}
