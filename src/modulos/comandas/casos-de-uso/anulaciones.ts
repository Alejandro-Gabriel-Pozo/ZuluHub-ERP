import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  cantidadATexto,
  cantidadDesdeTexto,
  type Cantidad,
} from "../../../primitivas/cantidad/cantidad";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeCantidad,
  restarConSigno,
} from "../../../primitivas/cantidad/con-signo";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  anularLineaEnTx,
  copiarLineaEnTx,
  cuentaPorId,
  idDerivado,
  lineaPorId,
} from "../../ventas/publico";
import { decidirCambiarSalida, rotuloDeEnvio, type SalidaDeLinea } from "../dominio/envio";
import type { Renglon } from "../persistencia/repositorio-de-envios";
import {
  exigirAlcance,
  exigirJornadaAbierta,
  exigirUuid,
  prepararComando,
  traducir,
} from "./comun";
import type { DependenciasDeComandas, TxDeComandas } from "./contrato";
import type { ErrorDeComandas } from "./errores";
import { crearTrabajoOriginalEnTx } from "./envios";
import { copiarEstadoDeComandaEnTx } from "./lineas-de-comanda";
import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import { DECLARACIONES } from "./declaraciones";

type R<S> = Resultado<S, ErrorDeComandas>;

/** Hasta cuántos conflictos de serialización se repite una anulación (el repetido es seguro: ids derivados). */
const REINTENTOS_AL_ANULAR = 10;

/** Los motivos INTERNOS (códigos de máquina, no son textos de pantalla; E7 S-5): quitar un ítem que todavía no se mandó a cocina. */
export const MOTIVO_SIN_ENVIAR = "SIN_ENVIAR";

export type EntradaDeAnularItemEnviado = Readonly<{
  cuentaId: string;
  lineaId: string;
  /** Texto decimal exacto: lo que se anula (≤ lo que hay y múltiplo del paso de la línea). */
  cantidad: string;
  /** Obligatorio, con la lista de permitidos de ventas (decisión 155: quién, cuándo y por qué). */
  motivo: string;
  /** Lo manda la pantalla: es el id del aviso (idempotencia). */
  avisoId: string;
  /** «Mesa 5»: lo arma el salón; es una foto. */
  rotulo: string;
}>;

export type SalidaDeAnularItemEnviado = Readonly<{
  avisoId: string;
  /** Lo que sigue vigente de la línea (texto decimal; `"0.0000"` si se anuló entera). */
  quedan: string;
  /** La línea nueva con el resto, si se anuló una parte. */
  lineaDelResto: string | null;
  trabajoId: string;
  sinImpresora: boolean;
  yaExistia: boolean;
}>;

const leerCantidad = (texto: string): Cantidad | null => {
  try {
    return cantidadDesdeTexto(texto);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
};

/**
 * `anularItemEnviado` (E7 §3.5, decisión 155): anula un ítem que ya se mandó a cocina, entero o en parte, con motivo, auditado y con su AVISO a cocina
 * (el papel «ANULACIÓN · NO PREPARAR»). Total: `anularLineaEnTx`. Parcial: se anula la línea entera y se copia lo que sigue vigente (`copiarLineaEnTx`,
 * modo `RESTO`) AL MISMO PRECIO CONGELADO, con la misma fila de comanda (sigue en su envío: no se reimprime). Una transacción: o se anula, se copia y se
 * avisa, o no pasa nada. Repetir (mismo `avisoId`, o la línea ya anulada con su aviso) devuelve lo hecho. `LINEA_NO_ENVIADA` si todavía no salió
 * (para esas, `quitarSinEnviar`). Lo parcial crea una línea, así que exige la jornada abierta; anular entero no (es la salida de «cuentas abiertas»).
 */
export async function anularItemEnviadoEnTx(
  tx: TxDeComandas,
  contexto: ContextoOperativo,
  personaId: PersonaId,
  entrada: EntradaDeAnularItemEnviado,
): Promise<R<SalidaDeAnularItemEnviado>> {
  const { empresaId } = contexto;
  const persona = { valor: personaId };
  const ids = exigirUuid(entrada.cuentaId, entrada.lineaId, entrada.avisoId);
  if (!ids.ok) return ids;
  const rotulo = rotuloDeEnvio(entrada.rotulo);
  if (!rotulo.ok) return rotulo;

  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const linea = await lineaPorId(tx, empresaId, entrada.lineaId);
  if (linea === null || linea.cuentaId !== cuenta.id) return err("LINEA_NO_ENCONTRADA");

  // Repetición: el aviso de esta línea (con este id, o con otro por un doble clic) ya existe: se devuelve sin escribir.
  const previo =
    (await tx.envios.avisoPorId(empresaId, entrada.avisoId)) ??
    (await tx.envios.avisoPorLinea(empresaId, linea.id));
  if (previo !== null) {
    if (previo.lineaOrigenId !== linea.id) return err("AVISO_ID_EN_USO");
    const trabajo = await tx.impresion.trabajoOriginalDe(empresaId, "ANULACION", previo.id);
    const copiaDelResto = await buscarResto(tx, empresaId, previo.id, linea.id);
    return ok({
      avisoId: previo.id,
      quedan: previo.quedan,
      lineaDelResto: copiaDelResto,
      trabajoId: trabajo === null ? "" : trabajo.id,
      sinImpresora: trabajo === null || trabajo.impresoraId === null,
      yaExistia: true,
    });
  }

  if (linea.estado !== "VIGENTE") return err("LINEA_NO_VIGENTE");
  const fila = await tx.envios.filaDeComanda(empresaId, linea.id);
  if (fila === null || fila.envioId === null) return err("LINEA_NO_ENVIADA");

  const anuladaLeida = leerCantidad(entrada.cantidad);
  const hayLeida = leerCantidad(linea.cantidad);
  const pasoLeido = leerCantidad(linea.pasoDeCantidad);
  if (anuladaLeida === null || hayLeida === null || pasoLeido === null) {
    return err("CANTIDAD_INVALIDA");
  }
  const anulada = anuladaLeida.unidades;
  const hay = hayLeida.unidades;
  const paso = pasoLeido.unidades;
  if (anulada <= 0n || anulada > hay || anulada % paso !== 0n) return err("CANTIDAD_INVALIDA");
  const resto = restarConSigno(
    cantidadConSignoDesdeCantidad(hayLeida),
    cantidadConSignoDesdeCantidad(anuladaLeida),
  );
  if (!resto.ok) return err("CANTIDAD_INVALIDA");
  const queda = resto.valor.unidades;
  const quedaTexto = cantidadConSignoATexto(resto.valor);
  if (queda > 0n) {
    // Lo parcial agrega una línea con el resto: exige la jornada abierta, como agregar.
    const jornada = await exigirJornadaAbierta(tx, contexto, cuenta.sucursalId);
    if (!jornada.ok) return jornada;
    if (linea.importeFijo !== null) return err("CANTIDAD_INVALIDA");
  }

  // La foto de lo que se mandó a cocina (nombre y detalle del renglón con que SALIÓ), siguiendo la cadena de copias si la línea es el resto de otra.
  const salida = await renglonDeSalidaDe(tx, empresaId, linea.id);
  if (salida === null) return err("LINEA_NO_ENVIADA");

  const anulacion = await anularLineaEnTx(tx, contexto, persona.valor, {
    cuentaId: cuenta.id,
    lineaId: linea.id,
    motivo: entrada.motivo,
  });
  if (!anulacion.ok) return anulacion;
  if (anulacion.valor.yaEstabaAnulada) return err("LINEA_NO_VIGENTE");

  let lineaDelResto: string | null = null;
  if (queda > 0n) {
    lineaDelResto = idDerivado("comandas.resto", empresaId, entrada.avisoId, linea.id);
    const copia = await copiarLineaEnTx(tx, contexto, persona.valor, {
      lineaOrigenId: linea.id,
      cuentaDestinoId: cuenta.id,
      lineaNuevaId: lineaDelResto,
      cantidad: quedaTexto,
      modo: "RESTO",
    });
    if (!copia.ok) return copia;
    const estado = await copiarEstadoDeComandaEnTx(tx, contexto, {
      lineaOrigenId: linea.id,
      lineaNuevaId: lineaDelResto,
      cuentaDestinoId: cuenta.id,
    });
    if (!estado.ok) return estado;
  }
  const quedan = quedaTexto;
  await tx.envios.insertarAviso(empresaId, {
    id: entrada.avisoId,
    cuentaId: cuenta.id,
    lineaOrigenId: linea.id,
    envioId: fila.envioId,
    cantidad: cantidadATexto(anuladaLeida),
    quedan,
    motivo: entrada.motivo.trim(),
    nombreDeCocina: salida.nombreDeCocina,
    detalleDeCocina: salida.detalleDeCocina,
    rotulo: rotulo.valor,
    anuladoPor: persona.valor,
    anuladoEn: contexto.ahora,
  });
  const trabajo = await crearTrabajoOriginalEnTx(tx, contexto, persona.valor, {
    sucursalId: cuenta.sucursalId,
    documentoTipo: "ANULACION",
    documentoId: entrada.avisoId,
  });
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona.valor,
    accion: "ITEM_ENVIADO_ANULADO",
    entidad: "aviso_de_anulacion",
    entidadId: entrada.avisoId,
    despues: {
      cuentaId: cuenta.id,
      lineaId: linea.id,
      envioId: fila.envioId,
      cantidad: entrada.cantidad,
      quedan,
      lineaDelResto,
      motivo: entrada.motivo.trim(),
      trabajoId: trabajo.trabajoId,
    },
  });
  return ok({
    avisoId: entrada.avisoId,
    quedan,
    lineaDelResto,
    trabajoId: trabajo.trabajoId,
    sinImpresora: trabajo.impresoraId === null,
    yaExistia: false,
  });
}

/** El guard de un caso de esta puerta: exige lo que su declaración dice (`accionesDeCaso`), ni más ni menos. */
const exigirLoDeclarado = (
  tx: TxDeComandas,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeComandas,
  caso: "anularItemEnviado" | "quitarSinEnviar" | "cambiarSalida",
) => prepararComando(tx, contexto, dependencias.reglas, accionesDeCaso(DECLARACIONES[caso]));

async function anularItem(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeAnularItemEnviado,
): Promise<R<SalidaDeAnularItemEnviado>> {
  const persona = await exigirLoDeclarado(tx, contexto, dependencias, "anularItemEnviado");
  if (!persona.ok) return persona;
  return anularItemEnviadoEnTx(tx, contexto, persona.valor, entrada);
}

/** La línea con el resto de una anulación parcial ya hecha (para devolverla al repetir): la que se derivó del aviso. */
async function buscarResto(
  tx: TxDeComandas,
  empresaId: ContextoOperativo["empresaId"],
  avisoId: string,
  lineaId: string,
): Promise<string | null> {
  const id = idDerivado("comandas.resto", empresaId, avisoId, lineaId);
  return (await lineaPorId(tx, empresaId, id)) === null ? null : id;
}

/** El renglón con que SALIÓ la línea a cocina: si la línea es el resto de otra (copia), el de la que la originó. */
async function renglonDeSalidaDe(
  tx: TxDeComandas,
  empresaId: ContextoOperativo["empresaId"],
  lineaId: string,
): Promise<Renglon | null> {
  let actual = lineaId;
  for (let i = 0; i < 20; i++) {
    const encontrado = await tx.envios.renglonDeSalida(empresaId, actual);
    if (encontrado !== null) return encontrado.renglon;
    const copia = await tx.cuentas.copiaDe(empresaId, actual as never);
    if (copia === null) return null;
    actual = copia.lineaOrigenId;
  }
  return null;
}

export function armarAnularItemEnviado(dependencias: DependenciasDeComandas) {
  return async function anularItemEnviado(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularItemEnviado,
  ): Promise<R<SalidaDeAnularItemEnviado>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, reintentos: REINTENTOS_AL_ANULAR },
      (tx) => anularItem(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}

export type EntradaDeQuitarSinEnviar = Readonly<{ cuentaId: string; lineaId: string }>;
export type SalidaDeQuitarSinEnviar = Readonly<{ yaEstabaQuitada: boolean }>;

/**
 * `quitarSinEnviar` (E7 §3.5, D114): quitar un plato que todavía no se mandó a cocina se hace sin trámite (no se pide texto: el motivo es el código
 * interno `SIN_ENVIAR`) y no imprime nada. Con el plato ya enviado, `LINEA_YA_ENVIADA` (para eso, `anularItemEnviado`). Repetir devuelve `yaEstabaQuitada`.
 */
async function quitar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeQuitarSinEnviar,
): Promise<R<SalidaDeQuitarSinEnviar>> {
  const { empresaId } = contexto;
  const persona = await exigirLoDeclarado(tx, contexto, dependencias, "quitarSinEnviar");
  if (!persona.ok) return persona;
  const ids = exigirUuid(entrada.cuentaId, entrada.lineaId);
  if (!ids.ok) return ids;
  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const linea = await lineaPorId(tx, empresaId, entrada.lineaId);
  if (linea === null || linea.cuentaId !== cuenta.id) return err("LINEA_NO_ENCONTRADA");
  const fila = await tx.envios.filaDeComanda(empresaId, linea.id);
  if (fila !== null && fila.envioId !== null) return err("LINEA_YA_ENVIADA");
  if (linea.estado !== "VIGENTE") {
    return linea.motivoDeAnulacion === MOTIVO_SIN_ENVIAR
      ? ok({ yaEstabaQuitada: true })
      : err("LINEA_NO_VIGENTE");
  }
  const anulada = await anularLineaEnTx(tx, contexto, persona.valor, {
    cuentaId: cuenta.id,
    lineaId: linea.id,
    motivo: MOTIVO_SIN_ENVIAR,
  });
  if (!anulada.ok) return anulada;
  return ok({ yaEstabaQuitada: anulada.valor.yaEstabaAnulada });
}

export function armarQuitarSinEnviar(dependencias: DependenciasDeComandas) {
  return async function quitarSinEnviar(
    contexto: ContextoOperativo,
    entrada: EntradaDeQuitarSinEnviar,
  ): Promise<R<SalidaDeQuitarSinEnviar>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      quitar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}

export type EntradaDeCambiarSalida = Readonly<{
  cuentaId: string;
  lineaId: string;
  salida: SalidaDeLinea;
}>;
export type SalidaDeCambiarSalida = Readonly<{ salida: SalidaDeLinea; yaEstaba: boolean }>;

/**
 * `cambiarSalida` (E7 §3.5, D114): «sale ahora / sale después» de un plato, SOLO mientras no se envió (`UPDATE … WHERE envio_id IS NULL`: si otro lo
 * envió a la vez, `LINEA_YA_ENVIADA`). Pedir la salida que ya tiene devuelve `yaEstaba`. Exige la jornada abierta, como agregar.
 */
async function cambiar(
  tx: TxDeComandas,
  dependencias: DependenciasDeComandas,
  contexto: ContextoOperativo,
  entrada: EntradaDeCambiarSalida,
): Promise<R<SalidaDeCambiarSalida>> {
  const { empresaId } = contexto;
  const persona = await exigirLoDeclarado(tx, contexto, dependencias, "cambiarSalida");
  if (!persona.ok) return persona;
  const ids = exigirUuid(entrada.cuentaId, entrada.lineaId);
  if (!ids.ok) return ids;
  if (entrada.salida !== "AHORA" && entrada.salida !== "DESPUES") return err("SALIDA_INVALIDA");
  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const linea = await lineaPorId(tx, empresaId, entrada.lineaId);
  if (linea === null || linea.cuentaId !== cuenta.id) return err("LINEA_NO_ENCONTRADA");
  const jornada = await exigirJornadaAbierta(tx, contexto, cuenta.sucursalId);
  if (!jornada.ok) return jornada;
  await tx.envios.asegurarFilas(empresaId, cuenta.id, [linea.id]);
  const fila = await tx.envios.filaDeComanda(empresaId, linea.id);
  const decision = decidirCambiarSalida({
    vigente: linea.estado === "VIGENTE",
    envioId: fila === null ? null : fila.envioId,
  });
  if (!decision.ok) return err(decision.error);
  if (fila !== null && fila.salida === entrada.salida) {
    return ok({ salida: entrada.salida, yaEstaba: true });
  }
  if (!(await tx.envios.cambiarSalida(empresaId, linea.id, entrada.salida))) {
    return err("LINEA_YA_ENVIADA");
  }
  return ok({ salida: entrada.salida, yaEstaba: false });
}

export function armarCambiarSalida(dependencias: DependenciasDeComandas) {
  return async function cambiarSalida(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarSalida,
  ): Promise<R<SalidaDeCambiarSalida>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      cambiar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
