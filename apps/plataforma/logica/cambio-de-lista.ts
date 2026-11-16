/**
 * Lo puro del cambio de una lista del sistema desde la consola: los pedidos que la pantalla puede hacer y cómo termina cada uno. Sin Next ni React.
 */
import type { ErrorParaLaPantalla } from "./errores-de-plataforma";
import type { NombreDeLista } from "./listas-del-sistema";

/** Lo que la pantalla fija al primer toque del intento y reusa, igual, en cada reintento (con la misma clave de idempotencia). */
export type PedidoDeLista =
  | Readonly<{ tipo: "AGREGAR"; lista: NombreDeLista; nombre: string }>
  | Readonly<{ tipo: "CORREGIR"; valorId: string; nombre: string; versionEsperada: number }>
  | Readonly<{ tipo: "DESACTIVAR" | "REACTIVAR"; valorId: string; versionEsperada: number }>;

export type RechazoDeLista =
  | Readonly<{ tipo: "ERROR"; error: ErrorParaLaPantalla; referencia: string | undefined }>
  | Readonly<{ tipo: "CANCELADO" }>;

/** La respuesta de cualquiera de las cuatro acciones: la versión nueva o el error ya traducido. */
export type RespuestaDeCambio =
  | Readonly<{ ok: true; dato: Readonly<{ version: number }> }>
  | Readonly<{ ok: false; error: ErrorParaLaPantalla; referencia?: string }>;
