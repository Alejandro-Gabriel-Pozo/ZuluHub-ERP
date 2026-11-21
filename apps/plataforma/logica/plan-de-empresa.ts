/**
 * De las consultas del backend al modelo mínimo y serializable que recibe la pantalla «Plan de una empresa».
 * Puro: sin Next ni React. Solo texto, números y marcas; fechas en ISO.
 */
import type { CondicionesDeCambioDePlan } from "../../../src/plataforma/consultas/condiciones-de-cambio-de-plan";
import { CATALOGO_DE_MODULOS } from "../../../src/capacidades/modulos/catalogo";
import type { ValorDePerilla } from "../../../src/capacidades/planes/valores";
import { fechaArgentinaDeInstante } from "./vigencia";
import type { SentidoDelCambio, UltimoCambioVista } from "./arrepentimiento";
import type { VistaDeTenant } from "../../../src/plataforma/consultas/contrato";
import type {
  DerechosDeUsoDeEmpresa,
  PlanDelTenant,
  VistaDeListaDePlanes,
} from "../../../src/plataforma/consultas/consultas-de-planes";

/** Lo que el servidor decidió del cambio de plan del cliente (H-14b): la pantalla lo muestra, no lo calcula. */
type CondicionesDelCambio = Readonly<{
  /** El día de hoy en Argentina (`AAAA-MM-DD`) con el que el servidor decidió todo lo demás. */
  hoy: string;
  ultimoCambio: UltimoCambioVista | null;
  /** Una por cada plan elegible: su sentido, la primera fecha válida y los días de anticipación que se le aplicaron. */
  opciones: readonly Readonly<{
    versionDePlanId: string;
    sentido: SentidoDelCambio;
    primeraFechaValida: string;
    diasDeAnticipacion: number;
  }>[];
}>;

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
    /** `false`: el módulo todavía está en desarrollo. */
    disponible: boolean;
    habilitadoPorElPlan: boolean;
    activado: boolean;
    estado: string;
    /** Los módulos que este necesita (del catálogo). */
    requiere: readonly string[];
    /** Los que necesita y hoy no están activos (en uso): hay que activarlos antes. */
    faltan: readonly string[];
  }[];
  perillas: { perilla: string; valor: ValorDePerilla; origen: string }[];
  empresasDelCliente: { enUso: number; limite: number | "ILIMITADO" | null } | null;
  /** La última versión PUBLICADA de cada plan no retirado (y la actual, aunque esté retirada); `esActual`: la asignada hoy. */
  planesElegibles: {
    versionDePlanId: string;
    nombre: string;
    versionNumero: number;
    esActual: boolean;
  }[];
  /** Lo que decidió el servidor sobre el cambio de plan; ausente si esa lectura no llegó (el formulario sigue como antes y el servidor valida igual). */
  condiciones?: CondicionesDelCambio | undefined;
  /** Solo muestra u oculta el botón de deshacer: el servidor lo vuelve a exigir (guard). */
  puedeArrepentir?: boolean | undefined;
}>;

export type EntradasDelPlanDeEmpresa = Readonly<{
  derechos: DerechosDeUsoDeEmpresa;
  plan: PlanDelTenant;
  planes: VistaDeListaDePlanes;
  /** La razón social de la empresa; `null` si no se pudo leer. */
  razonSocial: string | null;
  /** El cliente tal como lo lista la consola; `null` si no se pudo obtener. */
  cliente: Pick<VistaDeTenant, "empresasEnUso" | "limiteDeEmpresas"> | null;
  /** La lectura `condicionesDeCambioDePlan`; `null` si no se pudo obtener. */
  condiciones?: CondicionesDeCambioDePlan | null;
  puedeArrepentir?: boolean;
}>;

/** Los módulos que pide el catálogo para uno; una clave que el catálogo no conoce no pide nada. */
function requeridosPorElCatalogo(modulo: string): readonly string[] {
  return Object.hasOwn(CATALOGO_DE_MODULOS, modulo)
    ? [
        ...(CATALOGO_DE_MODULOS as Record<string, { requiere: readonly string[] }>)[modulo]!
          .requiere,
      ]
    : [];
}

/** De la lectura del servidor al modelo serializable de la pantalla (fechas `AAAA-MM-DD`, sin cuentas propias). */
function condicionesDeLaPantalla(
  condiciones: CondicionesDeCambioDePlan,
  plan: PlanDelTenant,
): CondicionesDelCambio {
  const ultimo = condiciones.ultimoCambio;
  const nacioDeUnArrepentimiento =
    ultimo === null
      ? undefined
      : condiciones.arrepentimientos.find((a) => a.numeroNuevo === ultimo.numero);
  const deshecho =
    nacioDeUnArrepentimiento === undefined
      ? undefined
      : plan.asignaciones.find((a) => a.numero === nacioDeUnArrepentimiento.numeroArrepentido);
  return {
    hoy: condiciones.hoy,
    ultimoCambio:
      ultimo === null
        ? null
        : {
            numero: ultimo.numero,
            sentido: ultimo.sentido,
            arrepentimientoHasta: ultimo.arrepentimientoHasta,
            yaArrepentido: ultimo.yaArrepentido,
            puedeDeshacerHoy: ultimo.puedeDeshacerHoy,
            vuelveA: ultimo.vuelveA,
            deshizoElCambioDel:
              deshecho === undefined
                ? null
                : fechaArgentinaDeInstante(deshecho.vigenteDesde.toISOString()),
          },
    opciones: condiciones.opciones.map((o) => ({
      versionDePlanId: o.versionDePlanId,
      sentido: o.sentido,
      primeraFechaValida: o.primeraFechaValida,
      diasDeAnticipacion: o.diasDeAnticipacion,
    })),
  };
}

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
    modulos: derechos.modulos.map((m) => {
      const requiere = requeridosPorElCatalogo(m.modulo);
      return {
        modulo: m.modulo,
        obligatorio: m.obligatorio,
        disponible: m.disponible,
        habilitadoPorElPlan: m.habilitadoPorElPlan,
        activado: m.activado,
        estado: m.estado,
        requiere,
        // Un requerido que la lista no trae cuenta como faltante (cierra ante la duda).
        faltan: requiere.filter(
          (r) => derechos.modulos.find((otro) => otro.modulo === r)?.estado !== "ACTIVO",
        ),
      };
    }),
    perillas: derechos.perillas.map((p) => ({
      perilla: p.perilla,
      valor: p.valor,
      origen: p.origen,
    })),
    empresasDelCliente:
      cliente === null ? null : { enUso: cliente.empresasEnUso, limite: cliente.limiteDeEmpresas },
    planesElegibles: planes.planes.flatMap((p) => {
      if (p.ultimaVersion === null) return [];
      const esActual = p.ultimaVersion.versionDePlanId === idDeLaVigente;
      // Un plan retirado no se ofrece, salvo que sea el que la empresa tiene hoy.
      if (p.plan.estado === "RETIRADO" && !esActual) return [];
      return [
        {
          versionDePlanId: p.ultimaVersion.versionDePlanId,
          nombre: p.ultimaVersion.nombreComercial,
          versionNumero: p.ultimaVersion.numero,
          esActual,
        },
      ];
    }),
    ...(entradas.condiciones === undefined || entradas.condiciones === null
      ? {}
      : { condiciones: condicionesDeLaPantalla(entradas.condiciones, plan) }),
    ...(entradas.puedeArrepentir === undefined
      ? {}
      : { puedeArrepentir: entradas.puedeArrepentir }),
  };
}
