import type { RolDePlataforma } from "../../src/capacidades/permisos/plataforma";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeMarcasYPlanes,
  type CasosDeUsoDeMarcasYPlanes,
} from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import type {
  CatalogoDeModulosParaPlanes,
  CatalogoDePerillasParaPlanes,
  DependenciasDeMarcasYPlanes,
  TxDeMarcasYPlanes,
} from "../../src/plataforma/casos-de-uso/marcas-y-planes-comun";
import { MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA } from "../utilidades/planes";
import {
  AHORA,
  auditoriaFalsa,
  conRol,
  idempotenciaFalsa,
  transaccionesDe,
  uuid,
} from "./apoyo-de-soporte";

/**
 * Apoyo de las pruebas SIN base de datos de los casos de uso de marcas y planes (M5): una transacción de
 * mentira en la que la autorización, la auditoría de plataforma y la idempotencia son en memoria, y
 * TODO lo demás (los repositorios, los derechos, la auditoría de empresa) es un objeto que lanza si alguien lo
 * toca. Sirve para probar lo que pasa ANTES de leer o escribir nada: el orden del guard, la forma de la
 * entrada, la clave de idempotencia y la repetición. Lo que lee y escribe se prueba contra Postgres
 * (`test/integracion/marcas-*.test.ts`, `planes-*.test.ts`, `asignaciones-*.test.ts`).
 */

export class SeTocoLoQueNoDebia extends Error {}

/** Un objeto que lanza ante cualquier acceso: así una prueba se entera si un caso lee o escribe de más. */
function prohibido(nombre: string): never {
  return new Proxy(
    {},
    {
      get(_objetivo, propiedad) {
        throw new SeTocoLoQueNoDebia(`${nombre}.${String(propiedad)}`);
      },
    },
  ) as never;
}

export const CATALOGOS: Readonly<{
  catalogoDeModulos: CatalogoDeModulosParaPlanes;
  catalogoDePerillas: CatalogoDePerillasParaPlanes;
}> = { catalogoDeModulos: MODULOS_DE_PRUEBA, catalogoDePerillas: PERILLAS_DE_PRUEBA };

export function armarMarcasYPlanes(rol: RolDePlataforma | null = "ADMIN") {
  const auditoria = auditoriaFalsa();
  const idempotencia = idempotenciaFalsa();
  const tx: TxDeMarcasYPlanes = {
    autorizacionDePlataforma: conRol(rol),
    auditoriaDePlataforma: auditoria,
    idempotencia,
    marcas: prohibido("marcas"),
    planes: prohibido("planes"),
    derechos: prohibido("derechos"),
    auditoriaDeEmpresa: prohibido("auditoriaDeEmpresa"),
  };
  const transacciones = transaccionesDe(tx);
  const dependencias: DependenciasDeMarcasYPlanes = {
    transacciones,
    reglas: REGLAS_DE_PLATAFORMA,
    ...CATALOGOS,
  };
  const casos: CasosDeUsoDeMarcasYPlanes = crearCasosDeUsoDeMarcasYPlanes(dependencias);
  return { casos, auditoria, idempotencia, transacciones, dependencias, tx, AHORA };
}

export const CLAVE = "clave-de-marcas-y-planes-0001";
export const CONTEXTO: ContextoDePlataforma = {
  tipo: "PLATAFORMA",
  actor: { tipo: "ADMIN", id: "aaaaaaaa-0000-4000-8000-000000000001" as never },
  ahora: AHORA,
};

/** Un id con forma de uuid para las entradas. */
export const id = (n: number): string => uuid(n);
