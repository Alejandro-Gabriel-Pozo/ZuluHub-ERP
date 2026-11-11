import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cuentaPorId } from "../../ventas/publico";
import { huellaDeImpresion } from "../dominio/huella";
import {
  tipoDeDocumento,
  usoParaElDocumento,
  RESULTADOS_DE_INTENTO,
  type EstadoDeTrabajo,
  type TipoDeDocumento,
} from "../dominio/impresion";
import type { Trabajo } from "../persistencia/repositorio-de-impresion";
import { exigirAlcance, exigirClave, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeComandas, TxDeComandas } from "./contrato";
import type { ErrorDeComandas } from "./errores";

type R<S> = Resultado<S, ErrorDeComandas>;

/**
 * La sucursal del documento a imprimir, leída de LA EMPRESA (otra empresa es inexistente): el envío, el aviso de anulación (por su cuenta) o el ticket.
 * Un documento que no existe no se imprime (`DOCUMENTO_NO_ENCONTRADO`).
 */
export async function sucursalDelDocumento(
  tx: TxDeComandas,
  empresaId: ContextoOperativo["empresaId"],
  tipo: TipoDeDocumento,
  documentoId: string,
): Promise<string | null> {
  if (tipo === "COMANDA")
    return (await tx.envios.envioPorId(empresaId, documentoId))?.sucursalId ?? null;
  if (tipo === "ANULACION") {
    const aviso = await tx.envios.avisoPorId(empresaId, documentoId);
    if (aviso === null) return null;
    return (await cuentaPorId(tx, empresaId, aviso.cuentaId))?.sucursalId ?? null;
  }
  return (await tx.tickets.obtener(empresaId, documentoId as never))?.sucursalId ?? null;
}

export type EntradaDeSolicitarImpresion = Readonly<{
  /** Lo manda la pantalla: es el id del trabajo si es el original (idempotencia). */
  trabajoId: string;
  documentoTipo: string;
  documentoId: string;
  /** Una impresora de la sucursal que sirva a ese documento; sin ella, la de cocina o del cliente de la sucursal (o «Ver en pantalla»). */
  impresoraId?: string | undefined;
  claveIdempotencia: string;
}>;

export type SalidaDeImpresion = Readonly<{
  trabajoId: string;
  estado: EstadoDeTrabajo;
  intentos: number;
  impresoraId: string | null;
  /** Sin impresora para ese uso: la pantalla muestra el documento («Ver en pantalla») y, para quien puede, «Configurar impresoras». */
  sinImpresora: boolean;
  /** `true` si ya existía (segundo toque) y no se hizo nada nuevo. */
  yaExistia: boolean;
  /** `true` si era «Reintentar»: el MISMO trabajo con un intento más. */
  reintento: boolean;
}>;

const salida = (
  t: Trabajo,
  flags: { yaExistia: boolean; reintento: boolean },
): SalidaDeImpresion => ({
  trabajoId: t.id,
  estado: t.estado,
  intentos: t.intentos,
  impresoraId: t.impresoraId,
  sinImpresora: t.impresoraId === null,
  ...flags,
});

/** La impresora pedida (de la sucursal, activa y de ese uso) o, sin pedir, la de cocina o del cliente de la sucursal: la única activa, o la primera por nombre. */
async function elegirImpresora(
  tx: TxDeComandas,
  empresaId: ContextoOperativo["empresaId"],
  sucursal: string,
  tipo: TipoDeDocumento,
  pedida: string | undefined,
): Promise<R<string | null>> {
  const uso = usoParaElDocumento(tipo);
  if (pedida !== undefined) {
    const i = await tx.impresion.impresoraPorId(empresaId, pedida);
    if (i === null || i.sucursalId !== sucursal || !i.activa) return err("IMPRESORA_NO_ENCONTRADA");
    return i.uso === uso ? ok(i.id) : err("IMPRESORA_NO_SIRVE");
  }
  const impresoras = await tx.impresion.impresorasDeSucursal(empresaId, sucursal, { uso });
  return ok(impresoras[0]?.id ?? null);
}

/** Lo común a imprimir y pedir una copia: guard, ids, tipo, el documento y su sucursal en el alcance. */
async function prepararImpresion(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  accion: "impresiones.imprimir" | "impresiones.reimprimir",
  entrada: Readonly<{
    trabajoId: string;
    documentoTipo: string;
    documentoId: string;
    impresoraId?: string | undefined;
    claveIdempotencia: string;
  }>,
) {
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [accion]);
  if (!persona.ok) return persona;
  const ids = exigirUuid(
    entrada.trabajoId,
    entrada.documentoId,
    ...(entrada.impresoraId === undefined ? [] : [entrada.impresoraId]),
  );
  if (!ids.ok) return ids;
  const clave = exigirClave(entrada.claveIdempotencia);
  if (!clave.ok) return clave;
  const tipo = tipoDeDocumento(entrada.documentoTipo);
  if (!tipo.ok) return tipo;
  const sucursal = await sucursalDelDocumento(
    tx,
    contexto.empresaId,
    tipo.valor,
    entrada.documentoId,
  );
  if (sucursal === null) return err("DOCUMENTO_NO_ENCONTRADO" as const);
  const alcance = await exigirAlcance(tx, contexto, sucursalId(sucursal));
  if (!alcance.ok) return alcance;
  return ok({ persona: persona.valor, tipo: tipo.valor, sucursal });
}

/**
 * `solicitarImpresion` (E7 §3.5 y §3.10): pide imprimir un documento ORIGINAL (comanda, aviso de anulación o ticket). Un documento original tiene UN solo
 * trabajo por más toques que haya (única de la base): el segundo toque devuelve el mismo trabajo (`yaExistia`, sin papel nuevo). Si ya existe y está
 * `FALLIDA`, es «Reintentar»: el MISMO trabajo, `intentos + 1`. Sin impresora para ese uso el trabajo queda para «Ver en pantalla». Guard
 * (`impresiones.imprimir`). Audita `IMPRESION_SOLICITADA`. «Impresa» no se confirma acá: lo declara el dispositivo (`declararResultadoDeImpresion`, S-13).
 */
async function solicitar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeSolicitarImpresion,
): Promise<R<SalidaDeImpresion>> {
  const { empresaId } = contexto;
  const previo = await prepararImpresion(
    tx,
    dependencias,
    contexto,
    "impresiones.imprimir",
    entrada,
  );
  if (!previo.ok) return previo;
  const { persona, tipo, sucursal } = previo.valor;
  const huella = huellaDeImpresion({
    documentoTipo: tipo,
    documentoId: entrada.documentoId,
    impresoraId: entrada.impresoraId ?? null,
    esCopia: false,
  });
  const porClave = await tx.impresion.trabajoPorClave(empresaId, entrada.claveIdempotencia);
  if (porClave !== null) {
    return porClave.huella === huella && !porClave.esCopia
      ? ok(salida(porClave, { yaExistia: true, reintento: false }))
      : err("CLAVE_REUTILIZADA");
  }
  const original = await tx.impresion.trabajoOriginalDe(empresaId, tipo, entrada.documentoId);
  if (original !== null) {
    if (original.estado !== "FALLIDA")
      return ok(salida(original, { yaExistia: true, reintento: false }));
    if (!(await tx.impresion.reintentar(empresaId, original.id))) {
      const actual = await tx.impresion.trabajoPorId(empresaId, original.id);
      return ok(salida(actual ?? original, { yaExistia: true, reintento: false }));
    }
    const nuevo = await tx.impresion.trabajoPorId(empresaId, original.id);
    if (nuevo === null) throw new Error("el trabajo reintentado no existe");
    await tx.auditoria.registrar({
      empresaId,
      actorPersonaId: persona,
      accion: "IMPRESION_SOLICITADA",
      entidad: "trabajo_de_impresion",
      entidadId: nuevo.id,
      despues: {
        documentoTipo: tipo,
        documentoId: entrada.documentoId,
        reintento: true,
        intentos: nuevo.intentos,
      },
    });
    return ok(salida(nuevo, { yaExistia: false, reintento: true }));
  }
  const porId = await tx.impresion.trabajoPorId(empresaId, entrada.trabajoId);
  if (porId !== null) return err("TRABAJO_ID_EN_USO");
  const impresora = await elegirImpresora(tx, empresaId, sucursal, tipo, entrada.impresoraId);
  if (!impresora.ok) return impresora;
  const insertado = await tx.impresion.insertarTrabajo(empresaId, {
    id: entrada.trabajoId,
    sucursalId: sucursal,
    impresoraId: impresora.valor,
    documentoTipo: tipo,
    documentoId: entrada.documentoId,
    esCopia: false,
    clave: entrada.claveIdempotencia,
    huella,
    solicitadoPor: persona,
    solicitadoEn: contexto.ahora,
  });
  if (!insertado) {
    const ganador = await tx.impresion.trabajoOriginalDe(empresaId, tipo, entrada.documentoId);
    if (ganador === null) return err("TRABAJO_ID_EN_USO");
    return ok(salida(ganador, { yaExistia: true, reintento: false }));
  }
  const creado = await tx.impresion.trabajoPorId(empresaId, entrada.trabajoId);
  if (creado === null) throw new Error("el trabajo recién creado no existe");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "IMPRESION_SOLICITADA",
    entidad: "trabajo_de_impresion",
    entidadId: creado.id,
    despues: {
      documentoTipo: tipo,
      documentoId: entrada.documentoId,
      impresoraId: impresora.valor,
    },
  });
  return ok(salida(creado, { yaExistia: false, reintento: false }));
}

export function armarSolicitarImpresion(dependencias: DependenciasDeComandas) {
  return async function solicitarImpresion(
    contexto: ContextoOperativo,
    entrada: EntradaDeSolicitarImpresion,
  ): Promise<R<SalidaDeImpresion>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, reintentos: 10 },
      (tx) => solicitar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}

export type EntradaDeSolicitarCopia = EntradaDeSolicitarImpresion;

/**
 * `solicitarCopia` (E7 §3.5, D120): una reimpresión es un trabajo NUEVO (`es_copia`) con su clave; el papel dice «Copia» y lleva la hora del envío
 * ORIGINAL (no la de ahora). Deja constancia de quién y cuándo (`COPIA_SOLICITADA`) y NO cambia nada de la cuenta, del envío ni del stock. Guard
 * (`impresiones.reimprimir`). Repetir con la misma clave devuelve el mismo trabajo.
 */
async function copiar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeSolicitarCopia,
): Promise<R<SalidaDeImpresion>> {
  const { empresaId } = contexto;
  const previo = await prepararImpresion(
    tx,
    dependencias,
    contexto,
    "impresiones.reimprimir",
    entrada,
  );
  if (!previo.ok) return previo;
  const { persona, tipo, sucursal } = previo.valor;
  const huella = huellaDeImpresion({
    documentoTipo: tipo,
    documentoId: entrada.documentoId,
    impresoraId: entrada.impresoraId ?? null,
    esCopia: true,
  });
  const porClave = await tx.impresion.trabajoPorClave(empresaId, entrada.claveIdempotencia);
  if (porClave !== null) {
    return porClave.huella === huella && porClave.esCopia
      ? ok(salida(porClave, { yaExistia: true, reintento: false }))
      : err("CLAVE_REUTILIZADA");
  }
  if ((await tx.impresion.trabajoPorId(empresaId, entrada.trabajoId)) !== null) {
    return err("TRABAJO_ID_EN_USO");
  }
  const impresora = await elegirImpresora(tx, empresaId, sucursal, tipo, entrada.impresoraId);
  if (!impresora.ok) return impresora;
  await tx.impresion.insertarTrabajo(empresaId, {
    id: entrada.trabajoId,
    sucursalId: sucursal,
    impresoraId: impresora.valor,
    documentoTipo: tipo,
    documentoId: entrada.documentoId,
    esCopia: true,
    clave: entrada.claveIdempotencia,
    huella,
    solicitadoPor: persona,
    solicitadoEn: contexto.ahora,
  });
  const creado = await tx.impresion.trabajoPorId(empresaId, entrada.trabajoId);
  if (creado === null) throw new Error("el trabajo recién creado no existe");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "COPIA_SOLICITADA",
    entidad: "trabajo_de_impresion",
    entidadId: creado.id,
    despues: {
      documentoTipo: tipo,
      documentoId: entrada.documentoId,
      impresoraId: impresora.valor,
    },
  });
  return ok(salida(creado, { yaExistia: false, reintento: false }));
}

export function armarSolicitarCopia(dependencias: DependenciasDeComandas) {
  return async function solicitarCopia(
    contexto: ContextoOperativo,
    entrada: EntradaDeSolicitarCopia,
  ): Promise<R<SalidaDeImpresion>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      copiar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}

export type EntradaDeDeclararResultado = Readonly<{
  trabajoId: string;
  /** El intento que declara (1 es el primero; «Reintentar» suma uno). */
  numero: number;
  resultado: string;
}>;
export type SalidaDeDeclararResultado = Readonly<{
  trabajoId: string;
  estado: EstadoDeTrabajo;
  intentos: number;
  yaExistia: boolean;
}>;

/**
 * `declararResultadoDeImpresion` (E7 §3.5, S-13): el dispositivo declara `IMPRESA` o `FALLIDA` para un intento. El navegador no puede confirmar que salió el
 * papel: «Impresa» es lo que declaró el dispositivo, no una verificación. Idempotente por `(trabajo, número)`: el mismo resultado otra vez es lo mismo;
 * otro distinto, `RESULTADO_YA_DECLARADO`. El estado del trabajo lo mueve el disparador de la base. Guard (`impresiones.imprimir`).
 */
async function declarar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeDeclararResultado,
): Promise<R<SalidaDeDeclararResultado>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [
    "impresiones.imprimir",
  ]);
  if (!persona.ok) return persona;
  const ids = exigirUuid(entrada.trabajoId);
  if (!ids.ok) return ids;
  const resultado = RESULTADOS_DE_INTENTO.find((r) => r === entrada.resultado);
  if (resultado === undefined) return err("RESULTADO_INVALIDO");
  if (!Number.isSafeInteger(entrada.numero) || entrada.numero < 1 || entrada.numero > 1000) {
    return err("INTENTO_NO_PEDIDO");
  }
  const trabajo = await tx.impresion.trabajoPorId(empresaId, entrada.trabajoId);
  if (trabajo === null) return err("TRABAJO_NO_ENCONTRADO");
  const alcance = await exigirAlcance(tx, contexto, sucursalId(trabajo.sucursalId));
  if (!alcance.ok) return alcance;
  if (entrada.numero > trabajo.intentos) return err("INTENTO_NO_PEDIDO");
  const nuevo = await tx.impresion.insertarIntento(empresaId, {
    trabajoId: trabajo.id,
    numero: entrada.numero,
    resultado,
    declaradoPor: persona.valor,
    declaradoEn: contexto.ahora,
  });
  if (!nuevo) {
    const previo = await tx.impresion.intentoDe(empresaId, trabajo.id, entrada.numero);
    if (previo === null || previo.resultado !== resultado) return err("RESULTADO_YA_DECLARADO");
  }
  const actual = await tx.impresion.trabajoPorId(empresaId, trabajo.id);
  if (actual === null) throw new Error("el trabajo no existe");
  return ok({
    trabajoId: actual.id,
    estado: actual.estado,
    intentos: actual.intentos,
    yaExistia: !nuevo,
  });
}

export function armarDeclararResultadoDeImpresion(dependencias: DependenciasDeComandas) {
  return async function declararResultadoDeImpresion(
    contexto: ContextoOperativo,
    entrada: EntradaDeDeclararResultado,
  ): Promise<R<SalidaDeDeclararResultado>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, reintentos: 10 },
      (tx) => declarar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
