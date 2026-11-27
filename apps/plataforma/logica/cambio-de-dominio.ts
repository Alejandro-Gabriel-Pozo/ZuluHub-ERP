/**
 * Lo puro del cambio de un dominio desde la consola: los pedidos que la pantalla puede hacer y cómo termina cada uno. Sin Next ni React.
 */
import type { SuperficieDeDominio, TitularDeDominio } from "../../../src/modulos/marcas/publico";
import type { ErrorParaLaPantalla } from "./errores-de-plataforma";

/** Las superficies que la consola ofrece al dar de alta el dominio de una EMPRESA en esta etapa (el sitio de la empresa es de la etapa 2). */
export const SUPERFICIES_DE_ALTA = [
  "APP",
  "CARTA",
] as const satisfies readonly SuperficieDeDominio[];
export type SuperficieDeAlta = (typeof SUPERFICIES_DE_ALTA)[number];

export const TITULARES_DE_ALTA = [
  "CLIENTE",
  "OPERADOR",
] as const satisfies readonly TitularDeDominio[];
export type TitularDeAlta = (typeof TITULARES_DE_ALTA)[number];

/** Lo que la pantalla fija al primer toque del intento y reusa, igual, en cada reintento (con la misma clave de idempotencia). */
export type PedidoDeDominio =
  | Readonly<{
      tipo: "AGREGAR";
      empresaId: string;
      host: string;
      superficie: SuperficieDeAlta;
      titular: TitularDeAlta;
    }>
  | Readonly<{ tipo: "VERIFICAR" | "ACTIVAR" | "DESACTIVAR"; dominioId: string }>
  | Readonly<{ tipo: "RETIRAR"; dominioId: string; motivo: string }>;

export type RechazoDeDominio =
  | Readonly<{ tipo: "ERROR"; error: ErrorParaLaPantalla; referencia: string | undefined }>
  | Readonly<{ tipo: "CANCELADO" }>;

/** La respuesta de cualquiera de las cinco acciones: el dominio y si esta llamada no cambió nada, o el error ya traducido. */
export type RespuestaDeCambioDeDominio =
  | Readonly<{ ok: true; dato: Readonly<{ dominioId: string; yaEstaba: boolean }> }>
  | Readonly<{ ok: false; error: ErrorParaLaPantalla; referencia?: string }>;

/** Un dominio tal como lo muestra la pantalla: lo que se ve y nada más. */
export type DominioParaLaPantalla = Readonly<{
  id: string;
  host: string;
  superficie: SuperficieDeAlta;
  titular: TitularDeDominio;
  estado: "PENDIENTE_VERIFICACION" | "VERIFICADO" | "ACTIVO" | "RETIRADO";
  /** `dd/mm/aaaa` en la Argentina, o `null` si todavía no se verificó. */
  verificadoEn: string | null;
  motivo: string | null;
  empresa: string;
}>;

export type EmpresaParaElSelector = Readonly<{ id: string; razonSocial: string }>;
