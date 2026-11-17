import type { Selectable } from "kysely";
import type { ValorDePerilla } from "../../../capacidades/planes/valores";
import {
  empresaId,
  planId,
  tenantId,
  versionDePlanId,
} from "../../../primitivas/identificadores/marca";
import type { PlanesDePlataformaDb } from "./tablas";
import type {
  PlanGuardado,
  ContenidoDeVersionDePlanGuardable,
  VersionDePlanGuardada,
  VersionPublicadaDePlan,
  AjusteCompleto,
  ModuloDeEmpresaGuardado,
} from "./tipos-de-planes";

type FilaDePlan = Selectable<PlanesDePlataformaDb["plan"]>;
type FilaDeVersion = Selectable<PlanesDePlataformaDb["version_de_plan"]>;
type FilaDeAjuste = Selectable<PlanesDePlataformaDb["ajuste_de_perilla"]>;
type FilaDeModulo = Selectable<PlanesDePlataformaDb["modulo_de_empresa"]>;

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
export function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

export function aPlan(fila: FilaDePlan): PlanGuardado {
  return {
    id: planId(fila.id),
    codigo: fila.codigo,
    estado: deLaLista(["ACTIVO", "RETIRADO"], fila.estado, "estado de plan"),
    version: fila.version,
  };
}

/** Las perillas de una versión: la base impone la forma del objeto (`perillas_validas`). */
function perillasDe(json: unknown): Readonly<Record<string, ValorDePerilla>> {
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? (json as Readonly<Record<string, ValorDePerilla>>)
    : {};
}

export function aVersion(fila: FilaDeVersion): VersionDePlanGuardada {
  return {
    id: versionDePlanId(fila.id),
    planId: planId(fila.plan_id),
    numero: fila.numero,
    estado: fila.estado === "PUBLICADA" ? "PUBLICADA" : "BORRADOR",
    nombreComercial: fila.nombre_comercial,
    modulos: fila.modulos,
    perillas: perillasDe(fila.perillas),
    motivo: fila.motivo,
    publicadaEn: fila.publicada_en,
    publicadaPor: fila.publicada_por,
    version: fila.version,
  };
}

/** `version_de_plan_publicada_ck`: una versión PUBLICADA siempre trae número, fecha, actor y motivo. */
export function aPublicada(fila: FilaDeVersion): VersionPublicadaDePlan {
  const v = aVersion(fila);
  if (v.numero === null || v.motivo === null || v.publicadaEn === null || v.publicadaPor === null) {
    throw new RangeError(`la versión de plan ${fila.id} publicada no está completa`);
  }
  return {
    ...v,
    numero: v.numero,
    motivo: v.motivo,
    publicadaEn: v.publicadaEn,
    publicadaPor: v.publicadaPor,
  };
}

export function aAjuste(fila: FilaDeAjuste): AjusteCompleto {
  return {
    id: fila.id,
    tenantId: tenantId(fila.tenant_id),
    empresaId: fila.empresa_id === null ? null : empresaId(fila.empresa_id),
    perilla: fila.perilla,
    numero: fila.numero,
    valor: fila.valor,
    vigenteDesde: fila.vigente_desde,
    reemplazaProgramada: fila.reemplaza_programada,
    motivo: fila.motivo,
    asignadoPor: fila.asignado_por,
    creadoEn: fila.creado_en,
  };
}

export function aModulo(fila: FilaDeModulo): ModuloDeEmpresaGuardado {
  return {
    empresaId: empresaId(fila.empresa_id),
    modulo: fila.modulo,
    activo: fila.activo,
    version: fila.version,
  };
}

/** Las columnas de la versión que el borrador escribe, a partir de un contenido. */
export function columnasDelContenido(contenido: ContenidoDeVersionDePlanGuardable) {
  return {
    nombre_comercial: contenido.nombreComercial,
    modulos: [...contenido.modulos],
    perillas: JSON.stringify(contenido.perillas),
  };
}
