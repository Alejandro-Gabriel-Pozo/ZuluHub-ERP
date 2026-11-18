import { describe, expect, it } from "vitest";
import { clasificarParametros } from "../../src/adaptadores/arca/clasificar";
import { aPuntosDeVentaDeArca } from "../../src/adaptadores/arca/puntos-de-venta-de-arca";
import { habilitadoEnArca } from "../../src/modulos/fiscal/dominio/habilitacion-en-arca";
import { respuestaDePtosVentaDelManual } from "./arca-del-manual";

/**
 * FIXTURE CONSTRUIDO, NO GRABADO (el `NULL` de `FchBaja` es conocimiento público, SIN VERIFICAR con una grabación real): de la respuesta
 * de `FEParamGetPtosVenta` con `<FchBaja>NULL</FchBaja>` a la regla D-77. Vive acá porque el adaptador no puede importar el dominio fiscal.
 */
describe("FEParamGetPtosVenta con FchBaja «NULL» llega hasta la regla de habilitación", () => {
  const lista = aPuntosDeVentaDeArca(
    clasificarParametros(
      {
        tipo: "RESPUESTA",
        estadoHttp: 200,
        cuerpo: respuestaDePtosVentaDelManual({
          puntos: [
            { Nro: "00001", EmisionTipo: "CAE", Bloqueado: "N", FchBaja: "NULL" },
            { Nro: "2", EmisionTipo: "CAE", Bloqueado: "N", FchBaja: "20260131" },
            { Nro: "3", EmisionTipo: "CAE", Bloqueado: "S", FchBaja: "NULL" },
          ],
        }),
      },
      "FEParamGetPtosVenta",
    ),
  );

  it("el punto sin baja y sin bloqueo queda habilitado; el dado de baja y el bloqueado, no", () => {
    if (!lista.ok) throw new Error("la lista debía ser válida");
    expect(habilitadoEnArca(lista.valor, 1)).toBe(true);
    expect(habilitadoEnArca(lista.valor, 2)).toBe(false);
    expect(habilitadoEnArca(lista.valor, 3)).toBe(false);
    expect(habilitadoEnArca(lista.valor, 4)).toBe(false);
  });
});
