import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  DATOS_ADMITIDOS_POR_MEDIO,
  DATOS_DEL_COBRO,
  type DatoDelCobro,
  type TipoDeMedio,
} from "../modulos/caja/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeCaja } from "./errores-de-caja";
import {
  entradaDeAltaDeMedio,
  entradaDeDatosDelMedio,
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
 *  - **Editar el nombre solo toca el nombre.** Se vuelven a mandar los datos que el medio ya pide; si cambiaron, la versión ya no coincide y no se escribe.
 *  - **Los datos que se piden al cobrar (decisión 129) se cambian con su propia acción** (`cambiarLosDatosDelMedio`): manda el conjunto final de los que
 *    aparecen y deja el nombre como está. Solo se ofrecen (y se muestran) los datos que el TIPO admite: el techo (`DATOS_ADMITIDOS_POR_MEDIO`) sale del
 *    servidor y la pantalla no lo repite; el servidor lo rechaza igual si llega uno de más.
 *  - **Nada de más sale.** Lista blanca campo por campo: id, tipo, nombre, estado, versión y los datos que el tipo admite (con si el medio los pide).
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

/** Un dato del cobro que el tipo del medio admite, y si el medio lo pide (casilla «aparece»). */
export type DatoDelMedioParaLaPantalla = Readonly<{ dato: DatoDelCobro; pide: boolean }>;

/** Un medio de pago para la pantalla. `datos`: solo los que el tipo admite, en el orden de `DATOS_DEL_COBRO` (vacío: el tipo no admite ninguno). */
export type MedioParaLaPantalla = Readonly<{
  id: string;
  tipo: string;
  nombre: string | null;
  activo: boolean;
  version: number;
  datos: readonly DatoDelMedioParaLaPantalla[];
}>;

/** Los datos que un tipo admite con su estado; un tipo que el dominio no conoce no admite ninguno (ante la duda, nada). */
function datosAdmitidos(
  tipo: string,
  pide: Readonly<Record<DatoDelCobro, boolean>>,
): readonly DatoDelMedioParaLaPantalla[] {
  const admitidos: readonly DatoDelCobro[] = Object.hasOwn(DATOS_ADMITIDOS_POR_MEDIO, tipo)
    ? DATOS_ADMITIDOS_POR_MEDIO[tipo as TipoDeMedio]
    : [];
  return DATOS_DEL_COBRO.filter((dato) => admitidos.includes(dato)).map((dato) => ({
    dato,
    pide: pide[dato],
  }));
}

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
        datos: datosAdmitidos(m.tipo, m.datos),
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

/** Cambia qué datos pide el medio al cobrar (el conjunto final); el nombre queda como está. Devuelve la versión vigente. */
export function cambiarLosDatosDelMedio(
  d: DependenciasDeMediosDePagoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ version: number }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeDatosDelMedio,
    async (entrada): Promise<Resultado<Readonly<{ version: number }>, unknown>> => {
      const lista = await d.consultas().listarMediosDePago(contexto, { incluirInactivos: true });
      if (!lista.ok) return lista;
      const actual = lista.valor.medios.find((m) => m.id === entrada.medioDePagoId);
      if (actual === undefined) return err("MEDIO_NO_ENCONTRADO");
      return d.casosDeUso().editarMedioDePago(contexto, {
        medioDePagoId: entrada.medioDePagoId,
        versionEsperada: entrada.versionEsperada,
        nombre: actual.nombre,
        datos: entrada.pide,
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
