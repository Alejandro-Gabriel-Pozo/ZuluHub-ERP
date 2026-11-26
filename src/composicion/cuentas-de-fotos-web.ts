import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeCatalogo, ConsultasDeCatalogo } from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import {
  leerElPedidoDeDeclararLaCuentaDeFotos,
  leerElPedidoDeRetirarLaCuentaDeFotos,
} from "./entradas-de-cuentas-de-fotos";

/**
 * La pantalla «Conectá tu cuenta de fotos» (cuentas de imagen declaradas, 0102): ver las cuentas del proveedor de imágenes que la empresa declaró, declarar una y retirarla. Vive acá, y no en
 * `apps/web`, para probarse con la base real sin levantar Next (igual que `carta-en-linea-web.ts`). El servidor que decide ya existía: `declararCuentaDeImagen`, `retirarCuentaDeImagen` y
 * `listarCuentasDeImagen`; acá no hay ninguna regla de negocio nueva.
 *
 * Reglas que cumple (cada una con su prueba en `cuentas-de-fotos-web.test.ts` y `test/integracion/cuentas-de-fotos-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta** (`vidrieras.administrar_cuentas_de_imagen`, dentro de la transacción). Acá no se decide ningún permiso.
 *  - **La empresa, la persona y el proveedor los pone el servidor.** El pedido no trae la empresa ni la persona ni el proveedor. Una cuenta de otra empresa es indistinguible de una que no existe.
 *  - **Repetir no duplica.** Declarar lleva la clave del gesto (la fija la página): la misma otra vez devuelve la cuenta ya declarada. Retirar dos veces es lo mismo que una.
 *  - **Dos cambios a la vez no se pisan.** Retirar lleva la versión que la persona vio; con una vieja el caso de uso rechaza sin escribir.
 *  - **Todo error de datos es el genérico** («Esta acción no está permitida»): cuenta inválida, tope de 2, ya declarada, motivo inválido, versión vieja (decisión del orquestador: menor texto). La falta de permiso sale como `SIN_PERMISO`, igual que en el resto del catálogo.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeCuentasDeFotosWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeCatalogo, "declararCuentaDeImagen" | "retirarCuentaDeImagen">;
  consultas: () => Pick<ConsultasDeCatalogo, "listarCuentasDeImagen">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Una cuenta activa de la empresa, para la lista de la pantalla. */
export type CuentaDeFotosParaLaPantalla = Readonly<{
  id: string;
  cuenta: string;
  version: number;
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, d: DependenciasDeCuentasDeFotosWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), d.respuesta),
});

/** Las cuentas activas de la empresa. Es una LECTURA: no escribe ni audita. */
export async function verLasCuentasDeFotos(
  d: DependenciasDeCuentasDeFotosWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly CuentaDeFotosParaLaPantalla[]>> {
  try {
    const lista = await d.consultas().listarCuentasDeImagen(contexto);
    if (!lista.ok) return conError(lista.error, d);
    return {
      ok: true,
      dato: lista.valor.map((c) => ({ id: c.id, cuenta: c.cuenta, version: c.version })),
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

type Declarada = Readonly<{ cuentaId: string; yaExistia: boolean }>;

/** Declara una cuenta de Cloudinary como de la empresa. El proveedor lo fija el servidor; la cuenta la valida el caso de uso. */
export async function declararLaCuentaDeFotos(
  d: DependenciasDeCuentasDeFotosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Declarada>> {
  const pedido = leerElPedidoDeDeclararLaCuentaDeFotos(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const declarada = await d.casosDeUso().declararCuentaDeImagen(contexto, {
      claveDeIdempotencia: pedido.valor.claveDeIdempotencia,
      proveedor: "CLOUDINARY",
      cuenta: pedido.valor.cuenta.trim(),
    });
    return aRespuesta(
      declarada.ok ? declarada : err(traducirErrorDeCatalogo(declarada.error)),
      d.respuesta,
      (salida) => ({
        cuentaId: salida.cuenta.id,
        yaExistia: salida.yaExistia,
      }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

type Retirada = Readonly<{ cuentaId: string; yaEstaba: boolean }>;

/** Retira una cuenta con motivo y con la versión que la persona vio. Repetirlo es éxito sin escribir. */
export async function retirarLaCuentaDeFotos(
  d: DependenciasDeCuentasDeFotosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Retirada>> {
  const pedido = leerElPedidoDeRetirarLaCuentaDeFotos(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const retirada = await d.casosDeUso().retirarCuentaDeImagen(contexto, {
      id: pedido.valor.id,
      motivo: pedido.valor.motivo.trim(),
      versionEsperada: pedido.valor.versionEsperada,
    });
    return aRespuesta(
      retirada.ok ? retirada : err(traducirErrorDeCatalogo(retirada.error)),
      d.respuesta,
      (salida) => ({
        cuentaId: salida.cuenta.id,
        yaEstaba: salida.yaEstaba,
      }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
