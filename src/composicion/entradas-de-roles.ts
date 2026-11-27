import { z } from "zod";
import { PLANTILLAS_DE_ORIGEN, type OrigenDeUnRol } from "../modulos/identidad/publico";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";
import { personaId, type PersonaId } from "../primitivas/identificadores/marca";

/**
 * La frontera de la pantalla «Roles» de Cuenta: de lo que manda el navegador a lo que recibe la composición. Lista blanca campo por campo: la empresa y la persona que actúa NO se leen del pedido, salen
 * de la sesión. Lo que se valida acá es la FORMA (identificadores, un origen de la lista cerrada, un tope defensivo de acciones); el nombre, el catálogo, el plan y los pisos los decide el caso
 * de uso dentro de su transacción, y el servidor vuelve a validar todo aunque la pantalla ya lo haya filtrado.
 */

/** Tope defensivo de acciones por pedido (el catálogo tiene unas 190); no es una regla de negocio. */
const MAXIMO_DE_ACCIONES_POR_PEDIDO = 500;
const accion = z.string().min(1).max(100);

const formaDeOrigen = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("VACIO") }),
  z.object({ tipo: z.literal("PLANTILLA"), clave: z.enum(PLANTILLAS_DE_ORIGEN) }),
  z.object({ tipo: z.literal("ROL"), rolId: identificador }),
]);

const formaDeCrear = z.object({ rolId: identificador, nombre: texto, origen: formaDeOrigen });

export type EntradaDeCrearRolWeb = Readonly<{
  rolId: string;
  nombre: string;
  origen: OrigenDeUnRol;
}>;

export function entradaDeCrearRol(crudo: unknown): Resultado<EntradaDeCrearRolWeb, ErrorDeEntrada> {
  const forma = leer(formaDeCrear, crudo);
  return forma.ok ? ok(forma.valor) : forma;
}

const formaDeEditar = z.object({
  rolId: identificador,
  nombre: texto.optional(),
  acciones: z.array(accion).max(MAXIMO_DE_ACCIONES_POR_PEDIDO).optional(),
  reactivar: z.boolean().optional(),
  versionEsperada: entero.optional(),
});

export type EntradaDeEditarRolWeb = Readonly<{
  rolId: string;
  nombre?: string | undefined;
  acciones?: readonly string[] | undefined;
  reactivar?: boolean | undefined;
  versionEsperada?: number | undefined;
}>;

export function entradaDeEditarRol(
  crudo: unknown,
): Resultado<EntradaDeEditarRolWeb, ErrorDeEntrada> {
  const forma = leer(formaDeEditar, crudo);
  return forma.ok
    ? ok({
        ...forma.valor,
        acciones:
          forma.valor.acciones === undefined ? undefined : [...new Set(forma.valor.acciones)],
      })
    : forma;
}

/** Abrir un rol o archivarlo: solo viaja el id de la dirección; decide el servidor si es de la empresa de la sesión (uno ajeno es indistinguible de uno inexistente). */
const formaDeRol = z.object({ rolId: identificador });

export type EntradaDeRolWeb = Readonly<{ rolId: string }>;

export function entradaDeRol(crudo: unknown): Resultado<EntradaDeRolWeb, ErrorDeEntrada> {
  const forma = leer(formaDeRol, crudo);
  return forma.ok ? ok(forma.valor) : forma;
}

/**
 * Asignar un rol a una persona (desde su ficha): la persona (el id de la dirección) y el destino, que es uno de los dos roles base asignables (`ADMINISTRADOR` u `OPERADOR`: el gerente no se asigna, se traspasa) o un rol propio por su
 * id. Lista cerrada: cualquier otra forma no llega a la base. La empresa y quien actúa salen de la sesión; que el rol propio sea de la empresa y esté activo lo decide el caso de uso.
 */
const formaDeAsignarRol = z.object({
  personaId: identificador,
  destino: z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("BASE"), rol: z.enum(["ADMINISTRADOR", "OPERADOR"]) }),
    z.object({ tipo: z.literal("PROPIO"), rolId: identificador }),
  ]),
});

export type EntradaDeAsignarRolWeb = Readonly<{
  personaId: PersonaId;
  destino:
    | Readonly<{ tipo: "BASE"; rol: "ADMINISTRADOR" | "OPERADOR" }>
    | Readonly<{ tipo: "PROPIO"; rolId: string }>;
}>;

export function entradaDeAsignarRol(
  crudo: unknown,
): Resultado<EntradaDeAsignarRolWeb, ErrorDeEntrada> {
  const forma = leer(formaDeAsignarRol, crudo);
  return forma.ok ? ok({ ...forma.valor, personaId: personaId(forma.valor.personaId) }) : forma;
}
