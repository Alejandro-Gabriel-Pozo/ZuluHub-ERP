import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import type { AccionesDeImpresion } from "./ImpresionDelDocumento.cliente";
import type { AccionesDeLaCocina } from "./useCocinaDeLaMesa.cliente";

export type Accion = (pedido: unknown) => Promise<Respuesta<unknown>>;

/** Las acciones del servidor que usa la ficha de la mesa (la página las pasa ya enlazadas; la pantalla no importa el servidor). */
export type AccionesDelServidorDeLaMesa = AccionesDeLaCocina &
  AccionesDeImpresion &
  Readonly<{
    tomarPedido: Accion;
    agregar: Accion;
    cambiarSalida: Accion;
    cambiarNota: Accion;
    quitar: Accion;
    liberar: Accion;
    cambiarDeMesa: Accion;
    unir: Accion;
  }>;
