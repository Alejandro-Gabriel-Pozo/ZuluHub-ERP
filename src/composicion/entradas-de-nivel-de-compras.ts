import { z } from "zod";
import { NIVELES_ESTANDAR_DE_COMPRA, type NivelDeCompra } from "../modulos/compras/publico";
import type { Resultado } from "../primitivas/resultado/resultado";
import { err, ok } from "../primitivas/resultado/resultado";
import { entero, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de la pantalla «Nivel de compras» (Compras PR 11): de lo que manda el navegador a lo que recibe `configurarCompras`. Lista de permitidos: solo se toman el nivel y la versión que la
 * persona vio; cualquier otra clave (`empresaId`, `perilla`, …) no llega, y la empresa y quién actúa los pone el servidor. El nivel se elige entre los ESTÁNDAR (N1 y N2: la lista se IMPORTA del
 * dominio): «Recepción separada» y «Tres vías» son de la fase 5 (pausada, dueño 24/11/2026) y un valor que no es de la lista es un pedido inválido (el genérico), no se adivina.
 * Previene: elegir un nivel de la fase 5 desde la web, y guardar un nivel que el navegador inventó. Chequeo: `entradas-de-nivel-de-compras.test.ts`.
 */

export type EntradaWebDeGuardarElNivel = Readonly<{
  nivel: NivelDeCompra;
  versionEsperada: number;
}>;

const forma = z.strictObject({
  nivel: texto,
  versionEsperada: entero,
});

export function entradaDeGuardarElNivel(
  crudo: unknown,
): Resultado<EntradaWebDeGuardarElNivel, ErrorDeEntrada> {
  const leida = leer(forma, crudo);
  if (!leida.ok) return leida;
  const nivel = NIVELES_ESTANDAR_DE_COMPRA.find((n) => n === leida.valor.nivel);
  if (nivel === undefined) return err({ codigo: "FISCAL_DATOS_INVALIDOS", campo: "nivel" });
  return ok({ nivel, versionEsperada: leida.valor.versionEsperada });
}
