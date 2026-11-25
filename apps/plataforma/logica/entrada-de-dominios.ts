/**
 * La forma de lo que el navegador manda al agregar, verificar, activar, desactivar o retirar el dominio de una empresa. El navegador NO es de confianza: acá se
 * comprueba solo la FORMA (tipos y valores de las listas cerradas); el nombre del sitio (normalización, único), la empresa y el estado del dominio los decide el
 * caso de uso. Lo que no está en la lista se descarta: una clave de más nunca llega al caso. La clave de idempotencia la fija el navegador por intento.
 */
import {
  SUPERFICIES_DE_ALTA,
  TITULARES_DE_ALTA,
  type SuperficieDeAlta,
  type TitularDeAlta,
} from "./cambio-de-dominio";
import { esRegistro, esUuid, type Forma } from "./entrada-de-lista";

export type EntradaDeAgregarDominio = Readonly<{
  claveDeIdempotencia: string;
  empresaId: string;
  host: string;
  superficie: SuperficieDeAlta;
  titular: TitularDeAlta;
}>;
export type EntradaDeCambiarDominio = Readonly<{ claveDeIdempotencia: string; dominioId: string }>;
export type EntradaDeRetirarDominio = EntradaDeCambiarDominio & Readonly<{ motivo: string }>;

const enLista = <T extends string>(lista: readonly T[], valor: unknown): T | null =>
  lista.find((v) => v === valor) ?? null;

export function entradaDeAgregarDominio(entrada: unknown): Forma<EntradaDeAgregarDominio> {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, empresaId, host } = entrada;
  const superficie = enLista(SUPERFICIES_DE_ALTA, entrada["superficie"]);
  const titular = enLista(TITULARES_DE_ALTA, entrada["titular"]);
  if (
    !esUuid(claveDeIdempotencia) ||
    !esUuid(empresaId) ||
    typeof host !== "string" ||
    superficie === null ||
    titular === null
  ) {
    return { ok: false };
  }
  return { ok: true, valor: { claveDeIdempotencia, empresaId, host, superficie, titular } };
}

export function entradaDeCambiarDominio(entrada: unknown): Forma<EntradaDeCambiarDominio> {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, dominioId } = entrada;
  if (!esUuid(claveDeIdempotencia) || !esUuid(dominioId)) return { ok: false };
  return { ok: true, valor: { claveDeIdempotencia, dominioId } };
}

export function entradaDeRetirarDominio(entrada: unknown): Forma<EntradaDeRetirarDominio> {
  const base = entradaDeCambiarDominio(entrada);
  if (!base.ok || !esRegistro(entrada) || typeof entrada["motivo"] !== "string") {
    return { ok: false };
  }
  return { ok: true, valor: { ...base.valor, motivo: entrada["motivo"] } };
}
