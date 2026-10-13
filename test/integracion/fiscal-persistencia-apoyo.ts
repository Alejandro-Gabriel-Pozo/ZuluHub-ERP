import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import {
  crearRepositorioDeDatosFiscales,
  crearRepositorioDeDomicilios,
  crearRepositorioDeEmisores,
  crearRepositorioDePuntosDeVenta,
  crearRepositorioDeReglasDeEmisor,
  crearRepositorioDeSeries,
  domicilioId,
  emisorId,
  nuevoBorrador,
  nuevoPuntoDeVenta,
  puntoDeVentaId,
  versionId,
  type DatosFiscalesBorrador,
  type Emisor,
  type FiscalDb,
  type PuntoDeVenta,
  type RepositorioDeDatosFiscales,
  type RepositorioDeDomicilios,
  type RepositorioDeEmisores,
  type RepositorioDePuntosDeVenta,
  type RepositorioDeReglasDeEmisor,
  type RepositorioDeSeries,
} from "../../src/modulos/fiscal/publico";
import {
  crearRepositorioDeEmpresas,
  type EmpresasDb,
  type RepositorioDeEmpresas,
} from "../../src/modulos/empresas/publico";
import { domicilioDesdeDatos, type Domicilio } from "../../src/primitivas/domicilio/domicilio";
import { empresaId, personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, comoPlataforma } from "./entorno";
import type { Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de la persistencia fiscal (H7 T4). Lo que recibe un trabajo de prueba es lo que
 * armaría la composición real: los seis repositorios fiscales sobre `db.withTables<FiscalDb>()`, el de
 * empresas (para los dos disparadores fiscales que saltan al dar de alta o corregir una empresa) y el
 * `db` crudo para consultas de verificación y para forzar lo que ningún repositorio permite.
 */
export type TxFiscalDePrueba = Readonly<{
  db: Kysely<SinTablas>;
  emisores: RepositorioDeEmisores;
  domicilios: RepositorioDeDomicilios;
  datosFiscales: RepositorioDeDatosFiscales;
  reglas: RepositorioDeReglasDeEmisor;
  puntosDeVenta: RepositorioDePuntosDeVenta;
  series: RepositorioDeSeries;
  empresas: RepositorioDeEmpresas;
}>;

/**
 * `ajustar` envuelve lo que recibe el trabajo (para inyectar una barrera o una falla en las pruebas
 * de concurrencia); sin él, es exactamente lo que armaría la composición.
 */
export function crearEntornoFiscal(
  base: BaseDePruebas,
  maximoDeConexiones = 5,
  ajustar: (tx: TxFiscalDePrueba) => TxFiscalDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxFiscalDePrueba> {
  return crearTransacciones<TxFiscalDePrueba>({
    urls: { OPERATIVO: base.app, PLATAFORMA: base.plataforma },
    armar: (db) => {
      const fiscal = db.withTables<FiscalDb>();
      return ajustar({
        db,
        emisores: crearRepositorioDeEmisores(fiscal),
        domicilios: crearRepositorioDeDomicilios(fiscal),
        datosFiscales: crearRepositorioDeDatosFiscales(fiscal),
        reglas: crearRepositorioDeReglasDeEmisor(fiscal),
        puntosDeVenta: crearRepositorioDePuntosDeVenta(fiscal),
        series: crearRepositorioDeSeries(fiscal),
        empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
      });
    },
    maximoDeConexiones,
    clave: base.clave,
  });
}

/** El contexto de la aplicación de esa empresa, con su persona (la que firma las confirmaciones). */
export const contextoDeApp = (m: Pick<Mundo, "empresa" | "persona">) =>
  comoEmpresa(empresaId(m.empresa), personaId(m.persona));

/** El contexto de la plataforma con el ADMIN de prueba. */
export const contextoDePlataforma = () => comoPlataforma();

// ---- datos de prueba con el dominio real -------------------------------------------------------

export const nuevoId = () => randomUUID();

export function unDomicilio(cambios: Partial<Domicilio> = {}): Domicilio {
  const r = domicilioDesdeDatos({
    calle: "Av. Corrientes",
    numero: "1234",
    piso: null,
    departamento: null,
    localidad: "Rosario",
    provincia: "AR-S",
    codigoPostal: "S2000",
  });
  if (!r.ok) throw new Error("el domicilio de prueba no es válido");
  return { ...r.valor, ...cambios };
}

/** El emisor principal de una empresa, tal como lo leería el repositorio. */
export const elPrincipal = async (
  tx: TxFiscalDePrueba,
  m: Pick<Mundo, "empresa">,
): Promise<Emisor> => {
  const e = await tx.emisores.delPrincipal(empresaId(m.empresa));
  if (e === null) throw new Error("la empresa de prueba no tiene emisor principal");
  return e;
};

/** Un punto de venta nuevo (INACTIVO) del emisor, armado con el dominio. */
export function unPuntoDeVenta(
  m: Pick<Mundo, "empresa" | "sucursal">,
  emisor: Emisor,
  datos: { id?: string; numero?: number; domicilio?: string | null } = {},
): PuntoDeVenta {
  const r = nuevoPuntoDeVenta(
    {
      id: puntoDeVentaId(datos.id ?? nuevoId()),
      numero: datos.numero ?? 1,
      domicilioId:
        datos.domicilio === undefined || datos.domicilio === null
          ? null
          : domicilioId(datos.domicilio),
    },
    emisor,
    { id: sucursalId(m.sucursal), empresaId: empresaId(m.empresa) },
    [],
  );
  if (!r.ok) throw new Error(`el punto de venta de prueba no es válido: ${r.error}`);
  return r.valor;
}

export function unBorrador(
  m: Pick<Mundo, "empresa" | "persona">,
  emisor: Emisor,
  id: string = nuevoId(),
): DatosFiscalesBorrador {
  return nuevoBorrador({
    id: versionId(id),
    empresaId: empresaId(m.empresa),
    emisorId: emisorId(emisor.id),
    creadoPor: personaId(m.persona),
  });
}

/**
 * Un punto de venta armado A MANO, sin pasar por las reglas del dominio: para probar lo que la base
 * frena cuando el dominio no estuvo en el medio (sucursal ajena, número fuera de rango, empresa ajena).
 */
export function unPuntoDeVentaCrudo(datos: {
  empresa: string;
  emisor: string;
  sucursal: string;
  numero?: number;
  id?: string;
  domicilio?: string | null;
}): PuntoDeVenta {
  return {
    id: puntoDeVentaId(datos.id ?? nuevoId()),
    empresaId: empresaId(datos.empresa),
    emisorId: emisorId(datos.emisor),
    sucursalId: sucursalId(datos.sucursal),
    domicilioId:
      datos.domicilio === undefined || datos.domicilio === null
        ? null
        : domicilioId(datos.domicilio),
    numero: datos.numero ?? 1,
    estado: "INACTIVO",
    verificacionArca: "NO_VERIFICADO",
    version: 1,
  };
}
