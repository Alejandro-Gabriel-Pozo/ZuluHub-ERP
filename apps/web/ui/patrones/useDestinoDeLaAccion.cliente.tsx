"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Lo que hace un formulario cuando su acción salió bien y trae adónde ir (`ResultadoDeAccion.destino`, ver `redirigirAlTerminar` en `servidor/acciones.ts`): lo abre el navegador, con su host, y pide
 * la pantalla de nuevo, porque si el destino es la pantalla donde ya está (guardar la ficha vuelve a la ficha) `push` solo no la vuelve a pedir y quedaría con los datos y la versión de antes.
 * Sin `destino` no hace nada. Previene: guardar y ver «No encontrado» (Next pedía el destino a `localhost` y la puerta por host lo tomaba por un host desconocido), o ver lo de antes.
 */
export function useDestinoDeLaAccion(destino: string | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (destino === undefined) return;
    router.push(destino);
    router.refresh();
  }, [destino, router]);
}
