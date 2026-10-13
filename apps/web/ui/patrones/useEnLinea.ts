import { useSyncExternalStore } from "react";

function suscribir(avisar: () => void): () => void {
  window.addEventListener("online", avisar);
  window.addEventListener("offline", avisar);
  return () => {
    window.removeEventListener("online", avisar);
    window.removeEventListener("offline", avisar);
  };
}

/**
 * Si el navegador cree que hay conexión. `navigator.onLine` solo asegura lo negativo (falso = sin red);
 * con «verdadero» puede igual no llegar al servidor. Por eso el envío incierto se verifica con la misma
 * clave (`useEnvioConClave`) y no se confía en este valor para dar algo por registrado.
 * En el servidor se asume que hay conexión, para que el HTML inicial no muestre la franja.
 */
export function useEnLinea(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => navigator.onLine,
    () => true,
  );
}
