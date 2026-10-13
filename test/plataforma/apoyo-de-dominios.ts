import type { RolDePlataforma } from "../../src/capacidades/permisos/plataforma";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import type {
  DominioGuardado,
  DominioPorAgregar,
  RepositorioDeDominios,
} from "../../src/modulos/marcas/publico";
import {
  crearCasosDeUsoDeDominios,
  type CasosDeUsoDeDominios,
} from "../../src/plataforma/casos-de-uso/dominios";
import type { TxDeDominios } from "../../src/plataforma/casos-de-uso/dominios-comun";
import { dominioId, marcaComercialId } from "../../src/primitivas/identificadores/marca";
import {
  AHORA,
  auditoriaFalsa,
  conRol,
  idempotenciaFalsa,
  transaccionesDe,
  uuid,
} from "./apoyo-de-soporte";

/**
 * Apoyo de las pruebas SIN base de datos de los casos de uso de dominios (M4a): un repositorio en memoria
 * que registra cada llamada, y la transacción de mentira con la auditoría y la idempotencia en memoria
 * (las mismas de soporte).
 */

export const CLAVE_DE_DOMINIOS = "clave-de-dominios-0001";
export const MARCA_DE_PRUEBA = marcaComercialId(uuid(70));

export function dominioDePrueba(cambios: Partial<DominioGuardado> = {}): DominioGuardado {
  return {
    id: dominioId(uuid(500)),
    host: "carta.ejemplo.com.ar" as DominioGuardado["host"],
    superficie: "CARTA",
    titular: "CLIENTE",
    duenio: { tipo: "MARCA", marcaId: MARCA_DE_PRUEBA },
    marcaId: MARCA_DE_PRUEBA,
    esCanonico: false,
    estado: "PENDIENTE_VERIFICACION",
    verificadoEn: null,
    motivo: null,
    registradoPor: uuid(1),
    version: 1,
    ...cambios,
  };
}

export type RepositorioFalso = RepositorioDeDominios & {
  readonly llamadas: string[];
  readonly filas: Map<string, DominioGuardado>;
  /** Hace que `cambiarEstado` no encuentre la versión (otra transacción cambió antes). */
  perderLaVersion: boolean;
};

export function repositorioFalso(iniciales: readonly DominioGuardado[] = []): RepositorioFalso {
  const filas = new Map(iniciales.map((d) => [d.id as string, d]));
  const llamadas: string[] = [];
  const repo: RepositorioFalso = {
    llamadas,
    filas,
    perderLaVersion: false,
    obtener: (id) => {
      llamadas.push("obtener");
      return Promise.resolve(filas.get(id) ?? null);
    },
    crear: (alta: DominioPorAgregar) => {
      llamadas.push("crear");
      const creado = dominioDePrueba({
        id: dominioId(uuid(600 + filas.size)),
        host: alta.host,
        superficie: alta.superficie,
        titular: alta.titular,
        duenio: alta.duenio,
        esCanonico: alta.esCanonico,
      });
      filas.set(creado.id, creado);
      return Promise.resolve(creado);
    },
    cambiarEstado: (id, versionEsperada, cambio) => {
      llamadas.push(`cambiarEstado:${cambio.estado}`);
      const actual = filas.get(id);
      if (actual === undefined || actual.version !== versionEsperada || repo.perderLaVersion) {
        return Promise.resolve(null);
      }
      const nuevo: DominioGuardado = {
        ...actual,
        estado: cambio.estado,
        verificadoEn:
          cambio.estado === "VERIFICADO"
            ? cambio.verificadoEn
            : cambio.estado === "PENDIENTE_VERIFICACION"
              ? null
              : actual.verificadoEn,
        motivo: cambio.estado === "RETIRADO" ? cambio.motivo : actual.motivo,
        version: actual.version + 1,
      };
      filas.set(id, nuevo);
      return Promise.resolve(nuevo);
    },
  };
  return repo;
}

export function armarDominios(
  iniciales: readonly DominioGuardado[] = [],
  rol: RolDePlataforma | null = "ADMIN",
) {
  const dominios = repositorioFalso(iniciales);
  const auditoria = auditoriaFalsa();
  const idempotencia = idempotenciaFalsa();
  const tx: TxDeDominios = {
    dominios,
    autorizacionDePlataforma: conRol(rol),
    auditoriaDePlataforma: auditoria,
    idempotencia,
  };
  const transacciones = transaccionesDe(tx);
  const casos: CasosDeUsoDeDominios = crearCasosDeUsoDeDominios({
    transacciones,
    reglas: REGLAS_DE_PLATAFORMA,
  });
  return { casos, dominios, auditoria, idempotencia, transacciones, AHORA };
}
