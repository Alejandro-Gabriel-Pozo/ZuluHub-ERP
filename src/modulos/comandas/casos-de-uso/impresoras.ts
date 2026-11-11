import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { nombreDeImpresora } from "../dominio/envio";
import {
  papelEnMm,
  usoDeImpresora,
  type PapelEnMm,
  type UsoDeImpresora,
} from "../dominio/impresion";
import type { Impresora } from "../persistencia/repositorio-de-impresion";
import { exigirAlcance, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeComandas, TxDeComandas } from "./contrato";
import type { ErrorDeComandas } from "./errores";

type R<S> = Resultado<S, ErrorDeComandas>;

export type EntradaDeRegistrarImpresora = Readonly<{
  /** Lo manda la pantalla: es la idempotencia del alta («guardar dos veces es una sola impresora»). */
  impresoraId: string;
  sucursalId: string;
  nombre: string;
  uso: string;
  papelMm: number;
}>;
export type SalidaDeImpresora = Readonly<{
  impresoraId: string;
  version: number;
  yaExistia: boolean;
}>;

/**
 * `registrarImpresora` (E7 §3.5): da de alta una impresora de la sucursal (comanda o ticket del cliente, 58 u 80 mm). Guard (`impresoras.crear`), la
 * empresa opera, la sucursal en el alcance y activa, nombre, uso y papel de la lista de permitidos. Guardar dos veces el mismo `impresoraId` con lo
 * mismo es una sola impresora (`yaExistia`); con otra cosa, `IMPRESORA_ID_EN_USO`; el nombre es único por sucursal (`NOMBRE_DE_IMPRESORA_EN_USO`).
 * Audita `IMPRESORA_CREADA`.
 */
async function registrar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeRegistrarImpresora,
): Promise<R<SalidaDeImpresora>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, ["impresoras.crear"]);
  if (!persona.ok) return persona;
  const ids = exigirUuid(entrada.impresoraId, entrada.sucursalId);
  if (!ids.ok) return ids;
  const nombre = nombreDeImpresora(entrada.nombre);
  if (!nombre.ok) return nombre;
  const uso = usoDeImpresora(entrada.uso);
  if (!uso.ok) return uso;
  const papel = papelEnMm(entrada.papelMm);
  if (!papel.ok) return papel;
  const sucursal = sucursalId(entrada.sucursalId);
  const alcance = await exigirAlcance(tx, contexto, sucursal);
  if (!alcance.ok) return alcance;
  const fila = await tx.sucursales.obtener(empresaId, sucursal);
  if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
  if (!fila.activa) return err("SUCURSAL_INACTIVA");

  const esLoMismo = (g: Impresora) =>
    g.sucursalId === sucursal &&
    g.nombre === nombre.valor &&
    g.uso === uso.valor &&
    g.papelMm === papel.valor;
  const guardada = await tx.impresion.impresoraPorId(empresaId, entrada.impresoraId);
  if (guardada !== null) {
    return esLoMismo(guardada)
      ? ok({ impresoraId: guardada.id, version: guardada.version, yaExistia: true })
      : err("IMPRESORA_ID_EN_USO");
  }
  const insertada = await tx.impresion.insertarImpresora(empresaId, {
    id: entrada.impresoraId,
    sucursalId: sucursal,
    nombre: nombre.valor,
    uso: uso.valor,
    papelMm: papel.valor,
    creadaPor: persona.valor,
    creadaEn: contexto.ahora,
  });
  if (!insertada) {
    // Otra con ese id (carrera) o ese nombre: se relee para decir cuál.
    const repetida = await tx.impresion.impresoraPorId(empresaId, entrada.impresoraId);
    if (repetida !== null && esLoMismo(repetida)) {
      return ok({ impresoraId: repetida.id, version: repetida.version, yaExistia: true });
    }
    return err(repetida === null ? "NOMBRE_DE_IMPRESORA_EN_USO" : "IMPRESORA_ID_EN_USO");
  }
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona.valor,
    accion: "IMPRESORA_CREADA",
    entidad: "impresora",
    entidadId: entrada.impresoraId,
    despues: { sucursalId: sucursal, nombre: nombre.valor, uso: uso.valor, papelMm: papel.valor },
  });
  return ok({ impresoraId: entrada.impresoraId, version: 1, yaExistia: false });
}

export function armarRegistrarImpresora(dependencias: DependenciasDeComandas) {
  return async function registrarImpresora(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarImpresora,
  ): Promise<R<SalidaDeImpresora>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      registrar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}

export type EntradaDeEditarImpresora = Readonly<{
  impresoraId: string;
  nombre?: string | undefined;
  uso?: string | undefined;
  papelMm?: number | undefined;
  /** Control de versión: si la impresora cambió en el medio, `VERSION_DESACTUALIZADA`. */
  versionEsperada?: number | undefined;
}>;

/**
 * `editarImpresora` (E7 §3.5): cambia nombre, uso o papel. Guard (`impresoras.editar`), la impresora de la empresa en el alcance. Si ya es lo pedido,
 * devuelve lo vigente sin escribir (`yaExistia`); con `versionEsperada` vieja, `VERSION_DESACTUALIZADA`. Audita `IMPRESORA_EDITADA`.
 */
async function editar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeEditarImpresora,
): Promise<R<SalidaDeImpresora>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, ["impresoras.editar"]);
  if (!persona.ok) return persona;
  const ids = exigirUuid(entrada.impresoraId);
  if (!ids.ok) return ids;
  const actual = await tx.impresion.impresoraPorId(empresaId, entrada.impresoraId);
  if (actual === null) return err("IMPRESORA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, sucursalId(actual.sucursalId));
  if (!alcance.ok) return alcance;

  const cambios: { nombre?: string; uso?: UsoDeImpresora; papelMm?: PapelEnMm } = {};
  if (entrada.nombre !== undefined) {
    const n = nombreDeImpresora(entrada.nombre);
    if (!n.ok) return n;
    if (n.valor !== actual.nombre) cambios.nombre = n.valor;
  }
  if (entrada.uso !== undefined) {
    const u = usoDeImpresora(entrada.uso);
    if (!u.ok) return u;
    if (u.valor !== actual.uso) cambios.uso = u.valor;
  }
  if (entrada.papelMm !== undefined) {
    const p = papelEnMm(entrada.papelMm);
    if (!p.ok) return p;
    if (p.valor !== actual.papelMm) cambios.papelMm = p.valor;
  }
  if (Object.keys(cambios).length === 0) {
    return ok({ impresoraId: actual.id, version: actual.version, yaExistia: true });
  }
  if (entrada.versionEsperada !== undefined && entrada.versionEsperada !== actual.version) {
    return err("VERSION_DESACTUALIZADA");
  }
  if (cambios.nombre !== undefined) {
    const mismas = await tx.impresion.impresorasDeSucursal(empresaId, actual.sucursalId, {
      incluirInactivas: true,
    });
    if (mismas.some((i) => i.nombre === cambios.nombre && i.id !== actual.id)) {
      return err("NOMBRE_DE_IMPRESORA_EN_USO");
    }
  }
  const hecho = await tx.impresion.actualizarImpresora(
    empresaId,
    actual.id,
    cambios,
    actual.version,
  );
  if (!hecho) return err("VERSION_DESACTUALIZADA");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona.valor,
    accion: "IMPRESORA_EDITADA",
    entidad: "impresora",
    entidadId: actual.id,
    antes: { nombre: actual.nombre, uso: actual.uso, papelMm: actual.papelMm },
    despues: cambios,
  });
  return ok({ impresoraId: actual.id, version: actual.version + 1, yaExistia: false });
}

export function armarEditarImpresora(dependencias: DependenciasDeComandas) {
  return async function editarImpresora(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarImpresora,
  ): Promise<R<SalidaDeImpresora>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      editar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}

export type EntradaDeDesactivarImpresora = Readonly<{ impresoraId: string }>;
export type SalidaDeDesactivarImpresora = Readonly<{ yaEstabaDesactivada: boolean }>;

/** `desactivarImpresora` (E7 §3.5): se desactiva, no se borra (decisión 62). Guard (`impresoras.desactivar`); repetir devuelve `yaEstabaDesactivada`. Audita `IMPRESORA_DESACTIVADA`. */
async function desactivar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeDesactivarImpresora,
): Promise<R<SalidaDeDesactivarImpresora>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [
    "impresoras.desactivar",
  ]);
  if (!persona.ok) return persona;
  const ids = exigirUuid(entrada.impresoraId);
  if (!ids.ok) return ids;
  const actual = await tx.impresion.impresoraPorId(empresaId, entrada.impresoraId);
  if (actual === null) return err("IMPRESORA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, sucursalId(actual.sucursalId));
  if (!alcance.ok) return alcance;
  if (!actual.activa) return ok({ yaEstabaDesactivada: true });
  await tx.impresion.actualizarImpresora(empresaId, actual.id, { activa: false });
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona.valor,
    accion: "IMPRESORA_DESACTIVADA",
    entidad: "impresora",
    entidadId: actual.id,
    antes: { activa: true },
    despues: { activa: false },
  });
  return ok({ yaEstabaDesactivada: false });
}

export function armarDesactivarImpresora(dependencias: DependenciasDeComandas) {
  return async function desactivarImpresora(
    contexto: ContextoOperativo,
    entrada: EntradaDeDesactivarImpresora,
  ): Promise<R<SalidaDeDesactivarImpresora>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      desactivar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
