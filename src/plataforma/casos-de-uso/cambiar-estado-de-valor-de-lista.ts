import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirActivo,
  traducirErroresDeListas,
  type ErrorDeCambioDeValor,
} from "../../modulos/listas/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { validarVersionVista } from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import type { ResultadoDelTrabajoDePlataforma } from "./caso-de-plataforma";
import {
  datosDelValorDeLista,
  ejecutarCasoDeListas,
  ENTIDAD_VALOR_DE_LISTA,
  type DependenciasDeListas,
  type ErrorComunDeListas,
  type TxDeListas,
} from "./listas-comun";

/** Las operaciones con las que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_DESACTIVAR_VALOR_DE_LISTA = "listas.desactivar_valor";
export const OPERACION_REACTIVAR_VALOR_DE_LISTA = "listas.reactivar_valor";

/** Los casos de uso y la acción que exige cada uno al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_DESACTIVAR_VALOR_DE_LISTA = {
  accion: "listas.editar",
} as const satisfies DeclaracionDeAccionDePlataforma;
export const DECLARACION_DE_REACTIVAR_VALOR_DE_LISTA = {
  accion: "listas.editar",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeCambiarEstadoDeValorDeLista = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN escribir ni auditar de nuevo. */
  claveDeIdempotencia: string;
  valorId: string;
  /** La `version` del valor que vio quien lo cambia. Solo se exige si hay algo que cambiar (ver `decidirActivo`). */
  versionEsperada: number;
}>;

export type SalidaDeDesactivarValorDeLista = Readonly<{
  /** La versión del valor después del pedido: la `versionEsperada` del próximo cambio. */
  version: number;
  /** `true` cuando esta llamada no escribió nada: el valor ya estaba inactivo, o repite una anterior con la misma clave. */
  yaEstabaInactivo: boolean;
}>;

export type SalidaDeReactivarValorDeLista = Readonly<{
  version: number;
  /** `true` cuando esta llamada no escribió nada: el valor ya estaba activo, o repite una anterior con la misma clave. */
  yaEstabaActivo: boolean;
}>;

type ErrorPropio =
  ErrorDeCambioDeValor | "ID_INVALIDO" | "VERSION_ESPERADA_INVALIDA" | "VALOR_NO_ENCONTRADO";

export type ErrorAlCambiarEstadoDeValorDeLista = ErrorComunDeListas | ErrorPropio;

type Pedido = Readonly<{ valorId: string; versionEsperada: number }>;

const validarPedido = (entrada: EntradaDeCambiarEstadoDeValorDeLista) => {
  const valor = uuidDesdeTexto(entrada.valorId);
  if (!valor.ok) return valor;
  const version = validarVersionVista(entrada.versionEsperada);
  if (!version.ok) return version;
  const pedido = { valorId: valor.valor, versionEsperada: version.valor };
  return ok({ entrada: pedido, valor: pedido });
};

type EstadoCambiado = Readonly<{ version: number; yaEstabaEnEseEstado: boolean }>;

/** El trabajo común de desactivar y reactivar: lo que cambia es el `activo` y la constancia. */
async function cambiarEstado(
  tx: TxDeListas,
  pedido: Pedido,
  activo: boolean,
): Promise<
  Resultado<ResultadoDelTrabajoDePlataforma<EstadoCambiado>, ErrorPropio | ErrorDePersistencia>
> {
  const actual = await tx.listas.porId(pedido.valorId);
  if (actual === null) return err("VALOR_NO_ENCONTRADO");
  const decision = decidirActivo(actual, activo, pedido.versionEsperada);
  if (!decision.ok) return decision;
  if (!decision.valor.cambia) {
    return ok({ salida: { version: actual.version, yaEstabaEnEseEstado: true }, constancias: [] });
  }
  const nuevo = await tx.listas.cambiar(actual.id, actual.version, { activo });
  // Con SERIALIZABLE otra transacción que cambiara el valor antes ya habría abortado ésta (40001, que el adaptador reintenta):
  // sin fila acá es un nivel de aislamiento menor y se pide repetir.
  if (nuevo === null) return err({ tipo: "ConcurrenciaAgotada" });
  return ok({
    salida: { version: nuevo.version, yaEstabaEnEseEstado: false },
    constancias: [
      {
        accion: activo ? "VALOR_DE_LISTA_REACTIVADO" : "VALOR_DE_LISTA_DESACTIVADO",
        entidad: ENTIDAD_VALOR_DE_LISTA,
        entidadId: nuevo.id,
        antes: datosDelValorDeLista(actual),
        despues: datosDelValorDeLista(nuevo),
      },
    ],
  });
}

/**
 * Desactivar un valor de una lista del sistema (e3 §3.7). Contexto de PLATAFORMA, solo ADMIN (`listas.editar`). Nada se borra: el valor
 * deja de ofrecerse en cobros NUEVOS y lo ya cobrado lo conserva. Un valor fijo («Otra») no se desactiva (`VALOR_FIJO`). Desactivar lo
 * inactivo es éxito sin escribir ni auditar (con cualquier versión). Deja la constancia `VALOR_DE_LISTA_DESACTIVADO`.
 */
export function armarDesactivarValorDeLista(dependencias: DependenciasDeListas) {
  return async function desactivarValorDeLista(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCambiarEstadoDeValorDeLista,
  ): Promise<Resultado<SalidaDeDesactivarValorDeLista, ErrorAlCambiarEstadoDeValorDeLista>> {
    const resultado = await ejecutarCasoDeListas<
      SalidaDeDesactivarValorDeLista,
      Pedido,
      ErrorPropio
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_DESACTIVAR_VALOR_DE_LISTA.accion,
      operacion: OPERACION_DESACTIVAR_VALOR_DE_LISTA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => validarPedido(entrada),
      trabajar: async (tx, pedido) => {
        const hecho = await cambiarEstado(tx, pedido, false);
        if (!hecho.ok) return hecho;
        const { version, yaEstabaEnEseEstado } = hecho.valor.salida;
        return ok({
          salida: { version, yaEstabaInactivo: yaEstabaEnEseEstado },
          constancias: hecho.valor.constancias,
        });
      },
      comoRepeticion: (guardado) => ({ version: guardado.version, yaEstabaInactivo: true }),
    });
    return traducirErroresDeListas(resultado, ["VALOR_FIJO"] as const);
  };
}

/**
 * Reactivar un valor de una lista del sistema (e3 §3.7). Contexto de PLATAFORMA, solo ADMIN (`listas.editar`). Vuelve a ofrecerse en
 * cobros nuevos. Reactivar lo activo (también un valor fijo, que siempre lo está) es éxito sin escribir ni auditar (con cualquier
 * versión). Deja la constancia `VALOR_DE_LISTA_REACTIVADO`.
 */
export function armarReactivarValorDeLista(dependencias: DependenciasDeListas) {
  return async function reactivarValorDeLista(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCambiarEstadoDeValorDeLista,
  ): Promise<Resultado<SalidaDeReactivarValorDeLista, ErrorAlCambiarEstadoDeValorDeLista>> {
    const resultado = await ejecutarCasoDeListas<
      SalidaDeReactivarValorDeLista,
      Pedido,
      ErrorPropio
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_REACTIVAR_VALOR_DE_LISTA.accion,
      operacion: OPERACION_REACTIVAR_VALOR_DE_LISTA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => validarPedido(entrada),
      trabajar: async (tx, pedido) => {
        const hecho = await cambiarEstado(tx, pedido, true);
        if (!hecho.ok) return hecho;
        const { version, yaEstabaEnEseEstado } = hecho.valor.salida;
        return ok({
          salida: { version, yaEstabaActivo: yaEstabaEnEseEstado },
          constancias: hecho.valor.constancias,
        });
      },
      comoRepeticion: (guardado) => ({ version: guardado.version, yaEstabaActivo: true }),
    });
    return traducirErroresDeListas(resultado, ["VALOR_FIJO"] as const);
  };
}
