/**
 * Un valor que no puede salir por accidente (spec H7 facturación §B.6.3, «nunca se muestra»): la clave privada de
 * un certificado y el ticket de acceso de ARCA viajan SIEMPRE envueltos. El texto vive en un campo privado de
 * verdad (`#`): ni `JSON.stringify`, ni una plantilla de texto, ni `console.log`, ni el volcado de un error o de
 * una prueba lo muestran; quien lo necesita lo pide por su nombre (`revelar`), y eso se ve en el código.
 *
 * Previene: la clave o el ticket en un registro, una respuesta, una auditoría o el mensaje de un error por haber
 * puesto el objeto entero donde iba un dato. Chequeo: `secreto.test.ts` (cada vía de salida) y el debilitamiento
 * «toJSON devuelve el valor».
 *
 * Dos secretos distintos son iguales para `toEqual` (lo privado no se compara): las pruebas comparan con
 * `revelar()` o con `esIgualA`.
 */
const OCULTO = "[secreto]";

export class Secreto {
  readonly #valor: string;

  constructor(valor: string) {
    this.#valor = valor;
  }

  /** El texto en claro. Cada uso es deliberado: se busca por este nombre. */
  revelar(): string {
    return this.#valor;
  }

  esIgualA(otro: Secreto): boolean {
    return this.#valor === otro.#valor;
  }

  toJSON(): string {
    return OCULTO;
  }

  toString(): string {
    return OCULTO;
  }

  /** `util.inspect` y `console.log` de Node (el símbolo es el mismo de `node:util`; acá no se importa nada). */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return OCULTO;
  }
}
