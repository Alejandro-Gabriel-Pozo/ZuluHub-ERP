import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";
import type { NaturalezaDeParte } from "./estados";

/**
 * Los vínculos entre dos partes de la misma empresa (E9 §3.1): `CONTACTO` («alguien con quien se habla de la otra parte») y `AGENTE_DE` («persona
 * que consume por cuenta de una empresa y cuya cuenta paga la empresa»). Las dos banderas son las de la tabla sembrada `tipo_de_vinculo` (0034):
 * quien es contacto o agente tiene que ser una persona y, para `AGENTE_DE`, la otra punta tiene que ser una empresa. La base repite estas reglas
 * con disparadores (`parte_vinculo_validar`); una prueba de integración las compara.
 */
export const TIPOS_DE_VINCULO = ["CONTACTO", "AGENTE_DE"] as const;
export type TipoDeVinculo = (typeof TIPOS_DE_VINCULO)[number];

export const REGLAS_DE_VINCULO: Readonly<
  Record<TipoDeVinculo, Readonly<{ contactoHumana: boolean; deParteJuridica: boolean }>>
> = {
  CONTACTO: { contactoHumana: true, deParteJuridica: false },
  AGENTE_DE: { contactoHumana: true, deParteJuridica: true },
};

export type ErrorDeVinculo =
  "VINCULO_CONSIGO_MISMA" | "CONTACTO_DEBE_SER_HUMANA" | "VINCULO_DEBE_SER_CON_EMPRESA";

export function esTipoDeVinculo(texto: string): texto is TipoDeVinculo {
  return (TIPOS_DE_VINCULO as readonly string[]).includes(texto);
}

/** ¿Se puede vincular la parte `contacto` con la parte `deParte` con este tipo? El primer error, en el orden: misma parte, contacto, empresa. */
export function validarVinculo(
  tipo: TipoDeVinculo,
  contacto: Readonly<{ id: string; naturaleza: NaturalezaDeParte }>,
  deParte: Readonly<{ id: string; naturaleza: NaturalezaDeParte }>,
): Resultado<null, ErrorDeVinculo> {
  if (contacto.id === deParte.id) return err("VINCULO_CONSIGO_MISMA");
  const regla = REGLAS_DE_VINCULO[tipo];
  if (regla.contactoHumana && contacto.naturaleza !== "HUMANA") {
    return err("CONTACTO_DEBE_SER_HUMANA");
  }
  if (regla.deParteJuridica && deParte.naturaleza !== "JURIDICA") {
    return err("VINCULO_DEBE_SER_CON_EMPRESA");
  }
  return ok(null);
}

/** El cargo de un contacto («Compras», «Encargado de cocina»): el largo del DDL de `parte_vinculo.cargo` (`parte_vinculo_cargo_ck`, 0034). */
export const LARGO_MAXIMO_DEL_CARGO_DE_VINCULO = 100;

/** El cargo es opcional: ausente, `null` o en blanco queda `null`; si viene, una línea de la lista de permitidos con al menos una letra. */
export function cargoDeVinculoDesdeTexto(
  texto: string | null | undefined,
): Resultado<string | null, "CARGO_INVALIDO"> {
  if (texto === undefined || texto === null || texto.trim() === "") return ok(null);
  const valido = textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_CARGO_DE_VINCULO,
    exigirUnaLetra: true,
  });
  return valido.ok ? valido : err("CARGO_INVALIDO");
}
