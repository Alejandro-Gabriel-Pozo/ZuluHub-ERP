import { z } from "zod";
import { personaId, type PersonaId } from "../primitivas/identificadores/marca";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de la pantalla «Usuarios» de Cuenta: de lo que manda el navegador a lo que recibe la composición. Solo se toma lo que el esquema declara
 * (lista blanca, campo por campo): la empresa y la persona que actúa NO se leen del pedido, salen de la sesión. Del navegador solo viaja el id de la
 * persona de la ficha (la dirección); decide el servidor si es de la empresa de la sesión (una ajena es indistinguible de una inexistente). Una forma que no
 * es un identificador no llega a la base.
 */

const formaDeFicha = z.object({ personaId: identificador });

export type EntradaDeFichaDeUsuario = Readonly<{ personaId: PersonaId }>;

export function entradaDeFichaDeUsuario(
  crudo: unknown,
): Resultado<EntradaDeFichaDeUsuario, ErrorDeEntrada> {
  const forma = leer(formaDeFicha, crudo);
  return forma.ok ? ok({ personaId: personaId(forma.valor.personaId) }) : forma;
}
