import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import { datosDeJornada } from "../../empresas/publico";
import { validarHoraDeConteo } from "../dominio/conteo";
import { esUnidadConocida } from "../dominio/composicion";
import type { RegistroGuardado } from "../persistencia/modelo";
import { autorizar, traducir } from "./comun";
import { cargarConteo } from "./conteos-comun";
import type { DependenciasDeStock, TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import {
  aUnidadDeStock,
  cargarDeposito,
  leerCantidad,
  leerDetalle,
  leerId,
} from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

export type EntradaDeAbrirConteo = Readonly<{
  /** Lo manda la pantalla (idempotencia de abrirlo). */
  id: string;
  depositoId: string;
}>;
export type SalidaDeAbrirConteo = Readonly<{ conteoId: string; yaExistia: boolean }>;

export type EntradaDeRegistrarConteo = Readonly<{
  /** Lo manda la pantalla: recontar es un registro NUEVO (otro `id`) y vale el último. */
  id: string;
  conteoId: string;
  productoId: string;
  /** Lo que contó la persona, en texto decimal (cero es válido: no había nada), en la unidad `unidadId`. */
  cantidadContada: string;
  unidadId: string;
  /**
   * La hora a la que se contó ESTE artículo (la pantalla la precarga con la de la carga y la persona la confirma o la corrige). Sin ella, el servidor
   * usa la de la carga. No puede ser futura, cae en la jornada vigente o en la anterior de la sucursal y no es anterior al último conteo aplicado
   * del depósito. Es un dato que la persona declaró: un reintento que la manda tiene que mandar la misma.
   */
  contadoEn?: Date | undefined;
}>;
export type SalidaDeRegistrarConteo = Readonly<{ yaExistia: boolean }>;

export type EntradaDeCancelarConteo = Readonly<{ conteoId: string; motivo: string }>;
export type SalidaDeCancelarConteo = Readonly<{ yaEstaba: boolean }>;

/** Lo que un registro guardado dice, para compararlo con lo que se pide (una repetición es el MISMO registro). */
const esElMismoRegistro = (
  guardado: RegistroGuardado,
  pedido: Readonly<{
    conteoId: string;
    articuloId: string;
    unidades: bigint;
    contadoEn: Date | undefined;
  }>,
): boolean => {
  const cantidad = cantidadConSignoDesdeTexto(guardado.cantidadContada);
  return (
    guardado.conteoId === pedido.conteoId &&
    guardado.articuloId === pedido.articuloId &&
    cantidad.ok &&
    cantidad.valor.unidades === pedido.unidades &&
    // La hora entra en la comparación SOLO si la pantalla la mandó: sin ella el servidor usa su reloj, y un reintento tendría otro `ahora`.
    (pedido.contadoEn === undefined || guardado.contadoEn?.getTime() === pedido.contadoEn.getTime())
  );
};

/**
 * Abrir un conteo físico de un depósito (E5 §3.2, D125). Guard `conteos.abrir` (administrador y gerente); el depósito en el alcance de quien pide
 * y activo. Un solo conteo ABIERTO por depósito (`CONTEO_EN_CURSO`: lo impone el único parcial de la base, así que vale aunque dos lo abran a la
 * vez). Repetición (`CLAVE_DE_IDEMPOTENCIA`): el `id` lo manda la pantalla; el mismo `id` con el mismo depósito devuelve `yaExistia` sin escribir ni
 * auditar, con otro depósito, `ID_REUTILIZADO`. El conteo NO congela el depósito: lo que se mueva mientras se cuenta sigue moviéndose, y `aplicarConteo` lo descuenta solo (compara contra lo que había a la hora en que se contó).
 */
export function armarAbrirConteo(dependencias: DependenciasDeStock) {
  return async function abrirConteo(
    contexto: ContextoOperativo,
    entrada: EntradaDeAbrirConteo,
  ): Promise<R<SalidaDeAbrirConteo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAbrirConteo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["conteos.abrir"]);
        if (!permiso.ok) return permiso;
        const id = leerId(entrada.id);
        if (id === null) return err("IDENTIFICADOR_INVALIDO");
        const deposito = await cargarDeposito(tx, contexto, entrada.depositoId);
        if (!deposito.ok) return deposito;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");

        const existente = await tx.conteosDeStock.obtener(empresaId, id);
        if (existente !== null) {
          return existente.depositoId === deposito.valor.id
            ? ok({ conteoId: id, yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        if (!deposito.valor.activo) return err("DEPOSITO_INACTIVO");
        if ((await tx.conteosDeStock.abiertoDe(empresaId, deposito.valor.id)) !== null) {
          return err("CONTEO_EN_CURSO");
        }
        const insertado = await tx.conteosDeStock.insertar(empresaId, {
          id,
          depositoId: deposito.valor.id,
          abiertoPor: persona,
          abiertoEn: contexto.ahora,
        });
        if (!insertado) {
          // Dos pedidos iguales a la vez: el otro ya lo abrió.
          const guardado = await tx.conteosDeStock.obtener(empresaId, id);
          return guardado !== null && guardado.depositoId === deposito.valor.id
            ? ok({ conteoId: id, yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "CONTEO_ABIERTO",
          entidad: "conteo_fisico",
          entidadId: id,
          despues: { depositoId: deposito.valor.id, estado: "ABIERTO" },
        });
        return ok({ conteoId: id, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * La ventana de la hora del conteo (CF-D2): la jornada de la hora es la vigente o la anterior de la sucursal del depósito (la misma fórmula que fija
 * la base para caja, ventas y stock) y no es anterior al último conteo aplicado. Una zona o un corte inválidos son una configuración rota (la base
 * los valida al guardarlos): se frena, no se acepta una hora en una jornada inventada.
 */
async function comprobarHoraDelConteo(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  depositoId: string,
  hora: Date,
): Promise<R<null>> {
  const deposito = await tx.depositos.obtener(contexto.empresaId, depositoId);
  if (deposito === null) throw new Error("el depósito de un conteo no existe");
  const datos = await datosDeJornada(tx, deposito.sucursalId);
  if (!datos.ok) return err("SUCURSAL_NO_ENCONTRADA");
  const hoy = fechaDeNegocio(contexto.ahora, datos.valor.zonaHoraria, datos.valor.horaDeCorte);
  const deLaHora = fechaDeNegocio(hora, datos.valor.zonaHoraria, datos.valor.horaDeCorte);
  if (!hoy.ok || !deLaHora.ok) {
    throw new Error(`la sucursal ${deposito.sucursalId} no se puede fechar`);
  }
  return validarHoraDeConteo({
    hora,
    ahora: contexto.ahora,
    jornadaDeLaHora: deLaHora.valor,
    jornadaDeHoy: hoy.valor,
    ultimoAplicadoEn: await tx.conteosDeStock.ultimoAplicadoEn(contexto.empresaId, depositoId),
  });
}

/**
 * Registrar lo contado de un artículo (E5 §3.2). Guard `conteos.registrar` (también el operador: «cuenta»); el conteo en el alcance de quien pide
 * y ABIERTO (`CONTEO_CERRADO`); el artículo, controlado y activo (`ARTICULO_NO_CONTROLADO`); la cantidad contada, cero o más, llevada EXACTA a la
 * unidad de stock. Guarda la HORA a la que se contó (`contadoEn`, opcional: sin ella vale la de la carga) junto con la hora de carga: la compara
 * `aplicarConteo` contra lo que el sistema creía a esa hora, y esta respuesta NO muestra lo que el sistema creía (el conteo es a ciegas). La hora no
 * puede ser futura (`FECHA_FUTURA_NO_ADMITIDA`), tiene que caer en la jornada vigente o en la anterior de la sucursal (`HORA_FUERA_DE_VENTANA`) y no
 * ser anterior al último conteo aplicado del depósito (`HORA_ANTERIOR_AL_ULTIMO_CONTEO`). Recontar es un registro nuevo (otro `id`): vale el último
 * por artículo. Repetición (`CLAVE_DE_IDEMPOTENCIA`): el mismo `id` con lo mismo devuelve `yaExistia` sin escribir (y sin volver a mirar la ventana: un
 * reintento tardío no pierde lo ya cargado); con otro contenido u otra hora declarada, `ID_REUTILIZADO`. Es su propio registro (solo inserción, con
 * autor y hora): no suma nada a la auditoría de la empresa.
 */
export function armarRegistrarConteo(dependencias: DependenciasDeStock) {
  return async function registrarConteo(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarConteo,
  ): Promise<R<SalidaDeRegistrarConteo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeRegistrarConteo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["conteos.registrar"]);
        if (!permiso.ok) return permiso;
        const id = leerId(entrada.id);
        if (id === null) return err("IDENTIFICADOR_INVALIDO");
        const conteo = await cargarConteo(tx, contexto, entrada.conteoId, false);
        if (!conteo.ok) return conteo;
        const contadoEn = entrada.contadoEn;
        if (
          contadoEn !== undefined &&
          !(contadoEn instanceof Date && contadoEn.getTime() <= contexto.ahora.getTime())
        ) {
          return err("FECHA_FUTURA_NO_ADMITIDA");
        }
        const contada = leerCantidad(entrada.cantidadContada, true);
        if (!contada.ok) return contada;
        if (typeof entrada.unidadId !== "string" || !esUnidadConocida(entrada.unidadId)) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const productoId = leerId(entrada.productoId);
        const articulo =
          productoId === null ? null : await tx.articulosDeStock.porProducto(empresaId, productoId);
        if (articulo === null) return err("ARTICULO_NO_CONTROLADO");
        const enStock = aUnidadDeStock(contada.valor, entrada.unidadId, articulo);
        if (!enStock.ok) return enStock;
        const pedido = {
          conteoId: conteo.valor.id,
          articuloId: articulo.id,
          unidades: enStock.valor.unidades,
          contadoEn,
        };

        const existente = await tx.conteosDeStock.obtenerRegistro(empresaId, id);
        if (existente !== null) {
          return esElMismoRegistro(existente, pedido)
            ? ok({ yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        if (conteo.valor.estado !== "ABIERTO") return err("CONTEO_CERRADO");
        if (!articulo.activo) return err("ARTICULO_NO_CONTROLADO");
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        if (contadoEn !== undefined) {
          const hora = await comprobarHoraDelConteo(
            tx,
            contexto,
            conteo.valor.depositoId,
            contadoEn,
          );
          if (!hora.ok) return hora;
        }
        const insertado = await tx.conteosDeStock.insertarRegistro(empresaId, {
          id,
          conteoId: conteo.valor.id,
          articuloId: articulo.id,
          cantidadContada: cantidadATexto(enStock.valor),
          registradoPor: persona,
          registradoEn: contexto.ahora,
          contadoEn: contadoEn ?? null,
        });
        if (!insertado) {
          // Dos pedidos iguales a la vez: el otro ya lo registró.
          const guardado = await tx.conteosDeStock.obtenerRegistro(empresaId, id);
          return guardado !== null && esElMismoRegistro(guardado, pedido)
            ? ok({ yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        return ok({ yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Cancelar un conteo abierto (E5 §3.2). Guard `conteos.cancelar` (administrador y gerente); el motivo es obligatorio (`MOTIVO_REQUERIDO`, lista
 * de permitidos de una línea) y no cambia nada del libro. Un conteo aplicado no se cancela (`CONTEO_CERRADO`). Repetición (`YA_ESTABA`): ya
 * cancelado devuelve `yaEstaba` sin escribir ni auditar.
 */
export function armarCancelarConteo(dependencias: DependenciasDeStock) {
  return async function cancelarConteo(
    contexto: ContextoOperativo,
    entrada: EntradaDeCancelarConteo,
  ): Promise<R<SalidaDeCancelarConteo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCancelarConteo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["conteos.cancelar"]);
        if (!permiso.ok) return permiso;
        const motivo = leerDetalle(entrada.motivo, true);
        if (!motivo.ok || motivo.valor === null) return err("MOTIVO_REQUERIDO");
        const conteo = await cargarConteo(tx, contexto, entrada.conteoId, true);
        if (!conteo.ok) return conteo;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        if (conteo.valor.estado === "CANCELADO") return ok({ yaEstaba: true });
        if (conteo.valor.estado === "APLICADO") return err("CONTEO_CERRADO");
        const resuelto = await tx.conteosDeStock.resolver(empresaId, conteo.valor.id, {
          estado: "CANCELADO",
          resueltoPor: persona,
          resueltoEn: contexto.ahora,
          motivo: motivo.valor,
        });
        if (resuelto === null) throw new Error("el conteo bloqueado dejó de estar abierto");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "CONTEO_CANCELADO",
          entidad: "conteo_fisico",
          entidadId: conteo.valor.id,
          antes: { estado: "ABIERTO" },
          despues: { estado: "CANCELADO", motivo: motivo.valor },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
