import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  buscarPartesDentro,
  nombreParaMostrar,
  posiblesDuplicadosDe,
  rolesActivosPorParte,
  type DuplicadoDeLista,
  type EntradaDeBuscarPartes,
  type EntradaDePosiblesDuplicados,
  type PaginaDePartes,
} from "../casos-de-uso/busqueda";
import { esUuid } from "../persistencia/filas";
import type { Parte, VinculoGuardado } from "../persistencia/modelo";
import { err, ok } from "../../../primitivas/resultado/resultado";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { TxDeConsultasDeClientes } from "../casos-de-uso/contrato";

export type {
  DuplicadoDeLista,
  EntradaDeBuscarPartes,
  EntradaDePosiblesDuplicados,
  PaginaDePartes,
};
export type { ParteDeLista } from "../casos-de-uso/busqueda";

export type FichaDeParte = Readonly<{
  id: string;
  version: number;
  naturaleza: "HUMANA" | "JURIDICA";
  nombre: string | null;
  apellido: string | null;
  alias: string | null;
  documento: Readonly<{ tipo: string; pais: string | null; numero: string }> | null;
  condicionIva: string | null;
  email: string | null;
  telefono: string | null;
  domicilio: Parte["domicilio"];
  nota: string | null;
  activa: boolean;
  esAtajo: boolean;
  roles: readonly string[];
  /** Los vínculos activos: los contactos y agentes de esta parte, y las empresas de las que ella es contacto. */
  vinculos: readonly Readonly<{
    contacto: Readonly<{ id: string; nombre: string }>;
    deParte: Readonly<{ id: string; nombre: string }>;
    tipo: string;
    cargo: string | null;
  }>[];
}>;

export function armarConsultasDePartes(leer: Lector) {
  return {
    /**
     * Buscar partes (E9 §3.1): documento idéntico primero, luego los nombres que empiezan con lo escrito y al final los que lo contienen; paginada
     * por la última parte vista. Las desactivadas solo si se piden. Guard `partes.ver`.
     */
    buscarPartes: async (
      contexto: ContextoOperativo,
      entrada: EntradaDeBuscarPartes = {},
    ): Promise<RDeConsulta<PaginaDePartes>> => {
      const r = await leer(contexto, DECLARACIONES_DE_CONSULTAS.buscarPartes.accion, (tx) =>
        buscarPartesDentro(tx, contexto, entrada),
      );
      if (!r.ok) return r;
      return r.valor === "CURSOR_INVALIDO" ? err("CURSOR_INVALIDO") : ok(r.valor);
    },

    /** La ficha de una parte con sus roles y sus vínculos activos. `null` si no existe o es de otra empresa (indistinguibles). Guard `partes.ver`. */
    fichaDeParte: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ parteId: string }>,
    ): Promise<RDeConsulta<FichaDeParte | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.fichaDeParte.accion, async (tx) => {
        if (!esUuid(entrada.parteId)) return null;
        const parte = await tx.partes.obtener(contexto.empresaId, entrada.parteId);
        if (parte === null) return null;
        const roles = rolesActivosPorParte(await tx.partes.rolesDe(contexto.empresaId, [parte.id]));
        const vinculos = await tx.partes.vinculosDe(contexto.empresaId, parte.id);
        const nombres = await nombresDe(tx, contexto, parte, vinculos);
        return {
          id: parte.id,
          version: parte.version,
          naturaleza: parte.naturaleza,
          nombre: parte.nombre,
          apellido: parte.apellido,
          alias: parte.alias,
          documento: parte.documento,
          condicionIva: parte.condicionIva,
          email: parte.email,
          telefono: parte.telefono,
          domicilio: parte.domicilio,
          nota: parte.nota,
          activa: parte.estado === "ACTIVA",
          esAtajo: parte.esAtajo,
          roles: roles.get(parte.id) ?? [],
          vinculos: vinculos.map((v) => ({
            contacto: { id: v.parteId, nombre: nombres.get(v.parteId) ?? "" },
            deParte: { id: v.deParteId, nombre: nombres.get(v.deParteId) ?? "" },
            tipo: v.tipo,
            cargo: v.cargo,
          })),
        } satisfies FichaDeParte;
      }),

    /**
     * Los posibles duplicados de lo que se está escribiendo (E9 §3.1, F3): las partes de la empresa con el mismo email, teléfono o nombre. Es un
     * aviso: no bloquea nada. Guard `partes.ver`.
     */
    posiblesDuplicados: (
      contexto: ContextoOperativo,
      entrada: EntradaDePosiblesDuplicados,
    ): Promise<RDeConsulta<readonly DuplicadoDeLista[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.posiblesDuplicados.accion, (tx) =>
        posiblesDuplicadosDe(tx, contexto, entrada),
      ),
  };
}

async function nombresDe(
  tx: Pick<TxDeConsultasDeClientes, "partes">,
  contexto: ContextoOperativo,
  parte: Parte,
  vinculos: readonly VinculoGuardado[],
): Promise<Map<string, string>> {
  const nombres = new Map<string, string>([[parte.id, nombreParaMostrar(parte)]]);
  const otros = new Set(
    vinculos.flatMap((v) => [v.parteId, v.deParteId]).filter((id) => !nombres.has(id)),
  );
  for (const id of otros) {
    const otra = await tx.partes.obtener(contexto.empresaId, id);
    if (otra !== null) nombres.set(id, nombreParaMostrar(otra));
  }
  return nombres;
}
