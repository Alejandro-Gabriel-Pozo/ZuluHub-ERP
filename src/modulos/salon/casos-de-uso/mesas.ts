import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId, type PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cuentaAbiertaPorAncla } from "../../ventas/publico";
import { celdasDeMesa, type CasillaDeMesa } from "../dominio/celdas";
import {
  formaDeMesa,
  numeroDeMesa,
  tamanoDeMesa,
  type FormaDeMesa,
  type TamanoDeMesa,
} from "../dominio/mesa";
import type { Mesa } from "../persistencia/repositorio-de-mesas";
import { exigirAlcance, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeSalon, TxDeSalon } from "./contrato";
import type { ErrorDeSalon } from "./errores";

type R<S> = Resultado<S, ErrorDeSalon>;

/** El tipo de ancla de una cuenta de mesa (E7 §3.2): su id es el de la mesa. */
export const ANCLA_DE_MESA = "salon.mesa";

export type DatosDeMesa = Readonly<{
  numero: number;
  forma: string;
  tamano: string;
  columna: number;
  fila: number;
}>;

export type EntradaDeCrearMesa = DatosDeMesa &
  Readonly<{
    /** Lo manda la pantalla: «guardar dos veces es una sola mesa» (`mesas.html:272`). */
    mesaId: string;
    sucursalId: string;
  }>;
export type EntradaDeEditarMesa = DatosDeMesa &
  Readonly<{ mesaId: string; versionEsperada?: number | undefined }>;
export type EntradaDeMesaPorId = Readonly<{ mesaId: string }>;

export type SalidaDeMesa = Readonly<{ mesaId: string; version: number; yaExistia: boolean }>;

type Validados = Readonly<{
  numero: number;
  forma: FormaDeMesa;
  tamano: TamanoDeMesa;
  columna: number;
  fila: number;
  casillas: readonly CasillaDeMesa[];
}>;

/** Valida los datos de la mesa con lista de permitidos (rangos y conjuntos cerrados) y calcula las casillas que ocupa: todo antes de escribir. */
function validar(d: DatosDeMesa): R<Validados> {
  const numero = numeroDeMesa(d.numero);
  if (!numero.ok) return numero;
  const forma = formaDeMesa(d.forma);
  if (!forma.ok) return forma;
  const tamano = tamanoDeMesa(d.tamano);
  if (!tamano.ok) return tamano;
  const celdas = celdasDeMesa({
    forma: forma.valor,
    tamano: tamano.valor,
    columna: d.columna,
    fila: d.fila,
  });
  if (!celdas.ok) return celdas;
  return ok({
    numero: numero.valor,
    forma: forma.valor,
    tamano: tamano.valor,
    columna: d.columna,
    fila: d.fila,
    casillas: celdas.valor,
  });
}

const mismosDatos = (m: Mesa, v: Validados): boolean =>
  m.numero === v.numero &&
  m.forma === v.forma &&
  m.tamano === v.tamano &&
  m.columna === v.columna &&
  m.fila === v.fila;

const datosParaAuditar = (m: Pick<Mesa, "numero" | "forma" | "tamano" | "columna" | "fila">) => ({
  numero: m.numero,
  forma: m.forma,
  tamano: m.tamano,
  columna: m.columna,
  fila: m.fila,
});

/** La mesa de la empresa y de una sucursal del alcance de quien pide (otra empresa es inexistente). */
async function mesaDelAlcance(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  mesaId: string,
): Promise<R<Mesa>> {
  const mesa = await tx.mesas.obtener(contexto.empresaId, mesaId);
  if (mesa === null) return err("MESA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, mesa.sucursalId);
  if (!alcance.ok) return alcance;
  return ok(mesa);
}

/**
 * `crearMesa` (E7 §3.4): da de alta una mesa en el plano de la sucursal. Una transacción serializable: guard (`mesas.crear`), la empresa opera, la sucursal
 * existe, está activa y en el alcance, los datos son válidos (número 1 a 99, forma y tamaño de las listas, casillas dentro de 14 × 9) y las casillas están
 * libres (`MESA_SUPERPUESTA`); recién ahí escribe. El `mesaId` lo manda la pantalla: repetir devuelve la misma mesa (`yaExistia`); el mismo id con otro
 * contenido es `MESA_ID_EN_USO`. Dos altas a la vez que se pisan: la única de la base deja pasar a una. Audita `MESA_CREADA`.
 */
async function crear(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeCrearMesa,
): Promise<R<SalidaDeMesa>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.mesaId, entrada.sucursalId);
  if (!ids.ok) return ids;
  const datos = validar(entrada);
  if (!datos.ok) return datos;
  const sucursal = sucursalId(entrada.sucursalId);
  const alcance = await exigirAlcance(tx, contexto, sucursal);
  if (!alcance.ok) return alcance;
  const fila = await tx.sucursales.obtener(empresaId, sucursal);
  if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
  if (!fila.activa) return err("SUCURSAL_INACTIVA");

  const guardada = await tx.mesas.obtener(empresaId, entrada.mesaId);
  if (guardada !== null) {
    return guardada.sucursalId === sucursal && mismosDatos(guardada, datos.valor)
      ? ok({ mesaId: guardada.id, version: guardada.version, yaExistia: true })
      : err("MESA_ID_EN_USO");
  }
  const pisan = await tx.mesas.mesasQuePisan(empresaId, sucursal, null, datos.valor.casillas);
  if (pisan.length > 0) return err({ error: "MESA_SUPERPUESTA", numeros: pisan });
  await tx.mesas.insertar(empresaId, {
    id: entrada.mesaId,
    sucursalId: sucursal,
    numero: datos.valor.numero,
    forma: datos.valor.forma,
    tamano: datos.valor.tamano,
    columna: datos.valor.columna,
    fila: datos.valor.fila,
    creadaPor: persona,
    creadaEn: contexto.ahora,
  });
  await tx.mesas.ocuparCasillas(empresaId, sucursal, entrada.mesaId, datos.valor.casillas);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "MESA_CREADA",
    entidad: "mesa",
    entidadId: entrada.mesaId,
    despues: { sucursalId: sucursal, ...datosParaAuditar(datos.valor) },
  });
  return ok({ mesaId: entrada.mesaId, version: 1, yaExistia: false });
}

/**
 * `editarMesa`: cambia el número, la forma, el tamaño o la posición de una mesa ACTIVA. Guard (`mesas.editar`); `versionEsperada` (si viene) es el control
 * de versión: si otro la cambió antes, `VERSION_DESACTUALIZADA` y no se escribe. Con los mismos datos devuelve lo vigente sin escribir (`yaExistia`).
 * Las casillas viejas se marcan inactivas y se ocupan las nuevas (nunca se borra). Audita `MESA_EDITADA` con antes y después.
 */
async function editar(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeEditarMesa,
): Promise<R<SalidaDeMesa>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.mesaId);
  if (!ids.ok) return ids;
  const datos = validar(entrada);
  if (!datos.ok) return datos;
  const mesa = await mesaDelAlcance(tx, contexto, entrada.mesaId);
  if (!mesa.ok) return mesa;
  const actual = mesa.valor;
  if (entrada.versionEsperada !== undefined && entrada.versionEsperada !== actual.version) {
    return mismosDatos(actual, datos.valor)
      ? ok({ mesaId: actual.id, version: actual.version, yaExistia: true })
      : err("VERSION_DESACTUALIZADA");
  }
  if (mismosDatos(actual, datos.valor)) {
    return ok({ mesaId: actual.id, version: actual.version, yaExistia: true });
  }
  if (!actual.activa) return err("MESA_INACTIVA");
  const pisan = await tx.mesas.mesasQuePisan(
    empresaId,
    actual.sucursalId,
    actual.id,
    datos.valor.casillas,
  );
  if (pisan.length > 0) return err({ error: "MESA_SUPERPUESTA", numeros: pisan });
  const cambiada = await tx.mesas.cambiar(
    empresaId,
    actual.id,
    datosParaAuditar(datos.valor),
    actual.version,
  );
  if (!cambiada) return err("VERSION_DESACTUALIZADA");
  await tx.mesas.liberarCasillas(empresaId, actual.sucursalId, actual.id);
  await tx.mesas.ocuparCasillas(empresaId, actual.sucursalId, actual.id, datos.valor.casillas);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "MESA_EDITADA",
    entidad: "mesa",
    entidadId: actual.id,
    antes: datosParaAuditar(actual),
    despues: datosParaAuditar(datos.valor),
  });
  return ok({ mesaId: actual.id, version: actual.version + 1, yaExistia: false });
}

/**
 * `desactivarMesa`: una mesa nunca se borra, se desactiva (queda su número reservado y sus tickets viejos). No se desactiva con una cuenta abierta,
 * unida o dividida (`MESA_CON_CUENTA`: la unión y la división dejan abierta la cuenta de reserva que ocupa su ancla). Repetir da `yaExistia`.
 * Guard (`mesas.desactivar`). Libera sus casillas. Audita `MESA_DESACTIVADA`.
 */
async function desactivar(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeMesaPorId,
): Promise<R<SalidaDeMesa>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.mesaId);
  if (!ids.ok) return ids;
  const mesa = await mesaDelAlcance(tx, contexto, entrada.mesaId);
  if (!mesa.ok) return mesa;
  const actual = mesa.valor;
  if (!actual.activa) return ok({ mesaId: actual.id, version: actual.version, yaExistia: true });
  const abierta = await cuentaAbiertaPorAncla(tx, empresaId, {
    tipo: ANCLA_DE_MESA,
    id: actual.id,
  });
  if (abierta !== null) return err("MESA_CON_CUENTA");
  const hecha = await tx.mesas.fijarActiva(empresaId, actual.id, false, actual.version);
  if (!hecha) return err("VERSION_DESACTUALIZADA");
  await tx.mesas.liberarCasillas(empresaId, actual.sucursalId, actual.id);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "MESA_DESACTIVADA",
    entidad: "mesa",
    entidadId: actual.id,
    antes: { activa: true },
    despues: { activa: false },
  });
  return ok({ mesaId: actual.id, version: actual.version + 1, yaExistia: false });
}

/** `reactivarMesa`: vuelve a validar las casillas (otra mesa pudo ocuparlas mientras estuvo desactivada: `MESA_SUPERPUESTA`). Repetir da `yaExistia`. */
async function reactivar(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeMesaPorId,
): Promise<R<SalidaDeMesa>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.mesaId);
  if (!ids.ok) return ids;
  const mesa = await mesaDelAlcance(tx, contexto, entrada.mesaId);
  if (!mesa.ok) return mesa;
  const actual = mesa.valor;
  if (actual.activa) return ok({ mesaId: actual.id, version: actual.version, yaExistia: true });
  const casillas = celdasDeMesa(actual);
  if (!casillas.ok) return casillas;
  const pisan = await tx.mesas.mesasQuePisan(
    empresaId,
    actual.sucursalId,
    actual.id,
    casillas.valor,
  );
  if (pisan.length > 0) return err({ error: "MESA_SUPERPUESTA", numeros: pisan });
  const hecha = await tx.mesas.fijarActiva(empresaId, actual.id, true, actual.version);
  if (!hecha) return err("VERSION_DESACTUALIZADA");
  await tx.mesas.ocuparCasillas(empresaId, actual.sucursalId, actual.id, casillas.valor);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "MESA_REACTIVADA",
    entidad: "mesa",
    entidadId: actual.id,
    antes: { activa: false },
    despues: { activa: true },
  });
  return ok({ mesaId: actual.id, version: actual.version + 1, yaExistia: false });
}

export function armarMesas(dependencias: DependenciasDeSalon) {
  const comando = <E>(
    accion: "mesas.crear" | "mesas.editar" | "mesas.desactivar" | "mesas.reactivar",
    cuerpo: (
      tx: TxDeSalon,
      contexto: ContextoOperativo,
      persona: PersonaId,
      entrada: E,
    ) => Promise<R<SalidaDeMesa>>,
  ) =>
    async function ejecutar(contexto: ContextoOperativo, entrada: E): Promise<R<SalidaDeMesa>> {
      const resultado = await dependencias.transacciones.ejecutar({ contexto }, async (tx) => {
        const persona = await prepararComando(tx, contexto, dependencias.reglas, [accion]);
        if (!persona.ok) return persona;
        return cuerpo(tx, contexto, persona.valor, entrada);
      });
      return traducir(resultado);
    };
  return {
    crearMesa: comando("mesas.crear", (tx, contexto, persona, entrada: EntradaDeCrearMesa) =>
      crear(tx, contexto, persona, entrada),
    ),
    editarMesa: comando("mesas.editar", editar),
    desactivarMesa: comando("mesas.desactivar", desactivar),
    reactivarMesa: comando("mesas.reactivar", reactivar),
  };
}
