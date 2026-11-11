import type { ContextoOperativo } from "../../../contexto/contexto";
import { emailDeContactoDesdeTexto } from "../../../primitivas/contacto/email";
import {
  claseDeCoincidencia,
  nombreCompletoDeParte,
  normalizarParaBusqueda,
  ordenarCoincidencias,
} from "../dominio/busqueda";
import { documentoBuscadoDesdeTexto } from "../dominio/documento";
import { razonesDeDuplicado } from "../dominio/duplicados";
import { esRolDeParte, type RolDeParte } from "../dominio/roles";
import type { Parte } from "../persistencia/modelo";
import { buscadosDeDuplicado } from "../persistencia/repositorios-de-partes";
import type { TxDeConsultasDeClientes } from "./contrato";

/**
 * Lo que las consultas del directorio hacen con el dominio (la búsqueda, el orden y los posibles duplicados): vive acá y no en `consultas/` porque una
 * consulta no importa el dominio de su módulo (ADR-005, regla `consultas-sin-dominio`); la consulta solo pide el permiso y devuelve el resultado.
 */

/** Cuántas partes devuelve una página si no se pide otro número, y el máximo que se acepta. */
const PAGINA_POR_DEFECTO = 50;
const PAGINA_MAXIMA = 100;

export type EntradaDeBuscarPartes = Readonly<{
  /** Lo escrito en el buscador: un documento (se busca idéntico) o parte del nombre. Vacío: todas. */
  texto?: string | undefined;
  rol?: string | undefined;
  incluirDesactivadas?: boolean | undefined;
  despuesDe?: string | undefined;
  limite?: number | undefined;
}>;

export type ParteDeLista = Readonly<{
  id: string;
  naturaleza: "HUMANA" | "JURIDICA";
  /** Persona: «apellido nombre»; empresa: su razón social; más el alias si lo tiene. */
  nombre: string;
  documento: Readonly<{ tipo: string; pais: string | null; numero: string }> | null;
  email: string | null;
  telefono: string | null;
  roles: readonly RolDeParte[];
  activa: boolean;
}>;

export type PaginaDePartes = Readonly<{
  partes: readonly ParteDeLista[];
  /** El id de la última parte de la página para pedir la siguiente (`despuesDe`), o `null` si no hay más. */
  siguiente: string | null;
}>;

export type EntradaDePosiblesDuplicados = Readonly<{
  nombre: string;
  apellido?: string | null | undefined;
  alias?: string | null | undefined;
  email?: string | null | undefined;
  telefono?: string | null | undefined;
}>;

export type DuplicadoDeLista = Readonly<{
  parteId: string;
  nombre: string;
  razones: readonly string[];
}>;

function aDeLista(parte: Parte, roles: readonly RolDeParte[]): ParteDeLista {
  return {
    id: parte.id,
    naturaleza: parte.naturaleza,
    nombre: nombreCompletoDeParte(parte),
    documento: parte.documento,
    email: parte.email,
    telefono: parte.telefono,
    roles,
    activa: parte.estado === "ACTIVA",
  };
}

/** Los roles activos de cada parte, agrupados por id. */
export function rolesActivosPorParte(
  roles: readonly Readonly<{ parteId: string; rol: RolDeParte; activo: boolean }>[],
): Map<string, RolDeParte[]> {
  const mapa = new Map<string, RolDeParte[]>();
  for (const r of roles) if (r.activo) mapa.set(r.parteId, [...(mapa.get(r.parteId) ?? []), r.rol]);
  return mapa;
}

/** El nombre para mostrar de una parte (el que usan las listas y las fichas). */
export const nombreParaMostrar = (parte: Parte): string => nombreCompletoDeParte(parte);

/**
 * Buscar partes (E9 §3.1): documento idéntico primero, luego los nombres que empiezan con lo escrito y al final los que lo contienen; paginada por la
 * última parte vista. La clasificación y el orden son del dominio (`busqueda.ts`); la base solo trae los candidatos (hasta
 * `TOPE_DE_CANDIDATOS_DE_BUSQUEDA`). Devuelve `null` si el rol pedido no existe y `"CURSOR_INVALIDO"` si la parte de la que sigue ya no está.
 */
export async function buscarPartesDentro(
  tx: Pick<TxDeConsultasDeClientes, "partes">,
  contexto: ContextoOperativo,
  entrada: EntradaDeBuscarPartes,
): Promise<PaginaDePartes | "CURSOR_INVALIDO"> {
  const texto = (entrada.texto ?? "").trim();
  const textoNormalizado = normalizarParaBusqueda(texto);
  const documentoBuscado = documentoBuscadoDesdeTexto(texto);
  let rol: RolDeParte | null = null;
  if (entrada.rol !== undefined) {
    if (!esRolDeParte(entrada.rol)) return { partes: [], siguiente: null };
    rol = entrada.rol;
  }
  const candidatos = await tx.partes.candidatos(contexto.empresaId, {
    textoNormalizado,
    documentoBuscado,
    rol,
    incluirDesactivadas: entrada.incluirDesactivadas === true,
  });
  // Sin nada escrito se listan todas (por nombre); con algo escrito, solo las que coinciden.
  const buscando = textoNormalizado !== "" || documentoBuscado !== null;
  const coincidencias = candidatos.flatMap((parte) => {
    const clase = buscando
      ? claseDeCoincidencia(
          {
            id: parte.id,
            nombreDeBusqueda: parte.nombreDeBusqueda,
            documentoNormalizado: parte.documentoNormalizado,
          },
          textoNormalizado,
          documentoBuscado,
        )
      : ("EMPIEZA" as const);
    return clase === null
      ? []
      : [
          {
            clase,
            candidato: {
              id: parte.id,
              nombreDeBusqueda: parte.nombreDeBusqueda,
              documentoNormalizado: parte.documentoNormalizado,
              parte,
            },
          },
        ];
  });
  const ordenadas = ordenarCoincidencias(coincidencias);
  let desde = 0;
  if (entrada.despuesDe !== undefined) {
    const posicion = ordenadas.findIndex((p) => p.id === entrada.despuesDe);
    if (posicion === -1) return "CURSOR_INVALIDO";
    desde = posicion + 1;
  }
  const limite = Math.min(Math.max(entrada.limite ?? PAGINA_POR_DEFECTO, 1), PAGINA_MAXIMA);
  const pagina = ordenadas.slice(desde, desde + limite);
  const roles = rolesActivosPorParte(
    await tx.partes.rolesDe(
      contexto.empresaId,
      pagina.map((p) => p.id),
    ),
  );
  return {
    partes: pagina.map((p) => aDeLista(p.parte, roles.get(p.id) ?? [])),
    siguiente: desde + limite < ordenadas.length ? (pagina.at(-1)?.id ?? null) : null,
  };
}

/** Los posibles duplicados de lo que se está escribiendo: las partes de la empresa con el mismo email, teléfono o nombre. Un aviso: no bloquea. */
export async function posiblesDuplicadosDe(
  tx: Pick<TxDeConsultasDeClientes, "partes">,
  contexto: ContextoOperativo,
  entrada: EntradaDePosiblesDuplicados,
): Promise<readonly DuplicadoDeLista[]> {
  const email = emailDeContactoDesdeTexto(entrada.email ?? "");
  const datos = {
    nombre: entrada.nombre.trim(),
    apellido: entrada.apellido?.trim() || null,
    alias: entrada.alias?.trim() || null,
    email: email.ok ? email.valor : null,
    telefono: entrada.telefono?.trim() || null,
  };
  const buscados = buscadosDeDuplicado({
    naturaleza: "HUMANA",
    nombre: datos.nombre,
    apellido: datos.apellido,
    alias: datos.alias,
    documento: null,
    condicionIva: null,
    email: datos.email,
    telefono: datos.telefono,
    domicilio: null,
    nota: null,
  });
  const candidatas = await tx.partes.posiblesDuplicados(contexto.empresaId, buscados, null);
  const nuestra = {
    email: datos.email,
    telefono: datos.telefono,
    nombreCompleto: nombreCompletoDeParte(datos),
  };
  return candidatas.map((p) => ({
    parteId: p.id,
    nombre: nombreCompletoDeParte(p),
    razones: razonesDeDuplicado(nuestra, {
      email: p.email,
      telefono: p.telefono,
      nombreCompleto: nombreCompletoDeParte(p),
    }),
  }));
}
