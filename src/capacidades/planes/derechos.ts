import type {
  EmpresaId,
  PlanId,
  SucursalId,
  TenantId,
  VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { clavesDe, esClaveDe } from "../modulos/activos";
import type { ClaveModulo, DefinicionDeModulo } from "../modulos/catalogo";
import type { ClavePerilla, DefinicionDePerilla } from "./perillas";
import { vigenteEn } from "./vigencia";
import {
  apagado,
  esValorDeLaPerilla,
  estaEncendida,
  valorBaseDe,
  type ValorDePerilla,
  type ValorEfectivo,
} from "./valores";

/**
 * Derechos de uso (*entitlements*, marcas y planes, §B.5.3): lo que una empresa puede usar en un
 * instante, calculado a partir del plan vigente, los ajustes vigentes y los catálogos. Nunca se
 * guarda ni se cachea entre transacciones: se lee en la misma transacción de cada acción (§B.5.4).
 *
 * Pura: sin reloj (el instante entra como `ahora`) ni azar, sin Zod ni acceso a datos.
 */

/** La versión de plan que rige, con lo que congeló. Es lo que el adaptador lee de la asignación vigente. */
export type VersionDePlanVigente = Readonly<{
  planId: PlanId;
  versionDePlanId: VersionDePlanId;
  /** El número de la versión dentro de su plan. */
  numero: number;
  /** El techo de módulos. */
  modulos: readonly string[];
  /** Los valores de perillas que fijó; las que no figuran valen la base. */
  perillas: Readonly<Record<string, ValorDePerilla>>;
}>;

/**
 * Una decisión sobre una perilla de un cliente (el extra, o la excepción): de todo el tenant
 * (`empresaId` nulo) o de una empresa. `DEL_PLAN` vuelve al valor del plan. `numero` ordena las
 * decisiones de la misma perilla y del mismo alcance (la serie); `vigenteDesde` dice desde cuándo rige.
 */
export type AjusteDePerilla = Readonly<{
  perilla: string;
  empresaId: EmpresaId | null;
  numero: number;
  vigenteDesde: Date;
  valor: ValorDePerilla | "DEL_PLAN";
}>;

export type DerechosDeUso<
  M extends string = ClaveModulo,
  P extends string = ClavePerilla,
> = Readonly<{
  /** La empresa a la que corresponden, o `null` si son los del tenant (consulta de plataforma). */
  empresaId: EmpresaId | null;
  tenantId: TenantId;
  /** El `ahora` de la transacción con que se calcularon. */
  leidoEn: Date;
  versionDePlan: Readonly<{
    planId: PlanId;
    versionDePlanId: VersionDePlanId;
    numero: number;
  }> | null;
  modulosHabilitados: ReadonlySet<M>;
  /** Total: toda perilla del catálogo tiene su valor. */
  perillas: ReadonlyMap<P, ValorEfectivo>;
}>;

export type ErrorDePerilla<P extends string = ClavePerilla> =
  | Readonly<{ codigo: "FUNCION_NO_INCLUIDA"; perilla: P }>
  | Readonly<{ codigo: "LIMITE_DEL_PLAN"; perilla: P; limite: number; usoActual: number }>;

/**
 * El techo de módulos: los obligatorios (todo plan los tiene, y sin plan son los únicos) más los de la
 * versión. Una clave desconocida del plan no habilita nada (falla cerrado).
 */
export function modulosHabilitadosPor<M extends string>(
  catalogo: Readonly<Record<M, Pick<DefinicionDeModulo, "obligatorio">>>,
  version: Readonly<{ modulos: readonly string[] }> | null,
): ReadonlySet<M> {
  const habilitados = new Set<M>(clavesDe(catalogo).filter((clave) => catalogo[clave].obligatorio));
  if (version === null) return habilitados;
  for (const modulo of version.modulos) {
    if (esClaveDe(catalogo, modulo)) habilitados.add(modulo);
  }
  return habilitados;
}

/**
 * Los valores que fija el plan, completados con la base, SIN el efecto de `requiere`. Un valor del
 * plan que no es del tipo de su perilla se ignora (cae a la base: falla cerrado, no rompe).
 */
export function valoresDelPlan<P extends string>(
  catalogo: Readonly<Record<P, DefinicionDePerilla>>,
  perillasDeLaVersion: Readonly<Record<string, ValorDePerilla>> | null,
): Map<P, ValorEfectivo> {
  const valores = new Map<P, ValorEfectivo>();
  for (const perilla of clavesDe(catalogo)) {
    const definicion = catalogo[perilla];
    const delPlan: unknown = perillasDeLaVersion?.[perilla];
    valores.set(
      perilla,
      esValorDeLaPerilla(definicion, delPlan)
        ? { ...delPlan, origen: "PLAN" }
        : { ...valorBaseDe(definicion), origen: "BASE" },
    );
  }
  return valores;
}

/**
 * Aplica `requiere`: una perilla vale APAGADA si la que requiere está apagada (también por cadena),
 * y conserva su origen. Una requerida desconocida, o un ciclo entre perillas, apagan (falla cerrado).
 */
export function aplicarRequiere<P extends string>(
  catalogo: Readonly<Record<P, DefinicionDePerilla>>,
  valores: ReadonlyMap<P, ValorEfectivo>,
): Map<P, ValorEfectivo> {
  const rige = (perilla: P, camino: ReadonlySet<string>): boolean => {
    const valor = valores.get(perilla);
    if (valor === undefined || !estaEncendida(valor)) return false;
    const requiere = catalogo[perilla].requiere;
    if (requiere === undefined) return true;
    if (camino.has(perilla) || !esClaveDe(catalogo, requiere)) return false;
    return rige(requiere, new Set(camino).add(perilla));
  };
  const resultado = new Map<P, ValorEfectivo>();
  for (const [perilla, valor] of valores) {
    resultado.set(perilla, rige(perilla, new Set()) ? valor : apagado(valor));
  }
  return resultado;
}

/**
 * El ajuste que rige para una perilla: el vigente más ESPECÍFICO (el de la empresa antes que el del
 * tenant). Cada alcance es una serie con su propia vigencia: un ajuste de empresa programado todavía
 * no cuenta y rige el del tenant. Si el que rige es `DEL_PLAN` (o su valor no es del tipo de la
 * perilla) se vuelve al plan, sin mirar el alcance más amplio. Los ajustes de otras empresas se
 * ignoran, y los de empresa sobre una perilla de ámbito TENANT también.
 */
function ajusteQueRige(
  perilla: string,
  definicion: DefinicionDePerilla,
  ajustes: readonly AjusteDePerilla[],
  empresaId: EmpresaId | null,
  ahora: Date,
): ValorDePerilla | null {
  const deLaPerilla = ajustes.filter((a) => a.perilla === perilla);
  const deLaEmpresa =
    definicion.ambito === "TENANT"
      ? null
      : vigenteEn(
          deLaPerilla.filter((a) => a.empresaId === empresaId),
          ahora,
        );
  const rige =
    deLaEmpresa ??
    vigenteEn(
      deLaPerilla.filter((a) => a.empresaId === null),
      ahora,
    );
  return rige !== null && esValorDeLaPerilla(definicion, rige.valor) ? rige.valor : null;
}

/**
 * Los derechos de uso de un tenant (con `empresaId` nulo) o de una de sus empresas.
 *  - módulos habilitados = obligatorios ∪ techo de la versión (sin plan: solo los obligatorios);
 *  - valor de cada perilla = el ajuste vigente más específico, si no el de la versión, si no la base;
 *  - una perilla con `requiere` vale apagada si la requerida está apagada (el origen se informa igual).
 * `ajustes` es el historial completo del tenant (cualquier orden): acá se elige el que rige.
 */
export function derechosDeUso<M extends string, P extends string>(
  e: Readonly<{
    catalogoDeModulos: Readonly<Record<M, Pick<DefinicionDeModulo, "obligatorio">>>;
    catalogoDePerillas: Readonly<Record<P, DefinicionDePerilla>>;
    tenantId: TenantId;
    empresaId: EmpresaId | null;
    versionDePlan: VersionDePlanVigente | null;
    ajustes: readonly AjusteDePerilla[];
    ahora: Date;
  }>,
): DerechosDeUso<M, P> {
  const delPlan = valoresDelPlan(e.catalogoDePerillas, e.versionDePlan?.perillas ?? null);
  const crudos = new Map<P, ValorEfectivo>();
  for (const [perilla, valorDelPlan] of delPlan) {
    const ajuste = ajusteQueRige(
      perilla,
      e.catalogoDePerillas[perilla],
      e.ajustes,
      e.empresaId,
      e.ahora,
    );
    crudos.set(perilla, ajuste === null ? valorDelPlan : { ...ajuste, origen: "AJUSTE" });
  }
  return {
    empresaId: e.empresaId,
    tenantId: e.tenantId,
    leidoEn: e.ahora,
    versionDePlan:
      e.versionDePlan === null
        ? null
        : {
            planId: e.versionDePlan.planId,
            versionDePlanId: e.versionDePlan.versionDePlanId,
            numero: e.versionDePlan.numero,
          },
    modulosHabilitados: modulosHabilitadosPor(e.catalogoDeModulos, e.versionDePlan),
    perillas: aplicarRequiere(e.catalogoDePerillas, crudos),
  };
}

/** El valor efectivo de una perilla, sin exigirlo (para mostrarlo o leerlo). Total para todo el catálogo. */
export function valorDePerilla<P extends string>(
  derechos: Readonly<{ perillas: ReadonlyMap<P, ValorEfectivo> }>,
  perilla: P,
): ValorEfectivo {
  const valor = derechos.perillas.get(perilla);
  // Los derechos son totales por construcción: faltar una perilla es un defecto, no un error de negocio.
  if (valor === undefined) throw new RangeError(`los derechos no traen la perilla ${perilla}`);
  return valor;
}

/**
 * ¿Puede la empresa usar esta perilla ahora? Un interruptor apagado da `FUNCION_NO_INCLUIDA`; un
 * límite con `usoActual >= limite` da `LIMITE_DEL_PLAN` (con `usoActual` igual al límite falla; uno
 * menos pasa). `ILIMITADO` nunca falla y un interruptor ignora `usoActual`. Sin `usoActual` el uso es
 * 0: un límite se trata como «¿es mayor que 0?». El error nombra la perilla.
 *
 * `usoActual` lo cuenta el módulo dentro de su transacción. Defectos que se lanzan (no son errores de
 * negocio): un `usoActual` que no es un entero ≥ 0 (con NaN la comparación dejaría pasar todo), o un
 * `alcance.empresaId` distinto del de los derechos (derechos de otra empresa). `alcance.sucursalId`
 * dice dónde se cuenta el uso; el valor sale siempre del tenant o de la empresa.
 */
export function exigirPerilla<P extends string>(
  derechos: Readonly<{ empresaId: EmpresaId | null; perillas: ReadonlyMap<P, ValorEfectivo> }>,
  perilla: P,
  alcance: Readonly<{ empresaId?: EmpresaId; sucursalId?: SucursalId }>,
  usoActual?: number,
): Resultado<null, ErrorDePerilla<P>> {
  if (alcance.empresaId !== undefined && alcance.empresaId !== derechos.empresaId) {
    throw new RangeError("los derechos son de otra empresa que el alcance pedido");
  }
  const uso = usoActual ?? 0;
  if (!Number.isInteger(uso) || uso < 0) throw new RangeError("usoActual inválido");
  const valor = valorDePerilla(derechos, perilla);
  if (valor.tipo === "INTERRUPTOR") {
    return valor.encendida ? ok(null) : err({ codigo: "FUNCION_NO_INCLUIDA", perilla });
  }
  if (valor.limite === "ILIMITADO" || uso < valor.limite) return ok(null);
  return err({ codigo: "LIMITE_DEL_PLAN", perilla, limite: valor.limite, usoActual: uso });
}
