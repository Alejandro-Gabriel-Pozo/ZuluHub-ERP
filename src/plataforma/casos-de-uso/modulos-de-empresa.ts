import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirActivacion,
  decidirDesactivacion,
  traducirErroresDePlanes,
  type ErrorDeActivacion,
  type ErrorDeDesactivacion,
} from "../../modulos/planes/publico";
import { empresaId as comoEmpresaId, type EmpresaId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  aplanarError,
  auditarEnLasEmpresas,
  ejecutarCasoDeMarcasYPlanes,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
  type TxDeMarcasYPlanes,
} from "./marcas-y-planes-comun";

/** Las operaciones con las que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_ACTIVAR_MODULO_DE_EMPRESA = "modulos_de_empresa.activar";
export const OPERACION_DESACTIVAR_MODULO_DE_EMPRESA = "modulos_de_empresa.desactivar";

/** Los casos de uso y la acción que exige cada uno al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_ACTIVAR_MODULO_DE_EMPRESA = {
  accion: "modulos_de_empresa.activar",
} as const satisfies DeclaracionDeAccionDePlataforma;
export const DECLARACION_DE_DESACTIVAR_MODULO_DE_EMPRESA = {
  accion: "modulos_de_empresa.desactivar",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeCambiarModuloDeEmpresa = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN escribir ni auditar de nuevo. */
  claveDeIdempotencia: string;
  empresaId: string;
  /** La clave del módulo en el catálogo de módulos. */
  modulo: string;
}>;

export type SalidaDeActivarModuloDeEmpresa = Readonly<{
  /** `true` cuando esta llamada no escribió nada: el módulo ya estaba activado, o repite una anterior con la misma clave. */
  yaEstabaActivo: boolean;
}>;

export type SalidaDeDesactivarModuloDeEmpresa = Readonly<{
  /** `true` cuando esta llamada no escribió nada: el módulo ya estaba inactivo, o repite una anterior con la misma clave. */
  yaEstabaInactivo: boolean;
}>;

/** Los motivos de la base que estos casos admiten: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITEN = ["EMPRESA_NO_ENCONTRADA"] as const;

export type ErrorAlActivarModuloDeEmpresa = ErrorPlano<
  | ErrorComunDeMarcasYPlanes
  | ErrorDeActivacion
  | "ID_INVALIDO"
  | (typeof MOTIVOS_QUE_ADMITEN)[number]
>;
export type ErrorAlDesactivarModuloDeEmpresa = ErrorPlano<
  | ErrorComunDeMarcasYPlanes
  | ErrorDeDesactivacion
  | "ID_INVALIDO"
  | (typeof MOTIVOS_QUE_ADMITEN)[number]
>;

type Pedido = Readonly<{ empresaId: EmpresaId; modulo: string }>;

const validarPedido = (entrada: EntradaDeCambiarModuloDeEmpresa) => {
  const empresa = uuidDesdeTexto(entrada.empresaId);
  if (!empresa.ok) return empresa;
  return ok({
    entrada: { empresaId: empresa.valor, modulo: entrada.modulo },
    valor: { empresaId: comoEmpresaId(empresa.valor), modulo: entrada.modulo },
  });
};

/** Lo que el módulo tiene HOY en la empresa: la fila (activa o no) y la lista de los activados. */
async function modulosDeLaEmpresa(tx: TxDeMarcasYPlanes, empresa: EmpresaId, modulo: string) {
  const filas = await tx.planes.modulosDeLasEmpresas([empresa]);
  return {
    existente: filas.find((f) => f.modulo === modulo) ?? null,
    activados: filas.filter((f) => f.activo).map((f) => f.modulo),
  };
}

/**
 * Activar un módulo en una empresa (M5). Contexto de PLATAFORMA, solo ADMIN: la empresa no activa módulos,
 * los activa la plataforma. El módulo tiene que estar en el catálogo, disponible y dentro del techo del plan
 * que rige hoy (`MODULO_FUERA_DEL_PLAN`), y sus `requiere` tienen que estar activos (`REQUIERE_INACTIVO`).
 * El plan y los módulos activados se leen en la misma transacción: una activación y un cambio de plan o la
 * baja de un módulo requerido, a la vez, quedan en algún orden serial. Activar lo activado es éxito sin
 * escribir ni auditar. Deja la constancia `MODULO_ACTIVADO` y una en la auditoría de la empresa (actor nulo).
 */
export function armarActivarModuloDeEmpresa(dependencias: DependenciasDeMarcasYPlanes) {
  return async function activarModuloDeEmpresa(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCambiarModuloDeEmpresa,
  ): Promise<Resultado<SalidaDeActivarModuloDeEmpresa, ErrorAlActivarModuloDeEmpresa>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeActivarModuloDeEmpresa,
      Pedido,
      ErrorDeActivacion | "ID_INVALIDO" | "EMPRESA_NO_ENCONTRADA"
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_ACTIVAR_MODULO_DE_EMPRESA.accion,
      operacion: OPERACION_ACTIVAR_MODULO_DE_EMPRESA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => validarPedido(entrada),
      trabajar: async (tx, pedido) => {
        if ((await tx.planes.tenantDeLaEmpresa(pedido.empresaId)) === null) {
          return err("EMPRESA_NO_ENCONTRADA");
        }
        const { existente, activados } = await modulosDeLaEmpresa(
          tx,
          pedido.empresaId,
          pedido.modulo,
        );
        // El techo del plan que rige hoy para ESTA empresa (con sus ajustes): la misma cuenta que ve la empresa.
        const derechos = await tx.derechos.deLaEmpresaParaLaPlataforma(contexto, pedido.empresaId);
        if (derechos === null)
          throw new RangeError("no se pudieron leer los derechos de la empresa");
        const decision = decidirActivacion({
          catalogo: dependencias.catalogoDeModulos,
          modulo: pedido.modulo,
          activados,
          habilitados: [...derechos.modulosHabilitados],
        });
        if (!decision.ok) return decision;
        if (decision.valor.yaEstabaActivo) {
          return ok({ salida: { yaEstabaActivo: true }, constancias: [] });
        }
        const activado = await tx.planes.activarModulo(pedido.empresaId, pedido.modulo, existente);
        // Con SERIALIZABLE otra transacción que cambiara el módulo antes ya habría abortado ésta (40001, que el
        // adaptador reintenta): sin fila acá es un nivel de aislamiento menor y se pide repetir.
        if (activado === null) return err({ tipo: "ConcurrenciaAgotada" });
        const constancia = {
          accion: "MODULO_ACTIVADO",
          entidad: "modulo_de_empresa",
          entidadId: `${pedido.empresaId}:${pedido.modulo}`,
          antes: existente === null ? null : { activo: existente.activo },
          despues: {
            empresaId: pedido.empresaId,
            tenantId: derechos.tenantId,
            modulo: pedido.modulo,
            activo: true,
          },
        } as const;
        await auditarEnLasEmpresas(tx, [pedido.empresaId], constancia);
        return ok({ salida: { yaEstabaActivo: false }, constancias: [constancia] });
      },
      comoRepeticion: () => ({ yaEstabaActivo: true }),
    });
    return aplanarError(traducirErroresDePlanes(resultado, MOTIVOS_QUE_ADMITEN));
  };
}

/**
 * Desactivar un módulo en una empresa (M5). Contexto de PLATAFORMA, solo ADMIN. Nada se borra: la fila queda
 * inactiva y los datos del módulo siguen guardados (vuelven al reactivarlo). Ningún módulo activado puede
 * requerirlo (`ES_REQUERIDO_POR`; cuenta también al que quedó en solo lectura). Desactivar lo inactivo es
 * éxito sin escribir ni auditar. Deja la constancia `MODULO_DESACTIVADO` y una en la auditoría de la
 * empresa (actor nulo). Desactivar un módulo mientras otro que lo requiere se activa, a la vez: uno de los
 * dos se rechaza, nunca quedan los dos.
 */
export function armarDesactivarModuloDeEmpresa(dependencias: DependenciasDeMarcasYPlanes) {
  return async function desactivarModuloDeEmpresa(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCambiarModuloDeEmpresa,
  ): Promise<Resultado<SalidaDeDesactivarModuloDeEmpresa, ErrorAlDesactivarModuloDeEmpresa>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeDesactivarModuloDeEmpresa,
      Pedido,
      ErrorDeDesactivacion | "ID_INVALIDO" | "EMPRESA_NO_ENCONTRADA"
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_DESACTIVAR_MODULO_DE_EMPRESA.accion,
      operacion: OPERACION_DESACTIVAR_MODULO_DE_EMPRESA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => validarPedido(entrada),
      trabajar: async (tx, pedido) => {
        const tenant = await tx.planes.tenantDeLaEmpresa(pedido.empresaId);
        if (tenant === null) return err("EMPRESA_NO_ENCONTRADA");
        const { existente, activados } = await modulosDeLaEmpresa(
          tx,
          pedido.empresaId,
          pedido.modulo,
        );
        const decision = decidirDesactivacion({
          catalogo: dependencias.catalogoDeModulos,
          modulo: pedido.modulo,
          activados,
        });
        if (!decision.ok) return decision;
        if (decision.valor.yaEstabaInactivo || existente === null) {
          return ok({ salida: { yaEstabaInactivo: true }, constancias: [] });
        }
        const desactivado = await tx.planes.desactivarModulo(existente);
        // Con SERIALIZABLE otra transacción que cambiara el módulo antes ya habría abortado ésta (40001, que el
        // adaptador reintenta): sin fila acá es un nivel de aislamiento menor y se pide repetir.
        if (desactivado === null) return err({ tipo: "ConcurrenciaAgotada" });
        const constancia = {
          accion: "MODULO_DESACTIVADO",
          entidad: "modulo_de_empresa",
          entidadId: `${pedido.empresaId}:${pedido.modulo}`,
          antes: { activo: true },
          despues: {
            empresaId: pedido.empresaId,
            tenantId: tenant,
            modulo: pedido.modulo,
            activo: false,
          },
        } as const;
        await auditarEnLasEmpresas(tx, [pedido.empresaId], constancia);
        return ok({ salida: { yaEstabaInactivo: false }, constancias: [constancia] });
      },
      comoRepeticion: () => ({ yaEstabaInactivo: true }),
    });
    return aplanarError(traducirErroresDePlanes(resultado, MOTIVOS_QUE_ADMITEN));
  };
}
