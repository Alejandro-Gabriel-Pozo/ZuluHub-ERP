import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeCaja } from "./errores-de-caja";
import {
  entradaDeAltaDeMedio,
  entradaDeEdicionDeMedio,
  entradaDeEstadoDeMedio,
} from "./entradas-de-caja";
import type { Web } from "./web";

/**
 * «Medios de pago» de la configuración de caja (maqueta aprobada `medios.html`, 09/11/2026): la lista de los medios de la empresa y las acciones de
 * agregar, editar el nombre, desactivar y reactivar. Vive acá, y no en `apps/web`, por la misma razón que `contacto-de-sucursal-web.ts`: probarse con la
 * base real sin levantar Next.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/medios-de-pago-web.test.ts`):
 *  - **El permiso es del caso de uso.** La lista exige `cajas.ver`; agregar, editar, desactivar y reactivar exigen su acción `medios_de_pago.*` al guard
 *    dentro de su transacción: acá no se decide ningún permiso. Sin permiso (o con `caja` en desarrollo) sale el motivo del guard.
 *  - **La empresa y la persona las pone el servidor**: el pedido no las trae. Los medios son de la empresa, no de una sucursal: no hay alcance que resolver.
 *  - **Repetir no duplica.** Agregar lo que ya existe activo devuelve el existente sin escribir (`yaExistia`); desactivar lo desactivado o reactivar lo
 *    activo no escribe ni audita. Por eso el pedido no lleva clave de idempotencia: es la regla natural del caso de uso.
 *  - **Dos a la vez no se pisan.** Editar lleva la versión que la pantalla vio: con una vieja el caso de uso rechaza sin escribir.
 *  - **Editar solo toca el nombre.** Los datos opcionales del cobro del medio (decisión 129) los fija otra pantalla: acá se vuelven a mandar los que el
 *    medio tiene. Si cambiaron en el medio, la versión ya no coincide y no se escribe.
 *  - **Nada de más sale.** Lista blanca campo por campo: id, tipo, nombre, estado y versión.
 *  - **Todo resultado sale por el camino común** (`accionDeCaja`, ADR-016), sin texto nuevo.
 */

export type DependenciasDeMediosDePagoWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCaja"]>,
    "crearMedioDePago" | "editarMedioDePago" | "desactivarMedioDePago" | "reactivarMedioDePago"
  >;
  consultas: () => Pick<ReturnType<Web["consultasDeCaja"]>, "listarMediosDePago">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Un medio de pago para la pantalla: sin los datos que pide al cobrar (no son de esta pantalla). */
export type MedioParaLaPantalla = Readonly<{
  id: string;
  tipo: string;
  nombre: string | null;
  activo: boolean;
  version: number;
}>;

export type MediosParaLaPantalla = Readonly<{ medios: readonly MedioParaLaPantalla[] }>;

/** Todos los medios de la empresa, también los desactivados (para poder reactivarlos). Es una LECTURA: no escribe ni audita. */
export async function listarLosMediosDePago(
  d: DependenciasDeMediosDePagoWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<MediosParaLaPantalla>> {
  return accionDeCaja(
    d.respuesta,
    {},
    () => ok({}),
    () => d.consultas().listarMediosDePago(contexto, { incluirInactivos: true }),
    (lista) => ({
      medios: lista.medios.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        nombre: m.nombre,
        activo: m.activo,
        version: m.version,
      })),
    }),
  );
}

/** Agrega un medio de la lista cerrada de tipos, con nombre propio si se quiere. Devuelve solo su id. */
export function agregarElMedioDePago(
  d: DependenciasDeMediosDePagoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ medioDePagoId: string }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeAltaDeMedio,
    (entrada) => d.casosDeUso().crearMedioDePago(contexto, entrada),
    (salida) => ({ medioDePagoId: salida.medioDePagoId }),
  );
}

/** Cambia el nombre de un medio; devuelve la versión vigente. */
export function editarElMedioDePago(
  d: DependenciasDeMediosDePagoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ version: number }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEdicionDeMedio,
    async (entrada): Promise<Resultado<Readonly<{ version: number }>, unknown>> => {
      const lista = await d.consultas().listarMediosDePago(contexto, { incluirInactivos: true });
      if (!lista.ok) return lista;
      const actual = lista.valor.medios.find((m) => m.id === entrada.medioDePagoId);
      if (actual === undefined) return err("MEDIO_NO_ENCONTRADO");
      return d.casosDeUso().editarMedioDePago(contexto, {
        medioDePagoId: entrada.medioDePagoId,
        versionEsperada: entrada.versionEsperada,
        nombre: entrada.nombre,
        datos: actual.datos,
      });
    },
    (salida) => ({ version: salida.version }),
  );
}

/** Desactiva un medio (el efectivo no se desactiva nunca). Nada se borra. */
export function desactivarElMedioDePago(
  d: DependenciasDeMediosDePagoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEstadoDeMedio,
    (entrada) => d.casosDeUso().desactivarMedioDePago(contexto, entrada),
    () => ({}),
  );
}

/** Reactiva un medio desactivado. */
export function reactivarElMedioDePago(
  d: DependenciasDeMediosDePagoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEstadoDeMedio,
    (entrada) => d.casosDeUso().reactivarMedioDePago(contexto, entrada),
    () => ({}),
  );
}
