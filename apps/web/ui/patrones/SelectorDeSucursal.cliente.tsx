"use client";

import { useSyncExternalStore } from "react";
import {
  claveDeSucursalLocal,
  sucursalElegida,
  type SucursalElegible,
} from "../../../../src/capacidades/experiencia/sucursal";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../src/capacidades/vocabulario/vocabulario";
import { Selector } from "../componentes/Selector";
import { Texto } from "../primitivas/Texto";

/**
 * La sucursal con la que se trabaja en ESTE dispositivo (armazón web §1.1): una preferencia local, no un dato
 * del servidor. Se recuerda por empresa en `localStorage`; si el almacenamiento falta o falla (ventana
 * privada, sitio bloqueado) la pantalla anda igual, sin recordar. Quién la usa y para qué (el punto de venta
 * de un comprobante) lo decide cada pantalla que la necesite; el servidor igual verifica en cada operación.
 */
export type SucursalParaElegir = SucursalElegible & Readonly<{ nombre: string }>;

const AVISO_LOCAL = "zh:sucursal-cambiada";

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function suscribir(avisar: () => void): () => void {
  window.addEventListener("storage", avisar);
  window.addEventListener(AVISO_LOCAL, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(AVISO_LOCAL, avisar);
  };
}

export type PropsDeSelectorDeSucursal = Readonly<{
  empresaId: string;
  sucursales: readonly SucursalParaElegir[];
  diccionario?: DiccionarioResuelto;
}>;

export function SelectorDeSucursal({
  empresaId,
  sucursales,
  diccionario = {},
}: PropsDeSelectorDeSucursal) {
  const clave = claveDeSucursalLocal(empresaId);
  const guardada = useSyncExternalStore(
    suscribir,
    () => leer(clave),
    () => null,
  );
  const elegida = sucursalElegida(guardada, sucursales);
  const [unica, ...resto] = sucursales;
  if (unica === undefined) return null;
  if (resto.length === 0) {
    return (
      <Texto>
        {texto(diccionario, "sucursal.etiqueta")}: {unica.nombre}
      </Texto>
    );
  }
  return (
    <Selector
      etiqueta={texto(diccionario, "sucursal.etiqueta")}
      ayuda={texto(diccionario, "sucursal.ayuda")}
      valor={elegida ?? ""}
      textoDeElegir={elegida === null ? texto(diccionario, "sucursal.elegir") : undefined}
      opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))}
      alCambiar={(valor) => {
        try {
          localStorage.setItem(clave, valor);
        } catch {
          // Sin almacenamiento no se recuerda; la elección de esta pantalla se pierde al recargar.
        }
        window.dispatchEvent(new Event(AVISO_LOCAL));
      }}
    />
  );
}
