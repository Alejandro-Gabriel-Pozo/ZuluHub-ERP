import { esClaveDe } from "../../../capacidades/modulos/activos";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { EventoDeAuditoriaDeRol } from "../persistencia/repositorio-de-roles";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Cuántos eventos trae el historial: los últimos. Criterio técnico (a corregir): un rol tiene pocos cambios en su vida; el tope evita una lectura sin límite. */
export const MAXIMO_DE_EVENTOS_DEL_HISTORIAL = 50;

export type TipoDeEventoDelRol = "CREADO" | "EDITADO" | "ARCHIVADO" | "REACTIVADO";

/** Un cambio en la vida de un rol propio, ya interpretado. Las acciones son claves del catálogo (las que el catálogo ya no tiene se omiten). */
export type EventoDelRol = Readonly<{
  /** El id del registro de auditoría (estable: sirve de clave de la fila). */
  id: string;
  tipo: TipoDeEventoDelRol;
  cuando: Date;
  /** Quién lo hizo; `null` si no hay persona (actor de sistema). */
  porPersonaId: PersonaId | null;
  /** El nombre que tenía el rol antes, SOLO si esa edición lo cambió. */
  nombreAnterior: string | null;
  /** El nombre que quedó, SOLO si esa edición lo cambió. */
  nombreNuevo: string | null;
  agregadas: readonly string[];
  quitadas: readonly string[];
}>;

export type HistorialDelRol = Readonly<{ rolId: string; eventos: readonly EventoDelRol[] }>;

export type ErrorAlVerElHistorialDelRol = MotivoDeRechazo | ErrorDePersistencia;

const TIPOS: Readonly<Record<string, TipoDeEventoDelRol>> = {
  ROL_CREADO: "CREADO",
  ROL_EDITADO: "EDITADO",
  ROL_ARCHIVADO: "ARCHIVADO",
  ROL_REACTIVADO: "REACTIVADO",
};

const esObjeto = (valor: unknown): valor is Readonly<Record<string, unknown>> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const textoDe = (objeto: unknown, campo: string): string | null => {
  if (!esObjeto(objeto)) return null;
  const valor = objeto[campo];
  return typeof valor === "string" && valor !== "" ? valor : null;
};

/**
 * El historial de un rol propio de la empresa del contexto: quién lo creó, lo editó (acciones agregadas y quitadas, nombre), lo archivó y lo reactivó, del más nuevo al más viejo (los últimos
 * `MAXIMO_DE_EVENTOS_DEL_HISTORIAL`). Sale de la auditoría que ya escriben los casos de uso en su transacción; no suma ninguna tabla. Solo el gerente (`roles.ver`). `null` si el rol no existe o es de otra
 * empresa (indistinguibles). Solo lectura. Lo guardado se lee con lista blanca: un valor que no tiene la forma esperada se trata como «sin ese dato» (no rompe el historial) y una acción que el catálogo
 * ya no tiene se omite.
 */
export function armarHistorialDelRol({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeIdentidad) {
  return async function historialDelRol(
    contexto: ContextoOperativo,
    entrada: Readonly<{ rolId: string }>,
  ): Promise<Resultado<HistorialDelRol | null, ErrorAlVerElHistorialDelRol>> {
    const { empresaId } = contexto;
    const delCatalogo = (valor: unknown): readonly string[] =>
      Array.isArray(valor)
        ? valor
            .filter((a): a is string => typeof a === "string" && esClaveDe(reglas.permisos, a))
            .sort()
        : [];
    const interpretar = (e: EventoDeAuditoriaDeRol): EventoDelRol | null => {
      const tipo = TIPOS[e.accion];
      if (tipo === undefined) return null;
      const antes = textoDe(e.antes, "nombre");
      const despues = textoDe(e.despues, "nombre");
      const cambioElNombre =
        tipo === "EDITADO" && antes !== null && despues !== null && antes !== despues;
      const detalle = tipo === "EDITADO" && esObjeto(e.despues) ? e.despues : null;
      return {
        id: e.id,
        tipo,
        cuando: e.creadoEn,
        porPersonaId: e.actor,
        nombreAnterior: cambioElNombre ? antes : null,
        nombreNuevo: cambioElNombre ? despues : null,
        agregadas: delCatalogo(detalle?.["agregadas"]),
        quitadas: delCatalogo(detalle?.["quitadas"]),
      };
    };
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<HistorialDelRol | null, MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.historialDelRol.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const rol = await tx.roles.obtener(empresaId, entrada.rolId);
        if (rol === null) return ok(null);
        const eventos = await tx.roles.historial(
          empresaId,
          rol.id,
          MAXIMO_DE_EVENTOS_DEL_HISTORIAL,
        );
        return ok({
          rolId: rol.id,
          eventos: eventos.flatMap((e) => interpretar(e) ?? []),
        });
      },
    );
  };
}
