import pg from "pg";

/**
 * Cuenta las sentencias que manda a la base cada cliente de `pg` de ESTE proceso (también `BEGIN`, el contexto firmado y `COMMIT`), menos
 * las de `ignorar` (el cliente del dueño con el que la prueba prepara y verifica: no es tráfico de la aplicación). Sirve para topes
 * como «el listado no pasa de N sentencias». Se detiene con `detener()`; no cambia lo que se manda.
 */
export type ContadorDeSentencias = Readonly<{
  /** Lo mandado desde el último `reiniciar()`, en orden. */
  sentencias(): readonly string[];
  reiniciar(): void;
  detener(): void;
}>;

type ConQuery = { query: (this: pg.Client, ...argumentos: unknown[]) => unknown };

export function contarSentencias(ignorar: pg.Client): ContadorDeSentencias {
  const prototipo = pg.Client.prototype as unknown as ConQuery;
  const original = prototipo.query;
  let vistas: string[] = [];
  prototipo.query = function (this: pg.Client, ...argumentos: unknown[]) {
    const primero = argumentos[0];
    const texto =
      typeof primero === "string" ? primero : ((primero as { text?: string } | null)?.text ?? "");
    if (this !== ignorar) vistas.push(texto);
    return original.apply(this, argumentos);
  };
  return {
    sentencias: () => vistas,
    reiniciar: () => {
      vistas = [];
    },
    detener: () => {
      prototipo.query = original;
    },
  };
}
