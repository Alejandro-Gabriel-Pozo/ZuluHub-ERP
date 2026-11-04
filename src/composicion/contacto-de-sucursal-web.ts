import type { Respuesta } from "../capacidades/experiencia/respuesta";
import { resolverSucursal } from "../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../contexto/contexto";
import type { ErrorDeContactoDeSucursal, FichaDeSucursal } from "../modulos/empresas/publico";
import type { SucursalId } from "../primitivas/identificadores/marca";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeWeb } from "./accion-de-web";
import { entradaDeEditarContacto, entradaDeFichaDeContacto } from "./entradas-de-sucursal";
import type { Web } from "./web";

/**
 * El «Contacto de la sucursal» de /cuenta (D-113): teléfono, correo y web de LA SUCURSAL ELEGIDA en el dispositivo, solo para quien
 * puede editar sucursales (gerente y administrador). La ficha para abrir el formulario y la acción de guardar. Vive acá, y no en
 * `apps/web`, por la misma razón que `facturacion-web.ts`: probarse con la base real sin levantar Next.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/sucursales-contacto-web.test.ts`):
 *  - **El servidor decide cuál sucursal.** El pedido trae el id que la persona dice haber elegido; el servidor lo contrasta con las
 *    sucursales que su alcance deja elegir (`sucursalesElegibles` + `resolverSucursal`, la regla del listado de comprobantes, D-18 y
 *    D-37) ANTES de leer o escribir nada. Una ajena, de otra empresa o inexistente es `FISCAL_SUCURSAL_FUERA_DE_ALCANCE`, sin pistas de
 *    cuál de las tres es; sin elegir y con varias para elegir, `FISCAL_SUCURSAL_NO_ELEGIDA`. Nunca se asume «todas».
 *  - **El permiso es del caso de uso.** La ficha exige `sucursales.ver` y editar exige `sucursales.editar` al guard dentro de su
 *    transacción: acá no se decide ningún permiso.
 *  - **Solo el contacto.** El nombre de la sucursal NO viene del navegador: el caso de uso lo exige, así que se vuelve a mandar el que
 *    la ficha acaba de leer. Si alguien lo cambió en el medio, la versión ya no coincide y sale `FISCAL_VERSION_DESACTUALIZADA` sin
 *    escribir: no se pisa un cambio ajeno. La hora de corte no se manda: no se toca.
 *  - **Repetir no duplica ni audita dos veces.** Es la regla natural del caso de uso (`SIN_CAMBIOS`): guardar lo que ya está guardado
 *    devuelve la versión vigente sin escribir, aunque la versión del pedido haya quedado vieja. Por eso el pedido no lleva clave.
 *  - **Dos a la vez no se pisan.** Lleva la versión: quien guarda con una vieja recibe `FISCAL_VERSION_DESACTUALIZADA`.
 *  - **Nada de más sale.** Lista blanca campo por campo: id, nombre, contacto y versión.
 *  - **Todo resultado sale por el camino común** (`aRespuestaFiscal`, ADR-016), sin texto nuevo.
 */

export type DependenciasDeSucursalWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeEmpresas"]>, "editarSucursal">;
  consultas: () => Pick<
    ReturnType<Web["consultasDeEmpresas"]>,
    "fichaDeSucursal" | "sucursalesElegibles"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

/** La ficha de contacto de una sucursal: lo que abre el formulario. `null` en el dato que no tiene. */
export type ContactoDeSucursalParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  contacto: Readonly<{ telefono: string | null; correo: string | null; web: string | null }>;
  /** La que la pantalla manda de vuelta como `versionEsperada` al guardar. */
  version: number;
}>;

/** El campo del formulario al que apunta cada error de dato (los nombres que usa el pedido). */
const CAMPO_DE_CONTACTO: Readonly<Record<ErrorDeContactoDeSucursal, string>> = {
  TELEFONO_DE_SUCURSAL_INVALIDO: "telefono",
  CORREO_DE_SUCURSAL_INVALIDO: "correo",
  WEB_DE_SUCURSAL_INVALIDA: "web",
};

/**
 * Un dato de contacto inválido pasa a `FISCAL_CONFIGURACION_DATOS_INVALIDOS` con su campo («Revisá los datos marcados.», D-67). Todo lo
 * demás pasa SIN CAMBIOS a `aRespuestaFiscal`: la versión vieja y la sucursal ajena ya tienen su código y su texto; el resto (el guard,
 * la empresa que no opera, la sucursal que se borró en el medio, un nombre que ya estaba guardado y no pasa, la base) sale como estaba
 * hasta hoy: su motivo o un error inesperado con referencia `PD-…`. Previene: que un error de contacto salga crudo a la pantalla.
 * Es exhaustiva por tipo: un error de contacto nuevo en el dominio no compila hasta que se le dé su campo.
 */
function conCodigoPublico(error: unknown): unknown {
  return typeof error === "string" && Object.hasOwn(CAMPO_DE_CONTACTO, error)
    ? {
        codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
        campo: CAMPO_DE_CONTACTO[error as ErrorDeContactoDeSucursal],
      }
    : error;
}

/**
 * Resuelve la sucursal con la que se trabaja y lee su ficha, o dice por qué no se puede. Orden: lo que la persona puede elegir (los tres
 * roles, lo propio), cuál de esas es, y recién ahí la ficha, que exige `sucursales.ver`. Una sucursal que la ficha no encuentra
 * (la de otra empresa, o que no existe) se dice como una fuera de alcance: la misma respuesta (D-39).
 */
async function conLaSucursal<S>(
  d: DependenciasDeSucursalWeb,
  contexto: ContextoOperativo,
  elegida: SucursalId | null,
  hacer: (ficha: FichaDeSucursal) => Promise<Resultado<S, unknown>>,
): Promise<Resultado<S, unknown>> {
  const elegibles = await d.consultas().sucursalesElegibles(contexto);
  if (!elegibles.ok) return elegibles;
  const sucursal = resolverSucursal(elegida, elegibles.valor);
  if (!sucursal.ok) return sucursal;
  const ficha = await d.consultas().fichaDeSucursal(contexto, { sucursalId: sucursal.valor });
  if (!ficha.ok) return ficha;
  if (ficha.valor === null) return err("SUCURSAL_FUERA_DE_ALCANCE");
  return hacer(ficha.valor);
}

/**
 * La ficha de la sucursal elegida, para abrir el formulario del contacto (`sucursales.ver`). `crudo`: `{ sucursalId? }`, el id que la
 * persona eligió en el dispositivo (`null` o ausente: no eligió). Es una LECTURA: no escribe ni audita.
 */
export function fichaDeContactoDeSucursal(
  d: DependenciasDeSucursalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ContactoDeSucursalParaLaPantalla>> {
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDeFichaDeContacto,
    (entrada) =>
      conLaSucursal(d, contexto, entrada.sucursalId, (ficha) =>
        Promise.resolve({ ok: true as const, valor: ficha }),
      ),
    (ficha) => ({
      id: ficha.id,
      nombre: ficha.nombre,
      contacto: {
        telefono: ficha.contacto.telefono,
        correo: ficha.contacto.correo,
        web: ficha.contacto.web,
      },
      version: ficha.version,
    }),
  );
}

/**
 * Guardar el contacto de la sucursal elegida (`sucursales.editar`). `crudo`: `{ sucursalId?, versionEsperada, telefono?, correo?,
 * web? }`; `versionEsperada` es la de la ficha que vio la pantalla; un dato AUSENTE no se toca y `null` o un texto en blanco lo
 * borra. Cambiarlo vale para los comprobantes que se den de alta después: los ya emitidos conservan el que congelaron (D-98).
 * Devuelve la versión vigente; la pantalla vuelve a pedir la ficha para mostrar lo guardado.
 */
export function editarContactoDeSucursal(
  d: DependenciasDeSucursalWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ version: number }>>> {
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDeEditarContacto,
    (entrada) =>
      conLaSucursal(d, contexto, entrada.sucursalId, async (ficha) => {
        const editada = await d.casosDeUso().editarSucursal(contexto, {
          sucursalId: ficha.id,
          versionEsperada: entrada.versionEsperada,
          nombre: ficha.nombre,
          telefono: entrada.telefono,
          correo: entrada.correo,
          web: entrada.web,
        });
        return editada.ok ? editada : err(conCodigoPublico(editada.error));
      }),
    (salida) => ({ version: salida.version }),
  );
}
