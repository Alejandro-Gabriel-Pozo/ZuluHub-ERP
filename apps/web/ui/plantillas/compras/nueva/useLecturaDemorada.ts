import { useEffect, useRef, useState } from "react";
import type {
  ErrorPublico,
  Respuesta,
} from "../../../../../../src/capacidades/experiencia/respuesta";

/**
 * Una LECTURA al servidor que sigue a lo que la persona escribe (buscar un producto o un proveedor, cotizar la compra): espera a que deje de escribir, pide una sola vez y se queda con la
 * respuesta del ÚLTIMO pedido (una respuesta lenta de un pedido viejo no pisa a la nueva). Solo para lecturas: no escriben ni auditan, así que repetirlas no puede duplicar nada (lo que escribe
 * pasa por `useEnvioConClave`). `argumento` en `null` es «no hay nada que pedir»: no hay resultado.
 * Previene: que una búsqueda lenta muestre resultados de lo que ya se borró, y una ráfaga de pedidos por cada tecla. Chequeo: `useLecturaDemorada.test.tsx`.
 */
export type LecturaDemorada<R> = Readonly<{
  dato: R | null;
  error: ErrorPublico | null;
}>;

const VACIA = { dato: null, error: null } as const;

export function useLecturaDemorada<A, R>(
  argumento: A | null,
  leer: (argumento: A) => Promise<Respuesta<R>>,
  esperaMs = 300,
): LecturaDemorada<R> {
  // La respuesta guarda DE QUÉ pedido es: solo se muestra si coincide con lo que está escrito ahora (nunca un resultado de otra cosa).
  const [lectura, setLectura] = useState<Readonly<{ clave: string | null }> & LecturaDemorada<R>>({
    clave: null,
    ...VACIA,
  });
  const ultima = useRef(0);
  const leerAhora = useRef(leer);
  useEffect(() => {
    leerAhora.current = leer;
  });
  // Dos argumentos con el mismo contenido son el mismo pedido.
  const clave = argumento === null ? null : JSON.stringify(argumento);

  useEffect(() => {
    const numero = ++ultima.current;
    if (clave === null) return;
    const temporizador = setTimeout(() => {
      leerAhora
        .current(JSON.parse(clave) as A)
        .then((respuesta) => {
          if (numero !== ultima.current) return;
          setLectura(
            respuesta.ok
              ? { clave, dato: respuesta.dato, error: null }
              : { clave, dato: null, error: respuesta.error },
          );
        })
        .catch(() => {
          // La red falló: sin resultado y sin inventar un error. La persona sigue escribiendo y se vuelve a pedir.
          if (numero === ultima.current) setLectura({ clave: null, ...VACIA });
        });
    }, esperaMs);
    return () => {
      clearTimeout(temporizador);
    };
  }, [clave, esperaMs]);

  return clave !== null && lectura.clave === clave ? lectura : VACIA;
}
