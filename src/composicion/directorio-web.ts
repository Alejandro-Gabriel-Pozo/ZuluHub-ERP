import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeBusquedaDePartes,
  entradaDeContacto,
  entradaDeEstadoDeParte,
  entradaDeParte,
  entradaDeQuitarContacto,
  type EntradaWebDeParte,
} from "./entradas-de-directorio";
import { accionDeClientes } from "./errores-de-clientes";
import type { Web } from "./web";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";

/**
 * «Clientes y proveedores» (maqueta aprobada `directorio.html`, 09/11/2026): la lista con búsqueda y filtro por rol, el alta, la edición, los roles, los contactos y desactivar o
 * reactivar. Es la ÚNICA puerta de la web al directorio (ADR-015): la empresa y la persona las pone el servidor (llegan en el contexto, nunca del pedido); el permiso lo decide el
 * caso de uso o la consulta dentro de su transacción, y la pantalla no replica ninguna regla. Qué es un nombre, un documento o un email válidos lo decide el dominio.
 *
 *  - **El alta es idempotente**: la clave la genera la pantalla al abrir el formulario; repetir el envío (doble clic, reintento) no crea otra parte.
 *  - **Un nombre repetido solo AVISA** (DDD 15/11/2026, 8b): antes de guardar un alta se buscan los posibles duplicados; si hay y la persona no dijo «Guardar igual», no se escribe nada y
 *    se devuelven para mostrarlos. Solo un documento repetido bloquea (lo rechaza el caso de uso).
 *  - **Editar es atómico** (DEC-0567): los datos y los roles se guardan en UNA transacción (`editarParteConRoles`): o quedan los dos o no queda ninguno.
 */

export type DependenciasDeDirectorioWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeClientes"]>,
    | "crearParte"
    | "editarParteConRoles"
    | "desactivarParte"
    | "reactivarParte"
    | "vincularContacto"
    | "desvincularContacto"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeClientes"]>,
    "buscarPartes" | "fichaDeParte" | "posiblesDuplicados"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

export type ParteParaLaLista = Readonly<{
  id: string;
  naturaleza: "HUMANA" | "JURIDICA";
  nombre: string;
  documento: Readonly<{ tipo: string; pais: string | null; numero: string }> | null;
  roles: readonly string[];
  activa: boolean;
}>;

export type PartesParaLaLista = Readonly<{
  partes: readonly ParteParaLaLista[];
  /** El cursor de la página que sigue, o `null`. */
  siguiente: string | null;
}>;

export type ContactoParaLaPantalla = Readonly<{
  contactoId: string;
  nombre: string;
  tipo: string;
  cargo: string | null;
}>;

export type FichaParaLaPantalla = Readonly<{
  id: string;
  version: number;
  naturaleza: "HUMANA" | "JURIDICA";
  nombre: string | null;
  apellido: string | null;
  alias: string | null;
  documento: Readonly<{ tipo: string; pais: string | null; numero: string }> | null;
  condicionIva: string | null;
  email: string | null;
  telefono: string | null;
  domicilio: Readonly<{
    calle: string;
    numero: string;
    codigoPostal: string | null;
    localidad: string;
    provincia: string;
  }> | null;
  nota: string | null;
  activa: boolean;
  roles: readonly string[];
  /** Las personas que son contacto o agente de esta parte (los vínculos en los que ella es la «parte de»). */
  contactos: readonly ContactoParaLaPantalla[];
}>;

export type PosibleDuplicadoParaLaPantalla = Readonly<{
  parteId: string;
  nombre: string;
}>;

/** Lo que devuelve guardar: o quedó guardada, o hay posibles duplicados y NO se escribió nada (la persona decide «Guardar igual»). */
export type ResultadoDeGuardar =
  | Readonly<{ estado: "GUARDADA"; parteId: string }>
  | Readonly<{
      estado: "DUPLICADOS";
      duplicados: readonly PosibleDuplicadoParaLaPantalla[];
    }>;

/** La lista de partes: buscar, filtrar por rol y pedir las desactivadas. Es una LECTURA: no escribe ni audita. `crudo` viene de la dirección: se lee con la misma frontera. */
export function listarLasPartes(
  d: DependenciasDeDirectorioWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<PartesParaLaLista>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeBusquedaDePartes,
    (entrada) =>
      d.consultas().buscarPartes(contexto, {
        texto: entrada.texto ?? undefined,
        rol: entrada.rol ?? undefined,
        incluirDesactivadas: entrada.incluirDesactivadas,
        despuesDe: entrada.despuesDe ?? undefined,
      }),
    (pagina) => ({
      partes: pagina.partes.map((p) => ({
        id: p.id,
        naturaleza: p.naturaleza,
        nombre: p.nombre,
        documento: p.documento,
        roles: p.roles,
        activa: p.activa,
      })),
      siguiente: pagina.siguiente,
    }),
  );
}

/** La ficha de una parte con sus roles y sus contactos. Una que no existe o es de otra empresa sale como el genérico (indistinguibles). */
export function fichaDeLaParte(
  d: DependenciasDeDirectorioWeb,
  contexto: ContextoOperativo,
  parteId: string,
): Promise<Respuesta<FichaParaLaPantalla>> {
  return accionDeClientes(
    d.respuesta,
    { parteId },
    entradaDeEstadoDeParte,
    async (entrada): Promise<Resultado<FichaParaLaPantalla, unknown>> => {
      const r = await d.consultas().fichaDeParte(contexto, { parteId: entrada.parteId });
      if (!r.ok) return r;
      // Stryker disable next-line StringLiteral: cualquier texto que no es un código conocido sale como el genérico; el nombre es solo para quien lee.
      if (r.valor === null) return err("PARTE_NO_ENCONTRADA");
      const f = r.valor;
      const domicilio = f.domicilio;
      return ok({
        id: f.id,
        version: f.version,
        naturaleza: f.naturaleza,
        nombre: f.nombre,
        apellido: f.apellido,
        alias: f.alias,
        documento: f.documento,
        condicionIva: f.condicionIva,
        email: f.email,
        telefono: f.telefono,
        domicilio:
          domicilio !== null &&
          domicilio.pais === "AR" &&
          domicilio.calle !== null &&
          domicilio.numero !== null &&
          domicilio.localidad !== null &&
          domicilio.provincia !== null
            ? {
                calle: domicilio.calle,
                numero: domicilio.numero,
                codigoPostal: domicilio.codigoPostal,
                localidad: domicilio.localidad,
                provincia: domicilio.provincia,
              }
            : null,
        nota: f.nota,
        activa: f.activa,
        roles: f.roles,
        contactos: f.vinculos
          .filter((v) => v.deParte.id === f.id)
          .map((v) => ({
            contactoId: v.contacto.id,
            nombre: v.contacto.nombre,
            tipo: v.tipo,
            cargo: v.cargo,
          })),
      });
    },
    (ficha) => ficha,
  );
}

/** Los datos del formulario como los pide el dominio: el domicilio argentino estructurado o ninguno, el documento con su tipo y su país o ninguno. */
function datosDeLaParte(e: EntradaWebDeParte) {
  const hayDomicilio = [e.calle, e.numero, e.codigoPostal, e.localidad, e.provincia].some(
    (v) => v !== null,
  );
  return {
    naturaleza: e.naturaleza,
    nombre: e.nombre,
    apellido: e.apellido,
    alias: e.alias,
    documento:
      e.documentoNumero === null
        ? null
        : { tipo: e.documentoTipo ?? "", pais: e.documentoPais, numero: e.documentoNumero },
    condicionIva: e.condicionIva,
    email: e.email,
    telefono: e.telefono,
    domicilio: hayDomicilio
      ? {
          pais: "AR",
          estructurado: {
            calle: e.calle ?? "",
            numero: e.numero ?? "",
            localidad: e.localidad ?? "",
            provincia: e.provincia ?? "",
            codigoPostal: e.codigoPostal,
          },
        }
      : null,
    nota: e.nota,
  };
}

/**
 * Guardar una parte: alta (sin `parteId`) o edición (con `parteId` y la versión que se vio). Ver el encabezado: el alta avisa de los duplicados antes de escribir y la edición guarda los
 * datos y después los roles.
 */
export function guardarLaParte(
  d: DependenciasDeDirectorioWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ResultadoDeGuardar>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeParte,
    async (entrada): Promise<Resultado<ResultadoDeGuardar, unknown>> => {
      const datos = datosDeLaParte(entrada);
      if (entrada.parteId === null || entrada.parteId === undefined) {
        if (!entrada.guardarIgual) {
          const duplicados = await d.consultas().posiblesDuplicados(contexto, {
            nombre: entrada.nombre,
            apellido: entrada.apellido,
            alias: entrada.alias,
            email: entrada.email,
            telefono: entrada.telefono,
          });
          if (!duplicados.ok) return duplicados;
          if (duplicados.valor.length > 0) {
            return ok({
              estado: "DUPLICADOS",
              duplicados: duplicados.valor.map((p) => ({ parteId: p.parteId, nombre: p.nombre })),
            });
          }
        }
        const alta = await d.casosDeUso().crearParte(contexto, {
          ...datos,
          idempotencia: entrada.idempotencia,
          roles: entrada.roles,
        });
        return alta.ok ? ok({ estado: "GUARDADA", parteId: alta.valor.parteId }) : alta;
      }
      if (entrada.versionEsperada === null || entrada.versionEsperada === undefined) {
        // Stryker disable next-line StringLiteral: ídem, el nombre es solo para quien lee.
        return err("VERSION_DESACTUALIZADA");
      }
      const edicion = await d.casosDeUso().editarParteConRoles(contexto, {
        parteId: entrada.parteId,
        versionEsperada: entrada.versionEsperada,
        cambios: datos,
        roles: entrada.roles,
      });
      return edicion.ok ? ok({ estado: "GUARDADA", parteId: entrada.parteId }) : edicion;
    },
    (resultado) => resultado,
  );
}

/** Desactivar una parte (gerente y administrador): la saca de las operaciones nuevas sin tocar las que ya existen. Repetir no escribe ni audita. */
export function desactivarLaParte(
  d: DependenciasDeDirectorioWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeEstadoDeParte,
    (entrada) => d.casosDeUso().desactivarParte(contexto, entrada),
    () => ({}),
  );
}

export function reactivarLaParte(
  d: DependenciasDeDirectorioWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeEstadoDeParte,
    (entrada) => d.casosDeUso().reactivarParte(contexto, entrada),
    () => ({}),
  );
}

/** Agregar una persona como contacto de una empresa, con su cargo. */
export function agregarElContacto(
  d: DependenciasDeDirectorioWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeContacto,
    (entrada) =>
      d.casosDeUso().vincularContacto(contexto, {
        contactoId: entrada.contactoId,
        deParteId: entrada.deParteId,
        tipo: "CONTACTO",
        cargo: entrada.cargo,
      }),
    () => ({}),
  );
}

/** Quitar un contacto (o agente) de una empresa. Repetir no escribe ni audita. */
export function quitarElContacto(
  d: DependenciasDeDirectorioWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeQuitarContacto,
    (entrada) => d.casosDeUso().desvincularContacto(contexto, entrada),
    () => ({}),
  );
}
