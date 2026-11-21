import type pg from "pg";
import { hoyEnArgentina } from "../../src/primitivas/tiempo/fecha-civil-hasta-hoy";
import { sumarDiasCiviles } from "../../src/primitivas/tiempo/fecha-civil";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import {
  crearBorradorDePlan,
  crearMundoDeMarca,
  crearPlanPublicado,
  publicarVersionDePlan,
} from "./marcas-apoyo";
import { clave, comoAdminAhora } from "./marcas-y-planes-apoyo";

/** Apoyo de las pruebas de la política de cambio de plan (H-14a). */

/** La medianoche argentina (03:00 UTC) de hoy + `dias` días: como la manda la consola. */
function medianocheArgentina(dias: number): Date {
  const hoy = hoyEnArgentina(new Date());
  if (!hoy.ok) throw new Error("sin día de Argentina");
  const dia = sumarDiasCiviles(hoy.valor, dias);
  if (!dia.ok) throw new Error("fecha fuera del calendario");
  const [a, m, d] = dia.valor.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d, 3));
}

/** El día `YYYY-MM-DD` de Argentina de hoy + `dias`. */
export function diaArgentina(dias: number): string {
  const hoy = hoyEnArgentina(new Date());
  if (!hoy.ok) throw new Error("sin día de Argentina");
  const dia = sumarDiasCiviles(hoy.valor, dias);
  if (!dia.ok) throw new Error("fecha fuera del calendario");
  return dia.valor;
}

/** Un tenant con dos empresas. */
export async function tenantConEmpresas(dueno: pg.Client) {
  const primera = await crearMundoDeMarca(dueno);
  const segunda = await crearMundoDeMarca(dueno, { tenant: primera.tenant });
  return { tenant: primera.tenant, empresas: [primera.empresa, segunda.empresa] };
}

/** Un plan con dos versiones publicadas: la 1 con caja y la 2 con caja y ventas (pasar de la 2 a la 1 es una BAJA). */
export async function planConDosVersiones(dueno: pg.Client) {
  const primera = await crearPlanPublicado(dueno, {
    modulos: ["caja"],
    perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 2 } },
  });
  const borrador = await crearBorradorDePlan(dueno, primera.plan, {
    modulos: ["caja", "ventas"],
    perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 5 } },
  });
  await publicarVersionDePlan(dueno, borrador);
  return { plan: primera.plan, v1: primera.version, v2: borrador };
}

/** Define una política nueva con la versión esperada dada. */
export const definirPolitica = (
  casos: CasosDeUsoDeMarcasYPlanes,
  versionEsperada: number,
  dias: readonly [number, number, number],
  extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["definirPoliticaDeCambioDePlan"]>[1]> = {},
) =>
  casos.definirPoliticaDeCambioDePlan(comoAdminAhora(), {
    claveDeIdempotencia: clave(),
    versionEsperada,
    diasDeAnticipacionDeSuba: dias[0],
    diasDeAnticipacionDeBaja: dias[1],
    diasDeArrepentimiento: dias[2],
    motivo: "política de prueba",
    ...extra,
  });

/** Pide un cambio de plan; por omisión desde el día dado (hoy + `dias`). */
export const pedirCambio = (
  casos: CasosDeUsoDeMarcasYPlanes,
  tenantId: string,
  versionDePlanId: string,
  numeroEsperado: number | null,
  dias: number,
  extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["asignarPlan"]>[1]> = {},
) =>
  casos.asignarPlan(comoAdminAhora(), {
    claveDeIdempotencia: clave(),
    tenantId,
    versionDePlanId,
    // Hoy es «ahora»: la medianoche de hoy ya pasó y el servidor rechaza lo retroactivo.
    vigenteDesde: dias === 0 ? new Date() : medianocheArgentina(dias),
    motivo: "cambio de plan",
    numeroEsperado,
    reemplazaProgramada: false,
    ...extra,
  });

/** Se arrepiente del cambio `numero`, con el último visto = `numeroEsperado`. */
export const arrepentir = (
  casos: CasosDeUsoDeMarcasYPlanes,
  tenantId: string,
  numero: number,
  numeroEsperado: number,
  extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["arrepentirCambioDePlan"]>[1]> = {},
) =>
  casos.arrepentirCambioDePlan(comoAdminAhora(), {
    claveDeIdempotencia: clave(),
    tenantId,
    numero,
    numeroEsperado,
    motivo: "el cliente se arrepintió",
    ...extra,
  });
