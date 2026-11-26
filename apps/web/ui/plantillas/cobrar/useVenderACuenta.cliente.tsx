"use client";

import { useState, type ReactNode } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { CONFIRMACION_VENTA_A_CERO, type LineaDeLaVenta } from "../venta/modelo-de-la-cuenta";
import { HojaDeVenderACuenta } from "./HojaDeVenderACuenta.cliente";
import type { IdsDeLaVenta } from "./modelo-de-cobro";
import {
  comoVentaCobrada,
  pedidoDeVenderACuenta,
  type VentaACuenta,
  type VentaACuentaDelCobro,
} from "./modelo-de-vender-a-cuenta";
import type { TextosDeCobrar } from "./textos-de-cobrar";
import type { VentaCobrada } from "./modelo-de-cobro";

type Entrada = Readonly<{
  aCuenta: VentaACuentaDelCobro | undefined;
  total: Readonly<{ moneda: string; monto: string }>;
  textosDelCobro: TextosDeCobrar;
  cuenta: readonly LineaDeLaVenta[];
  /** La mesa: la cuenta que ya existe (la venta rápida no tiene cuenta hasta confirmar). */
  cuentaExistente: Readonly<{ cuentaId: string }> | undefined;
  confirmoCero: boolean;
  /** Los ids de la venta de esta pantalla: se fijan una vez y se repiten en cada reintento. */
  idsDeLaVenta: () => IdsDeLaVenta;
  esperaEntreVerificacionesMs: number | undefined;
}>;

export type VentaACuentaDelCobroEnCurso = Readonly<{
  /** La venta ya cargada a la cuenta de un cliente, con la forma del resultado del cobro; `null` mientras no se confirmó. */
  venta: VentaCobrada | null;
  /** La hoja, mientras está abierta (reemplaza a la vista de cobro); `null` si no. */
  hoja: ReactNode;
  /** El botón «Vender a cuenta corriente» del cobro; nada si la página no declaró la hoja o no hay clientes. Se apaga con la vista congelada. */
  boton: (deshabilitado: boolean) => ReactNode;
}>;

/**
 * «Vender a cuenta corriente» dentro de la vista de cobro (CC-5 B1b): si la hoja está abierta y qué venta quedó cargada. Vive aparte de `PantallaDeCobro` para no engordarla; el estado sigue en ella (lo escrito en el
 * cobro no se pierde al abrir la hoja y volver). Los ids de la venta son los de `PantallaDeCobro`: un solo juego por pantalla.
 */
export function useVenderACuenta({
  aCuenta,
  total,
  textosDelCobro,
  cuenta,
  cuentaExistente,
  confirmoCero,
  idsDeLaVenta,
  esperaEntreVerificacionesMs,
}: Entrada): VentaACuentaDelCobroEnCurso {
  const [abierta, setAbierta] = useState(false);
  const [vendida, setVendida] = useState<VentaACuenta | null>(null);
  const hoja =
    abierta && aCuenta !== undefined && vendida === null ? (
      <HojaDeVenderACuenta
        total={total}
        aCuenta={aCuenta}
        textos={aCuenta.textos}
        textosDelCobro={textosDelCobro}
        cuentaDeConsumoId={cuentaExistente?.cuentaId}
        esperaEntreVerificacionesMs={esperaEntreVerificacionesMs}
        pedidoDeLaVenta={(clienteId) =>
          pedidoDeVenderACuenta({
            ids: idsDeLaVenta(),
            clienteId,
            cuenta,
            total,
            confirmaciones: confirmoCero ? [CONFIRMACION_VENTA_A_CERO] : undefined,
            sinLineas: cuentaExistente !== undefined,
          })
        }
        alVendida={setVendida}
        alVolver={() => {
          setAbierta(false);
        }}
      />
    ) : null;
  return {
    venta: vendida === null ? null : comoVentaCobrada(vendida),
    hoja,
    boton: (deshabilitado) =>
      aCuenta !== undefined && aCuenta.clientes.length > 0 ? (
        <Boton
          variante="secundaria"
          deshabilitado={deshabilitado}
          alTocar={() => {
            setAbierta(true);
          }}
        >
          {aCuenta.textos.titulo}
        </Boton>
      ) : null,
  };
}
