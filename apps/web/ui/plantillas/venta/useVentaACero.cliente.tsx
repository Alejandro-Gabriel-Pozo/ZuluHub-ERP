"use client";

import { useState } from "react";
import type { VentaCobrada } from "../cobrar/modelo-de-cobro";
import type { ConfirmacionDeCero, LineaDeLaVenta } from "./modelo-de-la-cuenta";

/**
 * Lo que la venta recuerda de la venta a $ 0: el diálogo abierto, si la cuenta ACTUAL ya confirmó una línea a $ 0 y la venta que quedó registrada sin cobro. La confirmación vale para una cuenta
 * concreta (la misma matriz de líneas): agregar, quitar o cambiar la cantidad crea otra cuenta y la confirmación se pierde sola (maqueta `venta-rapida-v4.html:663,1013,1017,1102`).
 */
export function useVentaACero(cuenta: readonly LineaDeLaVenta[]) {
  const [abierta, setAbierta] = useState<Exclude<
    ConfirmacionDeCero,
    Readonly<{ tipo: "NINGUNA" }>
  > | null>(null);
  const [confirmadaPara, setConfirmadaPara] = useState<readonly LineaDeLaVenta[] | null>(null);
  const [venta, setVenta] = useState<VentaCobrada | null>(null);

  return {
    abierta,
    abrir: setAbierta,
    cerrar: () => {
      setAbierta(null);
    },
    confirmoCero: confirmadaPara === cuenta,
    confirmarLinea: () => {
      setConfirmadaPara(cuenta);
      setAbierta(null);
    },
    venta,
    registrar: (registrada: VentaCobrada) => {
      setVenta(registrada);
      setAbierta(null);
    },
    reiniciar: () => {
      setAbierta(null);
      setConfirmadaPara(null);
      setVenta(null);
    },
  };
}
