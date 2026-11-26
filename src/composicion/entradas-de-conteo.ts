import { z } from "zod";
import { MAXIMO_DE_RENGLONES } from "../modulos/stock/publico";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { enBlanco } from "./entradas-de-movimientos";
import {
  decimal,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/** Las formas del pedido del conteo físico web (STK-D): solo la FORMA; los permisos, el depósito y el artículo los resuelve `conteo-web.ts`. Un texto en blanco es «sin valor». */

const formaDeLectura = z.object({ depositoId: identificador.optional() }).strict();
export const formaDeAbrir = z.object({ id: identificador, depositoId: identificador }).strict();
const formaDeRegistro = z
  .object({
    id: identificador,
    conteoId: identificador,
    articuloId: identificador,
    cantidad: decimal,
    hora: z.string().max(10).optional(),
  })
  .strict();
export const formaDeCancelar = z.object({ conteoId: identificador, motivo: texto }).strict();
export const formaDeRevisar = z.object({ conteoId: identificador }).strict();
const formaDeAplicar = z
  .object({
    conteoId: identificador,
    huella: z.string().regex(/^[0-9a-f]{64}$/),
    respuestas: z
      .array(
        z
          .object({
            articuloId: identificador,
            motivo: texto.optional(),
            detalle: texto.optional(),
          })
          .strict(),
      )
      .max(MAXIMO_DE_RENGLONES),
  })
  .strict();

export type EntradaDeLecturaDelConteo = Readonly<{ depositoId: string | undefined }>;
type Registro = Readonly<{
  id: string;
  conteoId: string;
  articuloId: string;
  cantidad: string;
  hora: string | undefined;
}>;
type Aplicar = Readonly<{
  conteoId: string;
  huella: string;
  respuestas: readonly Readonly<{
    articuloId: string;
    motivo: string | undefined;
    detalle: string | undefined;
  }>[];
}>;

export const comoLectura = (c: unknown): Resultado<EntradaDeLecturaDelConteo, ErrorDeEntrada> => {
  const f = leer(formaDeLectura, c);
  return f.ok ? ok({ depositoId: f.valor.depositoId }) : f;
};
export const comoRegistro = (c: unknown): Resultado<Registro, ErrorDeEntrada> => {
  const f = leer(formaDeRegistro, c);
  return f.ok ? ok({ ...f.valor, hora: enBlanco(f.valor.hora) }) : f;
};
export const comoAplicar = (c: unknown): Resultado<Aplicar, ErrorDeEntrada> => {
  const f = leer(formaDeAplicar, c);
  return f.ok
    ? ok({
        conteoId: f.valor.conteoId,
        huella: f.valor.huella,
        respuestas: f.valor.respuestas.map((r) => ({
          articuloId: r.articuloId,
          motivo: enBlanco(r.motivo),
          detalle: enBlanco(r.detalle),
        })),
      })
    : f;
};
