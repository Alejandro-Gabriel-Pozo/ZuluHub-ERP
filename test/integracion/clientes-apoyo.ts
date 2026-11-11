import { randomUUID } from "node:crypto";
import pg from "pg";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import {
  crearCasosDeUsoDeClientes,
  crearConsultasDeClientes,
  crearDirectorioDePartes,
  crearRegistroDePartes,
  crearRepositoriosDeClientes,
  type RepositoriosDeClientes,
} from "../../src/modulos/clientes/publico";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type TxDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de integración de los casos de uso del directorio (E9): las dependencias REALES sobre una base propia (SERIALIZABLE aborta por
 * falsos positivos cuando otros archivos escriben las mismas tablas). `clientes` es un módulo obligatorio y disponible: las reglas son las reales y la
 * autorización sale de la base (rol de la persona), como siempre. Lo que se prueba pasa por el rol real de la aplicación y por los casos de uso; el SQL
 * del dueño solo arma el escenario.
 */

export type EscenarioDeClientes = Readonly<{
  empresa: string;
  empresaId: EmpresaId;
  gerente: ContextoOperativo;
  administrador: ContextoOperativo;
  operador: ContextoOperativo;
  personaDelOperador: PersonaId;
}>;

type TxDePruebaConClientes = TxDePrueba & RepositoriosDeClientes;

export async function montarClientes(base: BaseDePruebas) {
  const propia = await crearBaseAparte(base);
  let barrera: () => Promise<void> = () => Promise.resolve();
  const entorno = crearEntornoDePrueba(propia.base, 12, (tx) => {
    let primera = true;
    return {
      ...tx,
      ...crearRepositoriosDeClientes(tx.db),
      autorizacion: {
        ...tx.autorizacion,
        delActor: async (contexto) => {
          const datos = await tx.autorizacion.delActor(contexto);
          if (primera) {
            primera = false;
            await barrera();
          }
          return datos;
        },
      },
    };
  }) as unknown as TransaccionesDePostgres<TxDePruebaConClientes>;
  const dueno = new pg.Client({ connectionString: propia.base.dueno });
  await dueno.connect();
  const casos = crearCasosDeUsoDeClientes({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
  const consultas = crearConsultasDeClientes({ transacciones: entorno, reglas: REGLAS_DE_EMPRESA });
  const directorio = crearDirectorioDePartes();
  const registro = crearRegistroDePartes();

  const miembro = async (empresa: string, rol: RolDePrueba) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol);
    return p.id;
  };

  const escenario = async (): Promise<EscenarioDeClientes> => {
    const e = await crearEmpresaActiva(entorno);
    const gerente = personaId(await miembro(e.empresa, "GERENTE"));
    const administrador = personaId(await miembro(e.empresa, "ADMINISTRADOR"));
    const operador = personaId(await miembro(e.empresa, "OPERADOR"));
    return {
      empresa: e.empresa,
      empresaId: e.empresa,
      gerente: comoEmpresa(e.empresa, gerente),
      administrador: comoEmpresa(e.empresa, administrador),
      operador: comoEmpresa(e.empresa, operador),
      personaDelOperador: operador,
    };
  };

  const filas = async <T extends Record<string, unknown> = Record<string, unknown>>(
    texto: string,
    p: unknown[] = [],
  ) => (await dueno.query<T>(texto, p)).rows;
  const contar = async (texto: string, p: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, p))[0]?.n);
  const auditoria = (empresa: string, accion?: string) =>
    filas(
      `select accion, actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa
        where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
      [empresa, accion ?? null],
    );

  return {
    propia,
    entorno,
    dueno,
    casos,
    consultas,
    directorio,
    registro,
    escenario,
    filas,
    contar,
    auditoria,
    armarBarrera: (participantes: number) => {
      barrera = crearBarrera(participantes);
    },
    soltarBarrera: () => {
      barrera = () => Promise.resolve();
    },
    cerrar: async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    },
  };
}

export type MontajeDeClientes = Awaited<ReturnType<typeof montarClientes>>;

/** Un `ok` esperado: si falla, el mensaje dice por qué (los errores son datos, no excepciones). */
export function valorDe<T, E>(r: Readonly<{ ok: true; valor: T } | { ok: false; error: E }>): T {
  if (!r.ok) throw new Error(`se esperaba ok y vino ${JSON.stringify(r.error)}`);
  return r.valor;
}

export const nuevoId = (): string => randomUUID();

/** Un nombre al azar sin dígitos (la lista de permitidos los admite, pero así no se confunden con un documento). */
export const nombreAlAzar = (prefijo = "Parte"): string =>
  `${prefijo} ${randomUUID()
    .slice(0, 8)
    .replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "x")}`;

/** Las rondas de las pruebas de concurrencia (`PEDERNAL_RONDAS`, 3 por defecto: el CI tiene un tope de tiempo ajustado). */
export const RONDAS = (() => {
  const crudo = process.env["PEDERNAL_RONDAS"];
  const n = crudo === undefined ? 3 : Number(crudo);
  return Number.isInteger(n) && n >= 1 ? n : 3;
})();
