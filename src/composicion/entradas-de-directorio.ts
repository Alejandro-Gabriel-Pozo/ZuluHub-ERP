import { z } from "zod";
import { ROLES_DE_PARTE } from "../modulos/clientes/publico";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de las acciones del directorio de clientes y proveedores: de lo que manda el navegador a lo que reciben los casos de uso y las consultas. Solo se toma lo que el
 * esquema declara: la empresa y la persona NO se leen del pedido (las pone el servidor). Esta capa dice si el dato tiene la FORMA pedida (un texto acotado, un identificador, un rol de
 * la lista cerrada, un entero); qué es un nombre, un documento o un email válidos lo decide el dominio de `clientes`, dentro de la transacción. Un campo opcional del formulario que viene
 * vacío o en blanco es «sin dato» (`null`): el dominio rechaza un blanco como nombre, pero el formulario no puede mandar otra cosa cuando la persona no escribe nada.
 */

const opcional = texto
  .nullable()
  .optional()
  .transform((valor) =>
    valor === undefined || valor === null || valor.trim() === "" ? null : valor,
  );

const rol = z.enum(ROLES_DE_PARTE);
/** Los roles que se piden: de la lista cerrada y sin repetir (hay dos). */
const roles = z
  .array(rol)
  .max(ROLES_DE_PARTE.length)
  .transform((lista) => [...new Set(lista)]);

const formaDeBusqueda = z.object({
  texto: opcional,
  rol: rol.nullable().optional(),
  incluirDesactivadas: z.boolean().optional(),
  despuesDe: identificador.nullable().optional(),
});

const formaDeParte = z.object({
  /** La clave del alta: la genera la pantalla al abrir el formulario (idempotencia). */
  idempotencia: identificador,
  /** Con id y versión es una edición; sin ellos, un alta. */
  parteId: identificador.nullable().optional(),
  versionEsperada: entero.nullable().optional(),
  /** La persona ya vio los posibles duplicados y guarda igual. */
  guardarIgual: z.boolean(),
  naturaleza: texto,
  nombre: texto,
  apellido: opcional,
  alias: opcional,
  documentoTipo: opcional,
  documentoPais: opcional,
  documentoNumero: opcional,
  condicionIva: opcional,
  email: opcional,
  telefono: opcional,
  calle: opcional,
  numero: opcional,
  codigoPostal: opcional,
  localidad: opcional,
  provincia: opcional,
  nota: opcional,
  roles,
});

const formaDeEstado = z.object({ parteId: identificador });
const formaDeContacto = z.object({
  deParteId: identificador,
  contactoId: identificador,
  cargo: opcional,
});
const formaDeQuitarContacto = z.object({
  deParteId: identificador,
  contactoId: identificador,
  tipo: texto,
});

export type EntradaWebDeBusqueda = Readonly<{
  texto: string | null;
  rol: (typeof ROLES_DE_PARTE)[number] | null;
  incluirDesactivadas: boolean;
  despuesDe: string | null;
}>;

export type EntradaWebDeParte = z.output<typeof formaDeParte>;
export type EntradaWebDeEstadoDeParte = Readonly<{ parteId: string }>;
export type EntradaWebDeContacto = Readonly<{
  deParteId: string;
  contactoId: string;
  cargo: string | null;
}>;
export type EntradaWebDeQuitarContacto = Readonly<{
  deParteId: string;
  contactoId: string;
  tipo: string;
}>;

export function entradaDeBusquedaDePartes(
  crudo: unknown,
): Resultado<EntradaWebDeBusqueda, ErrorDeEntrada> {
  const forma = leer(formaDeBusqueda, crudo);
  return forma.ok
    ? ok({
        texto: forma.valor.texto,
        rol: forma.valor.rol ?? null,
        incluirDesactivadas: forma.valor.incluirDesactivadas ?? false,
        despuesDe: forma.valor.despuesDe ?? null,
      })
    : forma;
}

export function entradaDeParte(crudo: unknown): Resultado<EntradaWebDeParte, ErrorDeEntrada> {
  return leer(formaDeParte, crudo);
}

export function entradaDeEstadoDeParte(
  crudo: unknown,
): Resultado<EntradaWebDeEstadoDeParte, ErrorDeEntrada> {
  const forma = leer(formaDeEstado, crudo);
  return forma.ok ? ok({ parteId: forma.valor.parteId }) : forma;
}

export function entradaDeContacto(crudo: unknown): Resultado<EntradaWebDeContacto, ErrorDeEntrada> {
  const forma = leer(formaDeContacto, crudo);
  return forma.ok
    ? ok({
        deParteId: forma.valor.deParteId,
        contactoId: forma.valor.contactoId,
        cargo: forma.valor.cargo,
      })
    : forma;
}

export function entradaDeQuitarContacto(
  crudo: unknown,
): Resultado<EntradaWebDeQuitarContacto, ErrorDeEntrada> {
  const forma = leer(formaDeQuitarContacto, crudo);
  return forma.ok
    ? ok({
        deParteId: forma.valor.deParteId,
        contactoId: forma.valor.contactoId,
        tipo: forma.valor.tipo,
      })
    : forma;
}
