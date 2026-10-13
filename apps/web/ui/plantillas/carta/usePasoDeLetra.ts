import { useCallback, useState, useSyncExternalStore } from "react";
import {
  CLAVE_DE_LETRA_GUARDADA,
  leerPasoDeLetra,
  type PasoDeLetra,
} from "../../../../../src/capacidades/experiencia/carta/letra";

function suscribirse(avisar: () => void): () => void {
  window.addEventListener("storage", avisar);
  return () => {
    window.removeEventListener("storage", avisar);
  };
}

/** Lo guardado, o `null`: el almacenamiento puede fallar (ventana privada, datos bloqueados) hasta al leer. */
function leerGuardado(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_DE_LETRA_GUARDADA);
  } catch {
    return null;
  }
}

/**
 * El paso de «Letra» y cómo cambiarlo. Parte del paso normal (en el servidor y en la primera pintura) y
 * toma el guardado del navegador al hidratar. Solo se escribe cuando el comensal toca un paso: mirar la
 * carta no deja nada guardado. Si el almacenamiento falla, el cambio vale igual para esta visita.
 */
export function usePasoDeLetra(): readonly [PasoDeLetra, (paso: PasoDeLetra) => void] {
  const guardado = useSyncExternalStore(suscribirse, leerGuardado, () => null);
  const [elegido, setElegido] = useState<PasoDeLetra | null>(null);
  const cambiar = useCallback((paso: PasoDeLetra) => {
    setElegido(paso);
    try {
      window.localStorage.setItem(CLAVE_DE_LETRA_GUARDADA, paso);
    } catch {
      // Sin almacenamiento la letra cambia igual, solo que no se recuerda.
    }
  }, []);
  return [elegido ?? leerPasoDeLetra(guardado), cambiar];
}
