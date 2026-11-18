import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeComandas } from "../modulos/comandas/publico";
import type { CasosDeUsoDeSalon, ConsultasDeSalon } from "../modulos/salon/publico";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { laCuentaEsDeLaSucursal } from "./cuenta-de-mesa-web";
import {
  leerElPedidoDeAnular,
  leerElPedidoDeCambiarSalida,
  leerElPedidoDeEnviar,
  leerElPedidoDePedirQueSalga,
} from "./entradas-de-comandas";
import { accionDelSalon } from "./errores-de-salon";

/**
 * Las comandas del salón (S-0r; E7 §3.5; la base de S-4 y S-5): enviar a cocina, pedir que salga, el orden de salida de cada plato y anular un ítem ya enviado. La impresión (impresoras y trabajos) está en
 * `impresion-web.ts`. Vive acá, y no en `apps/web`, para probarse con la base real sin levantar Next.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/comandas-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta** (`comandas.enviar`, `cuentas.anular_linea`): acá no se decide ninguno.
 *  - **La sucursal la pone el servidor** (llega ya resuelta por `apps/web/servidor/comandas.ts`, nunca del pedido): vacía cierra con el genérico, nunca se asume «todas». La cuenta que se nombra tiene que ser de una
 *    mesa de esa sucursal (contra el mapa de mesas de la sucursal); si no, es el genérico, igual que si no existiera. El rótulo del papel («Mesa 5») lo arma el servidor desde la mesa: no viaja en el pedido.
 *  - **Repetir no duplica.** El id y la clave de cada intento los fija la pantalla: enviar dos veces con el mismo `envioId` es un solo envío y un solo papel (`yaExistia`), anular dos veces con el mismo
 *    `avisoId` es un solo aviso. Dos mozos que envían a la vez: uno envía y el otro recibe «nada para enviar» (el genérico), no un envío vacío.
 *  - **Imprimir nunca bloquea el envío**: sin impresora el envío queda registrado y sale `sinImpresora` para «Ver en pantalla».
 *  - **Nada de más sale.** Lista blanca campo por campo.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeSalon`: el genérico para toda regla del negocio que no tiene texto propio).
 */

export type DependenciasDeComandasWeb = Readonly<{
  /** Enviar, pedir que salga y anular un ítem enviado pasan por el salón: él valida la mesa y arma el rótulo del papel («Mesa N»). */
  casosDeUsoDeSalon: () => Pick<
    CasosDeUsoDeSalon,
    "enviarACocina" | "pedirQueSalga" | "anularItemEnviado"
  >;
  casosDeUso: () => Pick<CasosDeUsoDeComandas, "cambiarSalida">;
  /** Solo para saber qué cuentas son de la sucursal de trabajo. */
  consultasDeSalon: () => Pick<ConsultasDeSalon, "mapaDeMesas">;
  respuesta: DependenciasDeRespuesta;
}>;

export type EnvioParaLaPantalla = Readonly<{
  envioId: string;
  numero: number;
  tipo: string;
  lineas: number;
  trabajoId: string;
  sinImpresora: boolean;
  ignoradas: readonly string[];
  yaExistia: boolean;
}>;
type Dependencias = DependenciasDeComandasWeb;

const envioParaLaPantalla = (s: {
  envioId: string;
  numero: number;
  tipo: string;
  lineas: number;
  trabajoId: string;
  sinImpresora: boolean;
  ignoradas: readonly string[];
  yaExistia: boolean;
}): EnvioParaLaPantalla => ({
  envioId: s.envioId,
  numero: s.numero,
  tipo: s.tipo,
  lineas: s.lineas,
  trabajoId: s.trabajoId,
  sinImpresora: s.sinImpresora,
  ignoradas: [...s.ignoradas],
  yaExistia: s.yaExistia,
});

/** ¿La cuenta es de una mesa de la sucursal de trabajo? Si no, `null`: el genérico, igual que si no existiera. */
async function conLaCuenta<S>(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  cuentaId: string,
  hacer: () => Promise<S>,
) {
  const es = await laCuentaEsDeLaSucursal(
    { consultas: d.consultasDeSalon },
    contexto,
    sucursalId,
    cuentaId,
  );
  if (!es.ok) return es;
  return es.valor ? hacer() : null;
}

/** «Enviar a cocina»: todo lo que sale ahora y todavía no se envió, en un envío numerado. Repetir con el mismo `envioId` devuelve el mismo envío. */
export function enviarALaCocina(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<EnvioParaLaPantalla>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeEnviar,
    (pedido) =>
      conLaCuenta(d, contexto, sucursalId, pedido.cuentaId, () =>
        d.casosDeUsoDeSalon().enviarACocina(contexto, pedido),
      ),
    envioParaLaPantalla,
  );
}

/** «Pedir que salga»: los platos que esperaban (algunos o todos) salen en un envío más. */
export function pedirQueSalga(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<EnvioParaLaPantalla>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDePedirQueSalga,
    (pedido) =>
      conLaCuenta(d, contexto, sucursalId, pedido.cuentaId, () =>
        d.casosDeUsoDeSalon().pedirQueSalga(contexto, pedido),
      ),
    envioParaLaPantalla,
  );
}

/** Anula (todo o una parte de) un ítem ya enviado, con motivo, y avisa a la cocina. Repetir con el mismo `avisoId` devuelve el mismo aviso. */
export function anularUnItemEnviado(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<
  Respuesta<
    Readonly<{
      avisoId: string;
      quedan: string;
      lineaDelResto: string | null;
      trabajoId: string;
      sinImpresora: boolean;
      yaExistia: boolean;
    }>
  >
> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeAnular,
    (pedido) =>
      conLaCuenta(d, contexto, sucursalId, pedido.cuentaId, () =>
        d.casosDeUsoDeSalon().anularItemEnviado(contexto, pedido),
      ),
    (s) => ({
      avisoId: s.avisoId,
      quedan: s.quedan,
      lineaDelResto: s.lineaDelResto,
      trabajoId: s.trabajoId,
      sinImpresora: s.sinImpresora,
      yaExistia: s.yaExistia,
    }),
  );
}

/** El orden de salida de un plato todavía no enviado: «Sale ahora» o «Sale después». Pedir la que ya tiene devuelve `yaEstaba`. */
export function cambiarLaSalida(
  d: Dependencias,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ salida: string; yaEstaba: boolean }>>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeCambiarSalida,
    (pedido) =>
      conLaCuenta(d, contexto, sucursalId, pedido.cuentaId, () =>
        d.casosDeUso().cambiarSalida(contexto, pedido),
      ),
    (s) => ({ salida: s.salida, yaEstaba: s.yaEstaba }),
  );
}
