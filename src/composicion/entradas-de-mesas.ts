import { z } from "zod";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer } from "./entradas-de-facturacion";

/**
 * La entrada de la pantalla «Mesas» (S-1; maqueta aprobada `mesas.html`): de lo que mandan los formularios a lo que aceptan `crearMesa`, `editarMesa`, `desactivarMesa` y
 * `reactivarMesa`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona, la sucursal ni el estado
 * de la mesa; la sucursal la fija el servidor). Esta capa dice si el dato tiene la FORMA pedida (el número, la columna y la fila son uno o dos dígitos; la forma y el tamaño, palabras
 * en mayúscula): si el número de la mesa es válido para el negocio (1 a 99), si la forma o el tamaño existen y si la mesa entra en el salón lo decide el dominio dentro de la transacción
 * (los rangos viven una vez, en `dominio/mesa.ts`).
 *
 *  - **La clave de creación es el `id` de la mesa** (idempotencia: el mismo `id` y el mismo contenido devuelven la mesa ya creada, sin duplicar). La fija la página, no el navegador.
 *  - **Editar lleva la versión que la persona vio**: con una vieja el caso de uso rechaza sin escribir y la pantalla recarga.
 * Chequeo: `entradas-de-mesas.test.ts`.
 */

/** Uno o dos dígitos: la forma del número de mesa, de la columna y de la fila (cuántas hay lo decide el dominio). */
const DIGITOS = z.string().regex(/^[0-9]{1,2}$/);
export const PALABRA = z.string().regex(/^[A-Z]{1,20}$/);

const DATOS = {
  numero: DIGITOS,
  forma: PALABRA,
  tamano: PALABRA,
  columna: DIGITOS,
  fila: DIGITOS,
};
const FORMA_DE_CREAR = z.object({ claveDeCreacion: identificador, ...DATOS });
const FORMA_DE_EDITAR = z.object({ mesaId: identificador, versionEsperada: entero, ...DATOS });
const FORMA_DE_UNA_MESA = z.object({ mesaId: identificador });

export type DatosDeLaMesa = Readonly<{
  numero: number;
  forma: string;
  tamano: string;
  columna: number;
  fila: number;
}>;

export type ErrorDeEntradaDeMesa = "PEDIDO_INVALIDO" | "NUMERO_DE_MESA_INVALIDO";
type Pedido<T> = Resultado<T, ErrorDeEntradaDeMesa>;

type Crudos = z.output<z.ZodObject<typeof DATOS>>;

/** El número sin forma de número (vacío, letras, tres dígitos) es el error con texto propio de la pantalla; el resto de lo mal formado es el pedido inválido (genérico). */
function numeroConForma(crudo: unknown): boolean {
  const numero =
    typeof crudo === "object" && crudo !== null
      ? (crudo as { numero?: unknown }).numero
      : undefined;
  return typeof numero === "string" && DIGITOS.safeParse(numero).success;
}

const aNumeros = (d: Crudos): DatosDeLaMesa => ({
  numero: Number(d.numero),
  forma: d.forma,
  tamano: d.tamano,
  columna: Number(d.columna),
  fila: Number(d.fila),
});

export type PedidoDeCrearMesa = Readonly<{ claveDeCreacion: string }> & DatosDeLaMesa;
export type PedidoDeEditarMesa = Readonly<{ mesaId: string; versionEsperada: number }> &
  DatosDeLaMesa;
export type PedidoDeUnaMesa = Readonly<{ mesaId: string }>;

export function leerElPedidoDeCrearMesa(crudo: unknown): Pedido<PedidoDeCrearMesa> {
  const forma = leer(FORMA_DE_CREAR, crudo);
  if (!forma.ok) return err(numeroConForma(crudo) ? "PEDIDO_INVALIDO" : "NUMERO_DE_MESA_INVALIDO");
  return ok({ claveDeCreacion: forma.valor.claveDeCreacion, ...aNumeros(forma.valor) });
}

export function leerElPedidoDeEditarMesa(crudo: unknown): Pedido<PedidoDeEditarMesa> {
  const forma = leer(FORMA_DE_EDITAR, crudo);
  if (!forma.ok) return err(numeroConForma(crudo) ? "PEDIDO_INVALIDO" : "NUMERO_DE_MESA_INVALIDO");
  return ok({
    mesaId: forma.valor.mesaId,
    versionEsperada: forma.valor.versionEsperada,
    ...aNumeros(forma.valor),
  });
}

export function leerElPedidoDeUnaMesa(crudo: unknown): Pedido<PedidoDeUnaMesa> {
  const forma = leer(FORMA_DE_UNA_MESA, crudo);
  return forma.ok ? ok({ mesaId: forma.valor.mesaId }) : err("PEDIDO_INVALIDO");
}
