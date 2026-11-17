import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cuentaPorId, idDerivado, lineasDeCuenta, type Linea } from "../../ventas/publico";
import { huellaDeEnvio, huellaDeImpresion } from "../dominio/huella";
import {
  nombreParaLaCocina,
  rotuloDeEnvio,
  seleccionarParaElEnvio,
  type LineaDeComanda,
  type TipoDeEnvio,
} from "../dominio/envio";
import { usoParaElDocumento, type TipoDeDocumento } from "../dominio/impresion";
import type { Envio, Renglon } from "../persistencia/repositorio-de-envios";
import {
  exigirAlcance,
  exigirClave,
  exigirJornadaAbierta,
  exigirUuid,
  prepararComando,
  traducir,
} from "./comun";
import type { DependenciasDeComandas, TxDeComandas } from "./contrato";
import type { ErrorDeComandas } from "./errores";

type R<S> = Resultado<S, ErrorDeComandas>;

/** Hasta cuántos conflictos de serialización se repite un envío: varios mozos envían a la vez en la misma mesa (el repetido es seguro: ids derivados). */
export const REINTENTOS_AL_ENVIAR = 20;

/** Cuántas líneas se pueden pedir de una vez en «Pedir que salga» (una cuenta no pasa de ahí). */
const MAXIMO_DE_LINEAS_PEDIDAS = 200;

export type EntradaDeEnviarACocina = Readonly<{
  /** Lo manda la pantalla: es el id del envío (idempotencia). */
  envioId: string;
  cuentaId: string;
  /** «Mesa 5»: lo arma quien llama (el salón) desde la mesa; comandas no sabe qué es una mesa. Es una foto. */
  rotulo: string;
  /** La clave de idempotencia de la pantalla, por intento (la forma la valida `exigirClave`). */
  claveIdempotencia: string;
}>;

export type EntradaDePedirQueSalga = Readonly<{
  envioId: string;
  cuentaId: string;
  /** Las líneas que esperan y se piden, o `"TODAS"`. */
  lineaIds: readonly string[] | "TODAS";
  rotulo: string;
  claveIdempotencia: string;
}>;

export type SalidaDeEnvio = Readonly<{
  envioId: string;
  numero: number;
  tipo: TipoDeEnvio;
  enviadoEn: Date;
  fechaNegocio: string;
  /** Cuántas líneas salieron en este envío. */
  lineas: number;
  /** El trabajo de impresión original de este envío (siempre se crea: sin impresora es «Ver en pantalla»). */
  trabajoId: string;
  sinImpresora: boolean;
  /** Solo «pedir que salga»: las pedidas que no esperaban (ya enviadas, quitadas o ajenas): se ignoran con aviso, no fallan el resto. */
  ignoradas: readonly string[];
  yaExistia: boolean;
}>;

/** El id del trabajo de impresión original de un documento: derivado (sin azar), para que repetir el caso no cree otro. */
export const trabajoIdDelDocumento = (
  empresaId: string,
  tipo: TipoDeDocumento,
  documentoId: string,
): string => idDerivado("comandas.trabajo", empresaId, tipo, documentoId);

/** La clave del trabajo original: la misma regla (derivada) que su id. */
export const claveDelTrabajoOriginal = (
  empresaId: string,
  tipo: TipoDeDocumento,
  documentoId: string,
): string => idDerivado("comandas.trabajo.clave", empresaId, tipo, documentoId);

/**
 * El trabajo de impresión ORIGINAL del documento recién creado (envío o aviso), en la misma transacción: impresora de cocina de la sucursal (la única
 * activa de ese uso, o la primera por nombre: S-14) o ninguna («Ver en pantalla»). Un documento original tiene un solo trabajo (única de la base). El
 * envío NUNCA depende de que la impresora funcione (S-9).
 */
export async function crearTrabajoOriginalEnTx(
  tx: TxDeComandas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  datos: Readonly<{ sucursalId: string; documentoTipo: TipoDeDocumento; documentoId: string }>,
): Promise<Readonly<{ trabajoId: string; impresoraId: string | null }>> {
  const { empresaId } = contexto;
  const impresoras = await tx.impresion.impresorasDeSucursal(empresaId, datos.sucursalId, {
    uso: usoParaElDocumento(datos.documentoTipo),
  });
  const impresoraId = impresoras[0]?.id ?? null;
  const trabajoId = trabajoIdDelDocumento(empresaId, datos.documentoTipo, datos.documentoId);
  await tx.impresion.insertarTrabajo(empresaId, {
    id: trabajoId,
    sucursalId: datos.sucursalId,
    impresoraId,
    documentoTipo: datos.documentoTipo,
    documentoId: datos.documentoId,
    esCopia: false,
    clave: claveDelTrabajoOriginal(empresaId, datos.documentoTipo, datos.documentoId),
    huella: huellaDeImpresion({
      documentoTipo: datos.documentoTipo,
      documentoId: datos.documentoId,
      impresoraId,
      esCopia: false,
    }),
    solicitadoPor: persona,
    solicitadoEn: contexto.ahora,
  });
  return { trabajoId, impresoraId };
}

/** Lo que dice la foto de una línea para la cocina: su nombre y su detalle (variante y opciones, también las ocultas de la carta). */
function renglonDeLaLinea(linea: Linea, orden: number, rol: "SALE" | "ESPERA"): Renglon {
  return {
    orden,
    lineaId: linea.id,
    cantidad: linea.cantidad,
    rol,
    nombreDeCocina: nombreParaLaCocina(linea),
    detalleDeCocina: [
      ...(linea.varianteNombre === null ? [] : [linea.varianteNombre]),
      ...linea.opciones.map((o) => o.nombre),
    ],
  };
}

async function salidaDeEnvioExistente(
  tx: TxDeComandas,
  empresaId: ContextoOperativo["empresaId"],
  envio: Envio,
  ignoradas: readonly string[],
): Promise<SalidaDeEnvio> {
  const renglones = await tx.envios.renglonesDeEnvio(empresaId, envio.id);
  const trabajo = await tx.impresion.trabajoOriginalDe(empresaId, "COMANDA", envio.id);
  return {
    envioId: envio.id,
    numero: envio.numero,
    tipo: envio.tipo,
    enviadoEn: envio.enviadoEn,
    fechaNegocio: envio.fechaNegocio,
    lineas: renglones.filter((r) => r.rol === "SALE").length,
    trabajoId:
      trabajo === null ? trabajoIdDelDocumento(empresaId, "COMANDA", envio.id) : trabajo.id,
    sinImpresora: trabajo === null || trabajo.impresoraId === null,
    ignoradas,
    yaExistia: true,
  };
}

/**
 * El envío a cocina (E7 §3.5) y «pedir que salga» (D114: un envío más). Una transacción serializable: guard (`comandas.enviar`), la empresa opera, ids,
 * clave y rótulo válidos, la cuenta de la empresa en el alcance y ABIERTA, la jornada abierta; IDEMPOTENCIA por clave y por `envioId` (misma huella →
 * el mismo resultado, `yaExistia`; otra huella → `CLAVE_REUTILIZADA` / `ENVIO_ID_EN_USO`). Toma las líneas con
 * `UPDATE linea_de_comanda SET envio_id … WHERE envio_id IS NULL` (cada línea sale en UN envío) y el número del contador de la cuenta (`ultimo + 1`: la
 * fila se bloquea, los envíos de una cuenta salen 1..N sin huecos aunque dos mozos envíen a la vez). Guarda la foto del papel (nombre y detalle de cada
 * renglón: la reimpresión sale idéntica aunque el catálogo cambie) y el trabajo de impresión original. Sin nada para enviar, `NADA_PARA_ENVIAR`
 * (el segundo mozo recibe el aviso, no un envío vacío). Audita `ENVIO_REGISTRADO` o `SALIDA_PEDIDA`.
 */
async function enviarConTipoEnTx(
  tx: TxDeComandas,
  contexto: ContextoOperativo,
  persona: { valor: PersonaId },
  tipo: TipoDeEnvio,
  entrada: EntradaDeEnviarACocina & Readonly<{ lineaIds?: readonly string[] | "TODAS" }>,
): Promise<R<SalidaDeEnvio>> {
  const { empresaId } = contexto;
  const pedidas = tipo === "ENVIO" ? "TODAS" : (entrada.lineaIds ?? "TODAS");
  const ids = exigirUuid(
    entrada.envioId,
    entrada.cuentaId,
    ...(pedidas === "TODAS" ? [] : pedidas),
  );
  if (!ids.ok) return ids;
  const clave = exigirClave(entrada.claveIdempotencia);
  if (!clave.ok) return clave;
  const rotulo = rotuloDeEnvio(entrada.rotulo);
  if (!rotulo.ok) return rotulo;
  if (pedidas !== "TODAS" && (pedidas.length === 0 || pedidas.length > MAXIMO_DE_LINEAS_PEDIDAS)) {
    return err("ENTRADA_VACIA");
  }

  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;

  // Repetición: la misma clave (o el mismo id de envío) con el mismo contenido devuelve lo hecho, sin papel nuevo.
  const huella = huellaDeEnvio({ cuentaId: cuenta.id, tipo, lineaIds: pedidas });
  const porClave = await tx.envios.envioPorClave(empresaId, entrada.claveIdempotencia);
  if (porClave !== null) {
    return porClave.huella === huella && porClave.id === entrada.envioId
      ? ok(await salidaDeEnvioExistente(tx, empresaId, porClave, []))
      : err("CLAVE_REUTILIZADA");
  }
  const porId = await tx.envios.envioPorId(empresaId, entrada.envioId);
  if (porId !== null) {
    return porId.huella === huella && porId.cuentaId === cuenta.id
      ? ok(await salidaDeEnvioExistente(tx, empresaId, porId, []))
      : err("ENVIO_ID_EN_USO");
  }

  if (cuenta.estado !== "ABIERTA") return err("CUENTA_NO_ABIERTA");
  const jornada = await exigirJornadaAbierta(tx, contexto, cuenta.sucursalId);
  if (!jornada.ok) return jornada;

  const lineas = (await lineasDeCuenta(tx, empresaId, cuenta.id)).filter(
    (l) => l.estado === "VIGENTE",
  );
  // Una línea vigente sin fila de comanda cuenta como «para enviar»: se crea la fila (fail closed, nunca queda una línea que nadie envía).
  await tx.envios.asegurarFilas(
    empresaId,
    cuenta.id,
    lineas.map((l) => l.id),
  );
  const filas = new Map(
    (await tx.envios.filasDeCuenta(empresaId, cuenta.id)).map((f) => [f.lineaId, f]),
  );
  const estado: LineaDeComanda[] = lineas.map((l) => ({
    lineaId: l.id,
    vigente: true,
    envioId: filas.get(l.id)?.envioId ?? null,
    salida: filas.get(l.id)?.salida ?? "AHORA",
  }));
  const seleccion = seleccionarParaElEnvio(tipo, estado, pedidas);
  if (seleccion.salen.length === 0)
    return err(tipo === "ENVIO" ? "NADA_PARA_ENVIAR" : "NADA_QUE_PEDIR");

  const numero = await tx.envios.siguienteNumero(empresaId, cuenta.id);
  const envio = await tx.envios.insertarEnvio(empresaId, {
    id: entrada.envioId,
    sucursalId: cuenta.sucursalId,
    cuentaId: cuenta.id,
    numero,
    tipo,
    rotulo: rotulo.valor,
    enviadoPor: persona.valor,
    enviadoEn: contexto.ahora,
    clave: entrada.claveIdempotencia,
    huella,
  });
  // El árbitro: lo que de verdad quedó en este envío es lo que devolvió el UPDATE (otro envío a la vez deja la línea en el suyo).
  const tomadas = new Set(await tx.envios.tomarParaEnviar(empresaId, envio.id, seleccion.salen));
  if (tomadas.size === 0) return err(tipo === "ENVIO" ? "NADA_PARA_ENVIAR" : "NADA_QUE_PEDIR");
  const porLinea = new Map<string, Linea>(lineas.map((l) => [l.id, l]));
  const renglones: Renglon[] = [];
  for (const id of seleccion.salen) {
    const l = porLinea.get(id);
    if (l !== undefined && tomadas.has(id)) {
      renglones.push(renglonDeLaLinea(l, renglones.length + 1, "SALE"));
    }
  }
  for (const id of seleccion.esperan) {
    const l = porLinea.get(id);
    if (l !== undefined) renglones.push(renglonDeLaLinea(l, renglones.length + 1, "ESPERA"));
  }
  await tx.envios.insertarRenglones(empresaId, envio.id, renglones);
  const trabajo = await crearTrabajoOriginalEnTx(tx, contexto, persona.valor, {
    sucursalId: cuenta.sucursalId,
    documentoTipo: "COMANDA",
    documentoId: envio.id,
  });
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona.valor,
    accion: tipo === "ENVIO" ? "ENVIO_REGISTRADO" : "SALIDA_PEDIDA",
    entidad: "envio_de_comanda",
    entidadId: envio.id,
    despues: {
      cuentaId: cuenta.id,
      numero,
      rotulo: rotulo.valor,
      lineas: [...tomadas],
      esperan: seleccion.esperan,
      trabajoId: trabajo.trabajoId,
    },
  });
  return ok({
    envioId: envio.id,
    numero,
    tipo,
    enviadoEn: envio.enviadoEn,
    fechaNegocio: envio.fechaNegocio,
    lineas: tomadas.size,
    trabajoId: trabajo.trabajoId,
    sinImpresora: trabajo.impresoraId === null,
    ignoradas: seleccion.ignoradas,
    yaExistia: false,
  });
}

/** `enviarACocinaEnTx`: el envío DENTRO de la transacción del llamador (el salón arma el rótulo «Mesa N» en el servidor); el permiso lo exige quien llama. */
export const enviarACocinaEnTx = (
  tx: TxDeComandas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeEnviarACocina,
): Promise<R<SalidaDeEnvio>> =>
  enviarConTipoEnTx(tx, contexto, { valor: persona }, "ENVIO", entrada);

/** `pedirQueSalgaEnTx`: «pedir que salga» (un envío más) dentro de la transacción del llamador; el permiso lo exige quien llama. */
export const pedirQueSalgaEnTx = (
  tx: TxDeComandas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDePedirQueSalga,
): Promise<R<SalidaDeEnvio>> =>
  enviarConTipoEnTx(tx, contexto, { valor: persona }, "SALIDA_PEDIDA", entrada);

async function enviar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  tipo: TipoDeEnvio,
  entrada: EntradaDeEnviarACocina & Readonly<{ lineaIds?: readonly string[] | "TODAS" }>,
): Promise<R<SalidaDeEnvio>> {
  const persona = await prepararComando(tx, contexto, dependencias.reglas, ["comandas.enviar"]);
  if (!persona.ok) return persona;
  return enviarConTipoEnTx(tx, contexto, persona, tipo, entrada);
}

export function armarEnviarACocina(dependencias: DependenciasDeComandas) {
  return async function enviarACocina(
    contexto: ContextoOperativo,
    entrada: EntradaDeEnviarACocina,
  ): Promise<R<SalidaDeEnvio>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, reintentos: REINTENTOS_AL_ENVIAR },
      (tx) => enviar(tx, dependencias, contexto, "ENVIO", entrada),
    );
    return traducir(resultado);
  };
}

export function armarPedirQueSalga(dependencias: DependenciasDeComandas) {
  return async function pedirQueSalga(
    contexto: ContextoOperativo,
    entrada: EntradaDePedirQueSalga,
  ): Promise<R<SalidaDeEnvio>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, reintentos: REINTENTOS_AL_ENVIAR },
      (tx) => enviar(tx, dependencias, contexto, "SALIDA_PEDIDA", entrada),
    );
    return traducir(resultado);
  };
}
