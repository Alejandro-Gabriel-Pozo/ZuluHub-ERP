import type { ClaveAccionDePlataforma } from "../../capacidades/permisos/plataforma";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirCambioDeDominio,
  traducirErroresDeDominio,
  validarPedidoDeCambioDeDominio,
  type ErrorDeCambioDeDominio,
  type EstadoDeDominio,
  type PedidoDeCambioDeDominio,
} from "../../modulos/marcas/publico";
import { dominioId, type DominioId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { AccionDePlataforma } from "../../puertos/auditoria-de-plataforma";
import type { Dato } from "../../puertos/sin-secretos";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  datosDeAuditoriaDeDominio,
  ejecutarCasoDeDominios,
  type DependenciasDeDominios,
  type ErrorComunDeDominios,
} from "./dominios-comun";

/**
 * Los cuatro casos que cambian el estado de un dominio ya registrado (M4a): verificar, activar, desactivar y
 * retirar. Comparten el trabajo (leer, decidir con el dominio puro, escribir con control de versión,
 * constancia) y difieren en la acción, la operación de idempotencia, el pedido y la constancia.
 */

export type SalidaDeCambioDeDominio = Readonly<{
  dominioId: DominioId;
  /** El estado en que quedó el dominio (o en que ya estaba). */
  estado: EstadoDeDominio;
  /**
   * `true` cuando esta llamada no cambió nada: el dominio ya estaba así (activar lo activo, retirar lo
   * retirado) o es la repetición de una llamada anterior con la misma clave.
   */
  yaEstaba: boolean;
}>;

/** Los motivos de la base que estos casos admiten: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITEN = [
  "DOMINIO_RETIRADO",
  "DOMINIO_CANONICO",
  "TRANSICION_DE_DOMINIO_INVALIDA",
  "FECHA_DE_VERIFICACION_INMUTABLE",
] as const;

export type ErrorAlCambiarDominio =
  | ErrorComunDeDominios
  | ErrorDeCambioDeDominio
  | "ID_INVALIDO"
  | "DOMINIO_NO_ENCONTRADO"
  | (typeof MOTIVOS_QUE_ADMITEN)[number];

type Pedido = Readonly<{
  contexto: ContextoDePlataforma;
  claveDeIdempotencia: string;
  dominioId: string;
  pedido: PedidoDeCambioDeDominio;
}>;

type Variante = Readonly<{
  accion: ClaveAccionDePlataforma;
  operacion: string;
  constancia: AccionDePlataforma;
}>;

/** Lo que el pedido agrega a la entrada que alimenta la huella de la clave (ya normalizado). */
function aporteALaHuella(pedido: PedidoDeCambioDeDominio): Record<string, Dato> {
  switch (pedido.tipo) {
    case "VERIFICAR":
      return { verificadoEn: pedido.verificadoEn.toISOString() };
    case "RETIRAR":
      return { motivo: pedido.motivo };
    case "ACTIVAR":
    case "DESACTIVAR":
      return {};
  }
}

async function cambiarEstado(
  dependencias: DependenciasDeDominios,
  variante: Variante,
  { contexto, claveDeIdempotencia, dominioId: idTexto, pedido }: Pedido,
): Promise<Resultado<SalidaDeCambioDeDominio, ErrorAlCambiarDominio>> {
  const resultado = await ejecutarCasoDeDominios<
    SalidaDeCambioDeDominio,
    Readonly<{ id: DominioId; pedido: PedidoDeCambioDeDominio }>,
    ErrorDeCambioDeDominio | "ID_INVALIDO" | "DOMINIO_NO_ENCONTRADO"
  >(dependencias, {
    contexto,
    accion: variante.accion,
    operacion: variante.operacion,
    claveDeIdempotencia,
    validar: () => {
      const id = uuidDesdeTexto(idTexto);
      if (!id.ok) return id;
      const limpio = validarPedidoDeCambioDeDominio(pedido, contexto.ahora);
      if (!limpio.ok) return limpio;
      return ok({
        entrada: { dominioId: id.valor, ...aporteALaHuella(limpio.valor) },
        valor: { id: dominioId(id.valor), pedido: limpio.valor },
      });
    },
    trabajar: async (tx, { id, pedido: limpio }) => {
      const dominio = await tx.dominios.obtener(id);
      if (dominio === null) return err("DOMINIO_NO_ENCONTRADO");
      const decision = decidirCambioDeDominio(dominio, limpio, contexto.ahora);
      if (!decision.ok) return decision;
      if (decision.valor.tipo === "YA_ESTABA") {
        return ok({
          salida: { dominioId: id, estado: dominio.estado, yaEstaba: true },
          constancia: null,
        });
      }
      const nuevo = await tx.dominios.cambiarEstado(id, dominio.version, decision.valor.cambio);
      // Con SERIALIZABLE otra transacción que cambiara el dominio antes ya habría abortado ésta (40001, que el
      // adaptador reintenta): sin fila acá es un nivel de aislamiento menor y se pide repetir.
      if (nuevo === null) return err({ tipo: "ConcurrenciaAgotada" });
      return ok({
        salida: { dominioId: id, estado: nuevo.estado, yaEstaba: false },
        constancia: {
          accion: variante.constancia,
          entidad: "dominio",
          entidadId: id,
          antes: datosDeAuditoriaDeDominio(dominio),
          despues: datosDeAuditoriaDeDominio(nuevo),
        },
      });
    },
    comoRepeticion: (guardado) => ({ ...guardado, yaEstaba: true }),
  });
  return traducirErroresDeDominio(resultado, MOTIVOS_QUE_ADMITEN);
}

export const OPERACION_VERIFICAR_DOMINIO = "dominios.verificar";
export const OPERACION_ACTIVAR_DOMINIO = "dominios.activar";
export const OPERACION_DESACTIVAR_DOMINIO = "dominios.desactivar";
export const OPERACION_RETIRAR_DOMINIO = "dominios.retirar";

export const DECLARACION_DE_VERIFICAR_DOMINIO = {
  accion: "dominios.verificar",
} as const satisfies DeclaracionDeAccionDePlataforma;
export const DECLARACION_DE_ACTIVAR_DOMINIO = {
  accion: "dominios.activar",
} as const satisfies DeclaracionDeAccionDePlataforma;
export const DECLARACION_DE_DESACTIVAR_DOMINIO = {
  accion: "dominios.desactivar",
} as const satisfies DeclaracionDeAccionDePlataforma;
export const DECLARACION_DE_RETIRAR_DOMINIO = {
  accion: "dominios.retirar",
} as const satisfies DeclaracionDeAccionDePlataforma;

type EntradaBase = Readonly<{ claveDeIdempotencia: string; dominioId: string }>;

export type EntradaDeVerificarDominio = EntradaBase &
  Readonly<{
    /**
     * Cuándo se comprobó la titularidad. Lo manda quien llama: cómo se verifica el DNS es de otro tramo.
     * No puede ser futura. Repetir la llamada con la misma clave exige la misma fecha.
     */
    verificadoEn: Date;
  }>;
export type EntradaDeActivarDominio = EntradaBase;
export type EntradaDeDesactivarDominio = EntradaBase;
export type EntradaDeRetirarDominio = EntradaBase & Readonly<{ motivo: string }>;

/**
 * Verificar un dominio (PENDIENTE_VERIFICACION → VERIFICADO), con la fecha de la comprobación. Verificar lo
 * que ya está verificado o activo es éxito sin escribir. Constancia `DOMINIO_VERIFICADO`.
 */
export function armarVerificarDominio(dependencias: DependenciasDeDominios) {
  return (contexto: ContextoDePlataforma, entrada: EntradaDeVerificarDominio) =>
    cambiarEstado(
      dependencias,
      {
        accion: DECLARACION_DE_VERIFICAR_DOMINIO.accion,
        operacion: OPERACION_VERIFICAR_DOMINIO,
        constancia: "DOMINIO_VERIFICADO",
      },
      {
        contexto,
        claveDeIdempotencia: entrada.claveDeIdempotencia,
        dominioId: entrada.dominioId,
        pedido: { tipo: "VERIFICAR", verificadoEn: entrada.verificadoEn },
      },
    );
}

/**
 * Activar un dominio (VERIFICADO → ACTIVO): desde ese momento sirve su superficie. Solo se activa con la
 * verificación hecha (`DOMINIO_SIN_VERIFICAR`); activar lo activo es éxito sin escribir. Constancia
 * `DOMINIO_ACTIVADO`.
 */
export function armarActivarDominio(dependencias: DependenciasDeDominios) {
  return (contexto: ContextoDePlataforma, entrada: EntradaDeActivarDominio) =>
    cambiarEstado(
      dependencias,
      {
        accion: DECLARACION_DE_ACTIVAR_DOMINIO.accion,
        operacion: OPERACION_ACTIVAR_DOMINIO,
        constancia: "DOMINIO_ACTIVADO",
      },
      {
        contexto,
        claveDeIdempotencia: entrada.claveDeIdempotencia,
        dominioId: entrada.dominioId,
        pedido: { tipo: "ACTIVAR" },
      },
    );
}

/**
 * Desactivar un dominio (ACTIVO o VERIFICADO → PENDIENTE_VERIFICACION): vuelve a la página neutra al
 * instante y pierde la fecha de verificación (hay que verificarlo de nuevo). Sobre uno pendiente es éxito
 * sin escribir. Constancia `DOMINIO_DESACTIVADO`.
 */
export function armarDesactivarDominio(dependencias: DependenciasDeDominios) {
  return (contexto: ContextoDePlataforma, entrada: EntradaDeDesactivarDominio) =>
    cambiarEstado(
      dependencias,
      {
        accion: DECLARACION_DE_DESACTIVAR_DOMINIO.accion,
        operacion: OPERACION_DESACTIVAR_DOMINIO,
        constancia: "DOMINIO_DESACTIVADO",
      },
      {
        contexto,
        claveDeIdempotencia: entrada.claveDeIdempotencia,
        dominioId: entrada.dominioId,
        pedido: { tipo: "DESACTIVAR" },
      },
    );
}

/**
 * Retirar un dominio (cualquier estado → RETIRADO, terminal), con motivo obligatorio. Vuelve a la página
 * neutra al instante; el host queda libre para registrarse de nuevo. El canónico no se retira
 * (`DOMINIO_CANONICO`); retirar lo retirado es éxito sin escribir. Constancia `DOMINIO_RETIRADO`.
 */
export function armarRetirarDominio(dependencias: DependenciasDeDominios) {
  return (contexto: ContextoDePlataforma, entrada: EntradaDeRetirarDominio) =>
    cambiarEstado(
      dependencias,
      {
        accion: DECLARACION_DE_RETIRAR_DOMINIO.accion,
        operacion: OPERACION_RETIRAR_DOMINIO,
        constancia: "DOMINIO_RETIRADO",
      },
      {
        contexto,
        claveDeIdempotencia: entrada.claveDeIdempotencia,
        dominioId: entrada.dominioId,
        pedido: { tipo: "RETIRAR", motivo: entrada.motivo },
      },
    );
}
