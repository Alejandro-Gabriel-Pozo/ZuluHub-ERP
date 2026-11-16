import "server-only";
import { redirect } from "next/navigation";
import type { ErrorPublico, Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  agregarElContacto,
  desactivarLaParte,
  fichaDeLaParte,
  guardarLaParte,
  listarLasPartes,
  quitarElContacto,
  reactivarLaParte,
  type DependenciasDeDirectorioWeb,
  type FichaParaLaPantalla,
  type PartesParaLaLista,
  type PosibleDuplicadoParaLaPantalla,
} from "../../../src/composicion/directorio-web";
import { RUTAS_DE_CLIENTES, rutaDeUnaParte } from "../ui/plantillas/clientes/rutas-de-clientes";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";

/**
 * «Clientes y proveedores»: la lectura de la lista y de la ficha y las acciones de guardar, desactivar, reactivar y los contactos. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN
 * actúa (la empresa y la persona salen de la sesión, nunca del formulario) y llaman a `src/composicion/directorio-web.ts`. El permiso y toda regla del negocio los decide el servidor dentro
 * de su transacción: la pantalla no replica ninguna. Al guardar bien se vuelve a la lista (`redirect`); el aviso de posibles duplicados NO es un error: vuelve con la lista de coincidencias
 * y no escribe nada hasta que la persona elige «Guardar igual».
 */

const dependencias: DependenciasDeDirectorioWeb = {
  casosDeUso: web.casosDeUsoDeClientes,
  consultas: web.consultasDeClientes,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Lo que vuelve de guardar: el error ya traducido (o nada) y, si hay coincidencias, las partes parecidas. */
export type ResultadoDeGuardarLaParte = Readonly<{
  error: ErrorPublico | null;
  duplicados: readonly PosibleDuplicadoParaLaPantalla[];
}>;

/** La lista de partes según lo que dice la dirección (`texto`, `rol`, `desactivados`, `despuesDe`): se vuelve a validar en la composición. */
export function cargarLasPartes(
  buscar: Readonly<{
    texto?: string | undefined;
    rol?: string | undefined;
    desactivados?: string | undefined;
    despuesDe?: string | undefined;
  }>,
): Promise<Respuesta<PartesParaLaLista>> {
  const rol =
    buscar.rol === "cliente" ? "CUSTOMER" : buscar.rol === "proveedor" ? "PROVEEDOR" : null;
  return conLaEmpresa((contexto) =>
    listarLasPartes(dependencias, contexto, {
      texto: buscar.texto ?? null,
      rol,
      incluirDesactivadas: buscar.desactivados === "1",
      despuesDe: buscar.despuesDe ?? null,
    }),
  );
}

export function cargarLaParte(parteId: string): Promise<Respuesta<FichaParaLaPantalla>> {
  return conLaEmpresa((contexto) => fichaDeLaParte(dependencias, contexto, parteId));
}

/** Los roles marcados, en la lista cerrada de la composición; lo que no sea un rol conocido lo rechaza ella. */
const rolesDe = (datos: FormData): string[] =>
  datos.getAll("roles").filter((r): r is string => typeof r === "string");

/** Guardar el formulario: un alta (sin `parteId`) o una edición (con `parteId` y la versión que se vio). */
export async function guardarLaParteDelFormulario(
  parteId: string | null,
  versionEsperada: number | null,
  datos: FormData,
): Promise<ResultadoDeGuardarLaParte> {
  const r = await conLaEmpresa((contexto) =>
    guardarLaParte(dependencias, contexto, {
      idempotencia: textoDe(datos, "idempotencia"),
      parteId,
      versionEsperada,
      guardarIgual: textoDe(datos, "guardarIgual") === "1",
      naturaleza: textoDe(datos, "naturaleza"),
      nombre: textoDe(datos, "nombre"),
      apellido: textoDe(datos, "apellido"),
      alias: textoDe(datos, "alias"),
      documentoTipo: textoDe(datos, "documentoTipo"),
      documentoPais: textoDe(datos, "documentoPais"),
      documentoNumero: textoDe(datos, "documentoNumero"),
      condicionIva: textoDe(datos, "condicionIva"),
      email: textoDe(datos, "email"),
      telefono: textoDe(datos, "telefono"),
      calle: textoDe(datos, "calle"),
      numero: textoDe(datos, "numero"),
      codigoPostal: textoDe(datos, "codigoPostal"),
      localidad: textoDe(datos, "localidad"),
      provincia: textoDe(datos, "provincia"),
      nota: textoDe(datos, "nota"),
      roles: rolesDe(datos),
    }),
  );
  if (!r.ok) return { error: r.error, duplicados: [] };
  if (r.dato.estado === "DUPLICADOS") return { error: null, duplicados: r.dato.duplicados };
  redirect(RUTAS_DE_CLIENTES.lista);
}

/** Termina una acción sobre una parte: el error ya traducido, o vuelve a la ficha (`redirect` corta la ejecución). */
function aLaFicha(respuesta: Respuesta<unknown>, parteId: string): ResultadoDeAccion {
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(rutaDeUnaParte(parteId));
}

export async function desactivarLaParteDelDirectorio(parteId: string): Promise<ResultadoDeAccion> {
  const r = await conLaEmpresa((contexto) =>
    desactivarLaParte(dependencias, contexto, { parteId }),
  );
  if (!r.ok) return { error: r.error };
  redirect(RUTAS_DE_CLIENTES.lista);
}

export async function reactivarLaParteDelDirectorio(parteId: string): Promise<ResultadoDeAccion> {
  const r = await conLaEmpresa((contexto) => reactivarLaParte(dependencias, contexto, { parteId }));
  if (!r.ok) return { error: r.error };
  redirect(RUTAS_DE_CLIENTES.lista);
}

export async function agregarUnContacto(
  deParteId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaFicha(
    await conLaEmpresa((contexto) =>
      agregarElContacto(dependencias, contexto, {
        deParteId,
        contactoId: textoDe(datos, "contactoId"),
        cargo: textoDe(datos, "cargo"),
      }),
    ),
    deParteId,
  );
}

export async function quitarUnContacto(
  deParteId: string,
  contactoId: string,
  tipo: string,
): Promise<ResultadoDeAccion> {
  return aLaFicha(
    await conLaEmpresa((contexto) =>
      quitarElContacto(dependencias, contexto, { deParteId, contactoId, tipo }),
    ),
    deParteId,
  );
}
